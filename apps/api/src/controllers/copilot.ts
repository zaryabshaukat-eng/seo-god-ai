/**
 * Copilot endpoints. Sessions are tenant-scoped; chat streams tokens and tool
 * events as Server-Sent Events matching the web client's `CopilotStreamEvent`.
 */

import type { Platform } from '../platform.js';
import type { Router } from '../router.js';
import { bodyAs } from '../context.js';
import { guard } from '../guards.js';
import { sendJson } from '../http.js';
import { PlatformPermissions } from '../permissions.js';
import { optionalNumber, optionalString, requireString } from '../validation.js';
import type { ChatRequest, ChatStreamEvent } from '@seogod/ai-copilot';

function sessionShape(session: {
  sessionId: string;
  createdAt: string;
  messages: Array<{ role: string; content: string }>;
}): Record<string, unknown> {
  const firstUser = session.messages.find((message) => message.role === 'user');
  const title = firstUser === undefined ? 'New conversation' : firstUser.content.slice(0, 60);
  return {
    id: session.sessionId,
    title,
    createdAt: Date.parse(session.createdAt),
    messageCount: session.messages.length,
  };
}

function writeSse(res: { write: (chunk: string) => void }, event: ChatStreamEvent): void {
  let wire: Record<string, unknown>;
  switch (event.type) {
    case 'delta':
      wire = { type: 'delta', text: event.text };
      break;
    case 'tool-call':
      wire = {
        type: 'tool-call',
        id: event.toolCall.id,
        tool: event.toolCall.name,
        args: JSON.stringify(event.toolCall.arguments),
      };
      break;
    case 'tool-result':
      wire = { type: 'tool-result', id: event.result.toolCallId, result: JSON.stringify(event.result.output) };
      break;
    case 'done':
      wire = { type: 'done', messageId: event.response.sessionId };
      break;
    case 'error':
      wire = { type: 'error', message: event.message };
      break;
  }
  res.write(`data: ${JSON.stringify(wire)}\n\n`);
}

export function registerCopilotRoutes(platform: Platform, router: Router): void {
  router.on(
    'GET',
    '/api/v1/copilot/sessions',
    guard(platform, { permission: PlatformPermissions.copilotRead }, async (ctx) => {
      const limit = optionalNumber({ limit: ctx.query.get('limit') ?? undefined }, 'limit') ?? 50;
      const sessions = await platform.copilot.listSessions({
        tenantId: ctx.tenantId ?? '',
        userId: ctx.principal?.userId,
        storeId: ctx.query.get('storeId') ?? undefined,
        limit,
      });
      sendJson(ctx.res, 200, { sessions: sessions.map(sessionShape) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/copilot/chat',
    guard(platform, { permission: PlatformPermissions.copilotWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const request: ChatRequest = {
        message: requireString(body, 'message', 'Message'),
        tenantId: ctx.tenantId ?? '',
        userId: ctx.principal?.userId,
        role: ctx.principal?.role,
        storeId: optionalString(body, 'storeId'),
        sessionId: optionalString(body, 'sessionId'),
        model: optionalString(body, 'model'),
        temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
        ipAddress: ctx.ip,
        requestId: ctx.requestId,
      };

      ctx.res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      ctx.res.write(`data: ${JSON.stringify({ type: 'start' })}\n\n`);
      try {
        for await (const event of platform.copilot.stream(request)) {
          if (ctx.res.destroyed) break;
          writeSse(ctx.res, event);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Copilot stream failed.';
        ctx.res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
      } finally {
        ctx.res.end();
      }
    }),
  );
}
