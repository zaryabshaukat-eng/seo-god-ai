import { describe, expect, it } from 'vitest';
import { AuditService } from '@seogod/enterprise';
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCES,
  chatEntry,
  fromEnterpriseAudit,
  NoopAuditLogger,
} from './audit.js';
import type { CopilotSession } from './types.js';

describe('NoopAuditLogger', () => {
  it('is silent', () => {
    expect(() =>
      new NoopAuditLogger().record({
        tenantId: 't',
        actorId: 'a',
        action: 'copilot.chat',
        resourceType: 'copilot.conversation',
        resourceId: 'c1',
      }),
    ).not.toThrow();
  });
});

describe('chatEntry', () => {
  it('builds an audit entry from the session and request', () => {
    const session: CopilotSession = {
      sessionId: 'conv_1',
      tenantId: 'tenant_a',
      storeId: 'store_1',
      userId: 'user_1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: [],
    };
    const entry = chatEntry(
      session,
      { userId: 'user_9', ipAddress: '127.0.0.1', requestId: 'req_1' },
      { promptId: 'copilot.answer', model: 'm1', toolCalls: 0 },
    );
    expect(entry).toEqual({
      tenantId: 'tenant_a',
      storeId: 'store_1',
      actorId: 'user_9',
      action: 'copilot.chat',
      resourceType: 'copilot.conversation',
      resourceId: 'conv_1',
      metadata: { promptId: 'copilot.answer', model: 'm1', toolCalls: 0 },
      ipAddress: '127.0.0.1',
      requestId: 'req_1',
    });
  });

  it('falls back to the session user', () => {
    const session: CopilotSession = {
      sessionId: 'conv_1',
      tenantId: 'tenant_a',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      userId: 'user_1',
      messages: [],
    };
    expect(chatEntry(session, {}, {}).actorId).toBe('user_1');
  });
});

describe('fromEnterpriseAudit', () => {
  it('appends entries to the enterprise audit log', async () => {
    const audit = new AuditService({ now: () => '2026-01-01T00:00:00.000Z' });
    const logger = fromEnterpriseAudit(audit);
    logger.record({
      tenantId: 'tenant_a',
      actorId: 'user_1',
      action: AUDIT_ACTIONS.tool,
      resourceType: AUDIT_RESOURCES.tool,
      resourceId: 'list_recommendations',
      metadata: { ok: true },
      ipAddress: '10.0.0.1',
      requestId: 'req_1',
    });
    const entries = audit.query({ tenantId: 'tenant_a', action: AUDIT_ACTIONS.tool });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tenantId: 'tenant_a',
      actorId: 'user_1',
      action: 'copilot.tool',
      resourceType: 'copilot.tool',
      resourceId: 'list_recommendations',
      metadata: { ok: true },
      ipAddress: '10.0.0.1',
      requestId: 'req_1',
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
