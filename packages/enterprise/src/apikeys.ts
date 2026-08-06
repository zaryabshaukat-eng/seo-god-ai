/**
 * Tenant-scoped API keys. Plaintext keys are shown exactly once at issuance;
 * only a SHA-256 hash is stored. `verifyKey` authenticates a plaintext and
 * `requireScope` enforces that the key carries a given permission.
 */

import { EnterpriseAuthorizationError, EnterpriseValidationError } from './errors.js';
import { assertSameTenant, scopeRecords } from './tenant.js';
import type { ApiKeyRecord, ApiKeyScope } from './types.js';
import { addDays, datePart, newApiKey, newId, sha256 } from './utils.js';

export interface ApiKeyServiceOptions {
  now?: () => string;
  id?: () => string;
}

export interface IssueKeyOptions {
  createdBy?: string;
  expiresInDays?: number;
}

const ALL_SCOPES: readonly ApiKeyScope[] = [
  'tenant.read',
  'tenant.write',
  'orgs.read',
  'orgs.write',
  'teams.write',
  'audit.read',
  'apikeys.manage',
  'webhooks.manage',
  'billing.read',
  'billing.manage',
];

export class ApiKeyService {
  private readonly keysByHash = new Map<string, ApiKeyRecord>();
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(options: ApiKeyServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => newId('key'));
  }

  /** Issues a new key; the plaintext is returned only once. */
  issueKey(tenantId: string, name: string, scopes: readonly ApiKeyScope[], options: IssueKeyOptions = {}): {
    record: ApiKeyRecord;
    key: string;
  } {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new EnterpriseValidationError('API key name is required.');
    }
    if (scopes.length === 0) {
      throw new EnterpriseValidationError('API key requires at least one scope.');
    }
    for (const scope of scopes) {
      if (!ALL_SCOPES.includes(scope)) {
        throw new EnterpriseValidationError(`Unknown API key scope '${scope}'.`);
      }
    }
    if (options.expiresInDays !== undefined && options.expiresInDays < 1) {
      throw new EnterpriseValidationError('expiresInDays must be a positive integer.');
    }
    const generated = newApiKey(trimmed);
    const timestamp = this.now();
    const record: ApiKeyRecord = {
      keyId: this.id(),
      tenantId,
      name: trimmed,
      prefix: generated.prefix,
      scopes: scopes.slice(),
      status: 'active',
      createdBy: options.createdBy ?? 'system',
      createdAt: timestamp,
      expiresAt: options.expiresInDays === undefined ? undefined : addDays(datePart(timestamp), options.expiresInDays),
    };
    this.keysByHash.set(generated.hash, record);
    return { record: { ...record }, key: generated.plaintext };
  }

  /** Authenticates a plaintext key; returns its record or `null`. */
  verifyKey(plaintext: string, tenantId?: string): ApiKeyRecord | null {
    const record = this.keysByHash.get(sha256(plaintext));
    if (record === undefined) return null;
    if (record.status === 'revoked') return null;
    if (tenantId !== undefined) {
      if (record.tenantId !== tenantId) return null;
    }
    if (record.expiresAt !== undefined && datePart(this.now()) > record.expiresAt) return null;
    record.lastUsedAt = this.now();
    return { ...record };
  }

  /** True when the record grants the scope. */
  hasScope(record: ApiKeyRecord, scope: ApiKeyScope): boolean {
    return record.scopes.includes(scope);
  }

  /** Throws unless the record grants the scope. */
  requireScope(record: ApiKeyRecord, scope: ApiKeyScope): void {
    if (!this.hasScope(record, scope)) {
      throw new EnterpriseAuthorizationError(
        `API key '${record.keyId}' does not grant scope '${scope}'.`,
        { tenantId: record.tenantId, resourceId: record.keyId, permission: scope },
      );
    }
  }

  /** Marks a key revoked (its plaintext no longer authenticates). */
  revokeKey(tenantId: string, keyId: string): ApiKeyRecord {
    const record = this.getOrThrow(tenantId, keyId);
    if (record.status === 'revoked') return { ...record };
    record.status = 'revoked';
    return { ...record };
  }

  async getKey(tenantId: string, keyId: string): Promise<ApiKeyRecord> {
    return this.getOrThrow(tenantId, keyId);
  }

  async listKeys(tenantId: string): Promise<ApiKeyRecord[]> {
    return scopeRecords([...this.keysByHash.values()], tenantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((record) => ({ ...record }));
  }

  private getOrThrow(tenantId: string, keyId: string): ApiKeyRecord {
    const record = [...this.keysByHash.values()].find((candidate) => candidate.keyId === keyId);
    if (record === undefined) {
      throw new EnterpriseValidationError(`API key '${keyId}' not found.`, { tenantId, resourceId: keyId });
    }
    assertSameTenant(record.tenantId, tenantId);
    return record;
  }
}
