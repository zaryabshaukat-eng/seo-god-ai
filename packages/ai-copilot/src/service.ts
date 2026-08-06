/**
 * CopilotService — the conversational AI assistant.
 *
 * A `chat`/`stream` loop that classifies the request into a topic prompt,
 * sends the conversation (with memory) to a streaming `ChatModel`, executes
 * any tool calls under role-based permissions, and records everything through
 * audit logging and metrics.
 */

import type {
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  CopilotMessage,
  CopilotSession,
  ChatUsage,
  ExecutedToolCall,
  SessionFilter,
  ToolCall,
  ToolResult,
} from './types.js';
import {
  CopilotNotFoundError,
  CopilotProviderError,
  CopilotValidationError,
  CopilotIsolationError,
} from './errors.js';
import { assertMessage, assertTenant, newCopilotId, parseToolArguments, positiveInt, windowMessages } from './utils.js';
import { DEFAULT_PROMPTS, PromptLibrary, PROMPT_SYSTEM_ID, classifyIntent } from './prompts.js';
import {
  toModelMessages,
  ZERO_USAGE,
  type ChatModel,
  type ModelRequest,
  type ModelResponse,
  type ModelToolCall,
} from './provider.js';
import type { CopilotSources } from './sources.js';
import { createDefaultTools, runTool, ToolRegistry, type CopilotTool } from './tools.js';
import { assertAuthorized, COPILOT_PERMISSIONS, type Authorizer } from './permissions.js';
import { AUDIT_ACTIONS, AUDIT_RESOURCES, chatEntry, NoopAuditLogger, type AuditLogger } from './audit.js';
import { NoopCopilotMetrics, type CopilotMetrics } from './metrics.js';
import { InMemoryConversationStore, type ConversationStore } from './memory.js';

export interface CopilotServiceOptions {
  /** Streaming chat model. Required. */
  model: ChatModel;
  /** Platform data sources. Required (every tool degrades when a source is absent). */
  sources: CopilotSources;
  /** Tool set; defaults to the standard copilot tools. */
  tools?: CopilotTool[];
  /** Conversation memory; defaults to an in-memory store. */
  store?: ConversationStore;
  /** Prompt library; defaults to the built-in topic prompts. */
  prompts?: PromptLibrary;
  /** Audit logger; defaults to a silent logger. */
  audit?: AuditLogger;
  /** Permission guard; when omitted every action is allowed. */
  authorize?: Authorizer;
  /** Metrics recorder; defaults to a no-op recorder. */
  metrics?: CopilotMetrics;
  now?: () => string;
  id?: () => string;
  defaultModel?: string;
  defaultHistory?: number;
  maxToolTurns?: number;
}

function toToolCall(call: ModelToolCall): ToolCall {
  return { id: call.id, name: call.name, arguments: parseToolArguments(call.arguments) };
}

export class CopilotService {
  readonly registry: ToolRegistry;
  readonly prompts: PromptLibrary;

  private readonly model: ChatModel;
  private readonly sources: CopilotSources;
  private readonly store: ConversationStore;
  private readonly audit: AuditLogger;
  private readonly authorize: Authorizer | undefined;
  private readonly metrics: CopilotMetrics;
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly defaultModel: string;
  private readonly defaultHistory: number;
  private readonly maxToolTurns: number;

  constructor(options: CopilotServiceOptions) {
    this.model = options.model;
    this.sources = options.sources;
    this.registry = new ToolRegistry(options.tools ?? createDefaultTools());
    this.prompts = options.prompts ?? new PromptLibrary(DEFAULT_PROMPTS);
    this.store = options.store ?? new InMemoryConversationStore();
    this.audit = options.audit ?? new NoopAuditLogger();
    this.authorize = options.authorize;
    this.metrics = options.metrics ?? new NoopCopilotMetrics();
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => newCopilotId('conv'));
    this.defaultModel = options.defaultModel ?? options.model.models[0] ?? 'default';
    this.defaultHistory = positiveInt(options.defaultHistory ?? 20, 20, 0, 100);
    this.maxToolTurns = positiveInt(options.maxToolTurns ?? 4, 4, 1, 20);
  }

  /** Starts a new conversation with the platform system prompt. */
  async createSession(input: {
    tenantId: string;
    storeId?: string;
    userId?: string;
  }): Promise<CopilotSession> {
    assertTenant(input.tenantId);
    const sessionId = this.id();
    const capabilities = this.registry.list().map((tool) => tool.name).join(', ');
    const session: CopilotSession = {
      sessionId,
      tenantId: input.tenantId,
      storeId: input.storeId,
      userId: input.userId,
      createdAt: this.now(),
      updatedAt: this.now(),
      messages: [{ role: 'system', content: this.prompts.render(PROMPT_SYSTEM_ID, { capabilities }) }],
    };
    await this.store.saveSession(session);
    this.metrics.session();
    this.audit.record({
      tenantId: input.tenantId,
      storeId: input.storeId,
      actorId: input.userId ?? 'system',
      action: AUDIT_ACTIONS.sessionCreated,
      resourceType: AUDIT_RESOURCES.conversation,
      resourceId: sessionId,
    });
    return session;
  }

  /** Fetches a session, rejecting cross-tenant reads. */
  async getSession(sessionId: string, tenantId: string): Promise<CopilotSession> {
    assertTenant(tenantId);
    if (sessionId.trim().length === 0) {
      throw new CopilotValidationError('Session id is required.', { context: { sessionId } });
    }
    const session = await this.store.getSession(sessionId);
    if (session === null) {
      throw new CopilotNotFoundError(`Conversation '${sessionId}' not found.`, { context: { sessionId } });
    }
    if (session.tenantId !== tenantId) {
      throw new CopilotIsolationError(`Conversation '${sessionId}' belongs to another tenant.`, {
        context: { sessionId, tenantId },
      });
    }
    return session;
  }

  /** Lists sessions for a tenant (optionally scoped by store/user). */
  async listSessions(filter: SessionFilter): Promise<CopilotSession[]> {
    return this.store.listSessions(filter);
  }

  /** Deletes a conversation and records the audit entry. */
  async deleteSession(sessionId: string, tenantId: string): Promise<void> {
    await this.store.deleteSession(sessionId, tenantId);
    this.audit.record({
      tenantId,
      actorId: 'system',
      action: AUDIT_ACTIONS.sessionDeleted,
      resourceType: AUDIT_RESOURCES.conversation,
      resourceId: sessionId,
    });
  }

  /**
   * Runs a full conversation and returns the final response. Tool calls are
   * executed internally; only the terminal answer is surfaced.
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    let response: ChatResponse | undefined;
    for await (const event of this.runConversation(request)) {
      if (event.type === 'done') {
        response = event.response;
        break;
      }
    }
    return response!;
  }

  /** Streams the conversation as events: deltas, tool calls/results, done. */
  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    yield* this.runConversation(request);
  }

  /**
   * The conversation core. Streams events and throws on failure; the model
   * loop, permission checks, tool execution, memory and auditing all live
   * here.
   */
  async *runConversation(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const sessionId = request.sessionId ?? '';
    assertMessage(request.message);
    assertTenant(request.tenantId);

    const session =
      request.sessionId === undefined
        ? await this.createSession({
            tenantId: request.tenantId,
            storeId: request.storeId,
            userId: request.userId,
          })
        : await this.getSession(request.sessionId, request.tenantId);

    session.messages.push({ role: 'user', content: request.message });

    const role = request.role ?? 'viewer';
    try {
      assertAuthorized(this.authorize, role, COPILOT_PERMISSIONS.chat, {
        userId: request.userId,
        tenantId: request.tenantId,
      });
    } catch (error) {
      this.metrics.permissionDenied();
      this.audit.record({
        tenantId: request.tenantId,
        storeId: request.storeId,
        actorId: request.userId ?? 'system',
        action: AUDIT_ACTIONS.permissionDenied,
        resourceType: AUDIT_RESOURCES.conversation,
        resourceId: session.sessionId,
        metadata: { permission: COPILOT_PERMISSIONS.chat, role },
        ipAddress: request.ipAddress,
        requestId: request.requestId,
      });
      throw error;
    }

    const promptId = classifyIntent(request.message).promptId;
    const history = positiveInt(request.history ?? this.defaultHistory, this.defaultHistory, 0, 100);
    const maxTurns = positiveInt(request.maxToolTurns ?? this.maxToolTurns, this.maxToolTurns, 1, 20);
    const model = request.model !== undefined && request.model.trim().length > 0 ? request.model : this.defaultModel;
    const startedAt = Date.now();
    const executed: ExecutedToolCall[] = [];
    const totalUsage: ChatUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finalModel = model;
    let answer!: CopilotMessage;

    for (let turn = 0; turn < maxTurns; turn++) {
      this.metrics.turn();
      if (request.signal?.aborted) {
        throw new CopilotProviderError('Request was aborted.', {
          operation: 'copilot.model',
          context: { sessionId: session.sessionId },
        });
      }
      const modelRequest: ModelRequest = {
        model,
        messages: toModelMessages(windowMessages(session.messages, history)),
        temperature: request.temperature,
        tools: this.registry.toolSchemas(),
        signal: request.signal,
      };
      let completed: ModelResponse;
      try {
        let text = '';
        let turnUsage = ZERO_USAGE;
        let turnModel = '';
        const callsById = new Map<string, ModelToolCall>();
        for await (const chunk of this.model.stream(modelRequest)) {
          switch (chunk.type) {
            case 'delta':
              text += chunk.text;
              yield { type: 'delta', sessionId, text: chunk.text };
              break;
            case 'tool-call':
              callsById.set(chunk.call.id, chunk.call);
              break;
            case 'done':
              text = chunk.response.text;
              turnUsage = chunk.response.usage;
              turnModel = chunk.response.model;
              for (const call of chunk.response.toolCalls) {
                callsById.set(call.id, call);
              }
              break;
            case 'error':
              throw new CopilotProviderError(chunk.message, { operation: 'copilot.model' });
          }
        }
        completed = { text, toolCalls: [...callsById.values()], usage: turnUsage, model: turnModel };
      } catch (error) {
        this.metrics.modelError();
        throw new CopilotProviderError(error instanceof Error ? error.message : 'Chat model failed.', {
          operation: 'copilot.model',
          cause: error,
          context: { sessionId: session.sessionId },
        });
      }
      finalModel = completed.model !== '' ? completed.model : model;
      totalUsage.promptTokens += completed.usage.promptTokens;
      totalUsage.completionTokens += completed.usage.completionTokens;
      totalUsage.totalTokens += completed.usage.totalTokens;
      for (const call of completed.toolCalls) {
        yield { type: 'tool-call', sessionId, toolCall: toToolCall(call) };
        const executedCall = await this.executeTool(call, session, request);
        executed.push(executedCall);
        yield { type: 'tool-result', sessionId, result: executedCall.result };
      }
      if (completed.toolCalls.length === 0) {
        answer = { role: 'assistant', content: completed.text };
        session.messages.push(answer);
        break;
      }
      if (turn === maxTurns - 1) {
        answer = {
          role: 'assistant',
          content: 'I reached my tool-call limit before I could answer. Please rephrase or narrow the request.',
        };
        session.messages.push(answer);
      }
    }

    session.updatedAt = this.now();
    await this.store.saveSession(session);
    this.metrics.message();
    this.audit.record(
      chatEntry(session, request, {
        promptId,
        model: finalModel,
        toolCalls: executed.length,
      }),
    );
    this.metrics.tokens(totalUsage);
    this.metrics.latency(Date.now() - startedAt);

    const response: ChatResponse = {
      sessionId: session.sessionId,
      storeId: session.storeId,
      message: answer,
      toolCalls: executed,
      usage: totalUsage,
      model: finalModel,
      promptId,
    };
    yield { type: 'done', sessionId, response };
  }

  private async executeTool(
    call: ModelToolCall,
    session: CopilotSession,
    request: ChatRequest,
  ): Promise<ExecutedToolCall> {
    const tool = this.registry.get(call.name);
    const toolCall = toToolCall(call);
    const role = request.role ?? 'viewer';
    const pushToolMessage = (result: ToolResult): void => {
      session.messages.push({
        role: 'tool',
        content: JSON.stringify(result.ok ? result.output : { error: result.error }),
        toolCallId: call.id,
        name: call.name,
      });
    };

    if (tool === undefined) {
      const result: ToolResult = {
        toolCallId: call.id,
        name: call.name,
        ok: false,
        output: null,
        error: `Unknown tool '${call.name}'.`,
      };
      pushToolMessage(result);
      return { call: toolCall, result, permission: '' };
    }

    try {
      assertAuthorized(this.authorize, role, tool.permission, {
        userId: request.userId,
        tenantId: request.tenantId,
      });
    } catch {
      this.metrics.permissionDenied();
      this.audit.record({
        tenantId: request.tenantId,
        storeId: request.storeId,
        actorId: request.userId ?? 'system',
        action: AUDIT_ACTIONS.permissionDenied,
        resourceType: AUDIT_RESOURCES.tool,
        resourceId: call.name,
        metadata: { permission: tool.permission, role },
        ipAddress: request.ipAddress,
        requestId: request.requestId,
      });
      const result: ToolResult = {
        toolCallId: call.id,
        name: call.name,
        ok: false,
        output: null,
        error: `Permission denied for '${tool.permission}'.`,
      };
      pushToolMessage(result);
      return { call: toolCall, result, permission: tool.permission };
    }

    this.metrics.toolCall();
    const args = parseToolArguments(call.arguments);
    const result = await runTool(tool, args, { sources: this.sources, session, request });
    result.toolCallId = call.id;
    result.name = call.name;
    if (!result.ok) {
      this.metrics.toolError();
    }
    pushToolMessage(result);
    this.audit.record({
      tenantId: request.tenantId,
      storeId: request.storeId,
      actorId: request.userId ?? 'system',
      action: AUDIT_ACTIONS.tool,
      resourceType: AUDIT_RESOURCES.tool,
      resourceId: call.name,
      metadata: { ok: result.ok, permission: tool.permission },
      ipAddress: request.ipAddress,
      requestId: request.requestId,
    });
    return { call: toolCall, result, permission: tool.permission };
  }
}
