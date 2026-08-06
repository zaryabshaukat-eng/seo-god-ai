/**
 * Conversation memory. Sessions are tenant-scoped; reads outside the owning
 * tenant are rejected by the caller. The default store is in-memory; a
 * production store can be plugged in behind the same interface.
 */

import type { CopilotSession, SessionFilter } from './types.js';
import { CopilotNotFoundError, CopilotValidationError } from './errors.js';

export interface ConversationStore {
  saveSession(session: CopilotSession): Promise<void> | void;
  getSession(sessionId: string): Promise<CopilotSession | null> | CopilotSession | null;
  listSessions(filter: SessionFilter): Promise<CopilotSession[]> | CopilotSession[];
  deleteSession(sessionId: string, tenantId: string): Promise<void> | void;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly sessions = new Map<string, CopilotSession>();

  async saveSession(session: CopilotSession): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async getSession(sessionId: string): Promise<CopilotSession | null> {
    const session = this.sessions.get(sessionId);
    return session === undefined ? null : session;
  }

  async listSessions(filter: SessionFilter): Promise<CopilotSession[]> {
    const limit = Math.max(filter.limit ?? 50, 0);
    const matches: CopilotSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.tenantId !== filter.tenantId) continue;
      if (filter.storeId !== undefined && session.storeId !== filter.storeId) continue;
      if (filter.userId !== undefined && session.userId !== filter.userId) continue;
      matches.push(session);
    }
    matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return matches.slice(0, limit);
  }

  async deleteSession(sessionId: string, tenantId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new CopilotNotFoundError(`Conversation '${sessionId}' not found.`, {
        context: { sessionId },
      });
    }
    if (session.tenantId !== tenantId) {
      throw new CopilotValidationError('Conversation belongs to another tenant.', {
        context: { sessionId, tenantId },
      });
    }
    this.sessions.delete(sessionId);
  }
}
