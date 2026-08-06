/**
 * Audit logging for copilot activity.
 *
 * Entries follow the enterprise audit vocabulary (`tenantId`, `actorId`,
 * `action`, `resourceType`, `resourceId`) so they can be appended to the
 * enterprise immutable audit log. The `AuditLogger` is structural; when no
 * logger is wired the copilot silently skips logging.
 */

import type { CopilotSession } from './types.js';

export interface AuditEntryInput {
  tenantId: string;
  storeId?: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  requestId?: string;
}

export interface AuditLogger {
  record(input: AuditEntryInput): Promise<void> | void;
}

export const AUDIT_ACTIONS = {
  chat: 'copilot.chat',
  tool: 'copilot.tool',
  sessionCreated: 'copilot.session.created',
  sessionDeleted: 'copilot.session.deleted',
  permissionDenied: 'copilot.permission.denied',
  error: 'copilot.error',
} as const;

export const AUDIT_RESOURCES = {
  conversation: 'copilot.conversation',
  tool: 'copilot.tool',
} as const;

/** No-op logger used when auditing is not configured. */
export class NoopAuditLogger implements AuditLogger {
  record(_input: AuditEntryInput): void {
    // Intentionally silent.
  }
}

/** Audit entry for a chat message, derived from the session. */
export function chatEntry(
  session: CopilotSession,
  request: { userId?: string; ipAddress?: string; requestId?: string },
  metadata: Record<string, unknown>,
): AuditEntryInput {
  return {
    tenantId: session.tenantId,
    storeId: session.storeId,
    actorId: request.userId ?? session.userId ?? 'system',
    action: AUDIT_ACTIONS.chat,
    resourceType: AUDIT_RESOURCES.conversation,
    resourceId: session.sessionId,
    metadata,
    ipAddress: request.ipAddress,
    requestId: request.requestId,
  };
}

// ---------------------------------------------------------------------------
// Enterprise adapter
// ---------------------------------------------------------------------------

import type { AuditService } from '@seogod/enterprise';
import type { AuditRecordInput } from '@seogod/enterprise';

/** Adapts the enterprise `AuditService` into a copilot `AuditLogger`. */
export function fromEnterpriseAudit(audit: AuditService): AuditLogger {
  return {
    record(input) {
      const record: AuditRecordInput = {
        tenantId: input.tenantId,
        actorId: input.actorId,
        actorType: 'user',
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata,
        ipAddress: input.ipAddress,
        requestId: input.requestId,
      };
      audit.record(record);
    },
  };
}
