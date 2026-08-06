/**
 * Immutable audit log. Entries are append-only records of who did what, on
 * which tenant resource, when. Querying is tenant-scoped; retention policies
 * purge entries older than the configured window.
 */

import { EnterpriseNotFoundError, EnterpriseValidationError } from './errors.js';
import { assertSameTenant, scopeRecords } from './tenant.js';
import type { ActorType, AuditFilter, AuditLogEntry, AuditRecordInput } from './types.js';
import { addDays, datePart, isIsoDate, newId } from './utils.js';

export interface AuditServiceOptions {
  now?: () => string;
  id?: () => string;
  retentionDays?: number;
}

const ACTOR_TYPES: readonly ActorType[] = ['user', 'system', 'api_key', 'webhook'];
const MAX_LIMIT = 1000;

export class AuditService {
  private readonly entries: AuditLogEntry[] = [];
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly retentionDays: number;

  constructor(options: AuditServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => newId('aud'));
    this.retentionDays = options.retentionDays ?? 90;
  }

  /** Appends an immutable audit entry. */
  record(input: AuditRecordInput): AuditLogEntry {
    if (input.action.trim().length === 0) {
      throw new EnterpriseValidationError('Audit action is required.');
    }
    if (input.resourceType.trim().length === 0) {
      throw new EnterpriseValidationError('Audit resourceType is required.');
    }
    const entry: AuditLogEntry = {
      entryId: this.id(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      actorType: input.actorType ?? 'user',
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata === undefined ? undefined : { ...input.metadata },
      ipAddress: input.ipAddress,
      requestId: input.requestId,
      occurredAt: this.now(),
    };
    if (!ACTOR_TYPES.includes(entry.actorType)) {
      throw new EnterpriseValidationError(`Invalid actor type '${entry.actorType}'.`);
    }
    this.entries.push(entry);
    return { ...entry };
  }

  /** Queries the log, newest first, filtered by the given criteria. */
  query(filter: AuditFilter = {}): AuditLogEntry[] {
    if (filter.since !== undefined && !isIsoDate(filter.since)) {
      throw new EnterpriseValidationError(`Invalid 'since' date '${filter.since}'.`);
    }
    if (filter.until !== undefined && !isIsoDate(filter.until)) {
      throw new EnterpriseValidationError(`Invalid 'until' date '${filter.until}'.`);
    }
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), MAX_LIMIT);
    const matches = this.entries.filter((entry) => {
      if (filter.tenantId !== undefined && entry.tenantId !== filter.tenantId) return false;
      if (filter.actorId !== undefined && entry.actorId !== filter.actorId) return false;
      if (filter.action !== undefined && entry.action !== filter.action) return false;
      if (filter.resourceType !== undefined && entry.resourceType !== filter.resourceType) return false;
      if (filter.resourceId !== undefined && entry.resourceId !== filter.resourceId) return false;
      if (filter.since !== undefined && entry.occurredAt.slice(0, 10) < filter.since) return false;
      if (filter.until !== undefined && entry.occurredAt.slice(0, 10) > filter.until) return false;
      return true;
    });
    const sorted = [...matches].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return sorted.slice(0, limit).map((entry) => ({ ...entry }));
  }

  /** Fetches a single entry, rejecting cross-tenant reads. */
  get(tenantId: string, entryId: string): AuditLogEntry {
    const entry = this.entries.find((candidate) => candidate.entryId === entryId);
    if (entry === undefined) {
      throw new EnterpriseNotFoundError(`Audit entry '${entryId}' not found.`, {
        tenantId,
        resourceId: entryId,
      });
    }
    assertSameTenant(entry.tenantId, tenantId);
    return { ...entry };
  }

  /** Removes entries older than `before` (a `YYYY-MM-DD` date). */
  purgeOlderThan(tenantId: string, before: string): number {
    if (!isIsoDate(before)) {
      throw new EnterpriseValidationError(`Invalid cutoff date '${before}'.`);
    }
    let removed = 0;
    const kept: AuditLogEntry[] = [];
    for (const entry of this.entries) {
      if (entry.tenantId === tenantId && entry.occurredAt.slice(0, 10) < before) {
        removed += 1;
      } else {
        kept.push(entry);
      }
    }
    this.entries.length = 0;
    this.entries.push(...kept);
    return removed;
  }

  /** Removes entries past the configured retention window. */
  purgeExpired(tenantId: string): number {
    const cutoff = addDays(datePart(this.now()), -this.retentionDays);
    return this.purgeOlderThan(tenantId, cutoff);
  }

  /** Number of entries visible to a tenant. */
  count(tenantId: string): number {
    return scopeRecords(this.entries, tenantId).length;
  }
}
