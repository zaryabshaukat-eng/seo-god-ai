import { describe, expect, it } from 'vitest';
import { ApiKeyService } from './apikeys.js';
import {
  EnterpriseAuthorizationError,
  EnterpriseIsolationError,
  EnterpriseValidationError,
} from './errors.js';

function makeService(now = '2026-08-06T12:00:00.000Z') {
  return new ApiKeyService({ now: () => now });
}

describe('ApiKeyService', () => {
  it('issues keys whose plaintext authenticates once', () => {
    const service = makeService();
    const { record, key } = service.issueKey('t1', 'CI Runner', ['orgs.read']);
    expect(record.keyId).toMatch(/^key_/);
    expect(record.prefix).toBe(key.slice(0, 24));
    expect(record.scopes).toEqual(['orgs.read']);
    expect(record.status).toBe('active');
    expect(record.createdBy).toBe('system');

    const verified = service.verifyKey(key, 't1');
    expect(verified?.keyId).toBe(record.keyId);
    expect(verified?.lastUsedAt).toBe('2026-08-06T12:00:00.000Z');
  });

  it('rejects invalid issuance input', () => {
    const service = makeService();
    expect(() => service.issueKey('t1', '   ', ['orgs.read'])).toThrow(EnterpriseValidationError);
    expect(() => service.issueKey('t1', 'key', [])).toThrow(EnterpriseValidationError);
    expect(() => service.issueKey('t1', 'key', ['bogus.scope' as never])).toThrow(EnterpriseValidationError);
    expect(() => service.issueKey('t1', 'key', ['orgs.read'], { expiresInDays: 0 })).toThrow(
      EnterpriseValidationError,
    );
  });

  it('honors expiry windows', () => {
    const service = makeService('2026-08-06T12:00:00.000Z');
    const { key } = service.issueKey('t1', 'expiring', ['orgs.read'], { expiresInDays: 30, createdBy: 'u1' });
    expect(service.verifyKey(key, 't1')).not.toBeNull();
    const expired = new ApiKeyService({ now: () => '2026-09-07T00:00:00.000Z' });
    expect(expired.verifyKey(key, 't1')).toBeNull();
  });

  it('fails verification for wrong tenant, revoked keys and unknown plaintext', () => {
    const service = makeService();
    const { record, key } = service.issueKey('t1', 'key', ['orgs.read']);
    expect(service.verifyKey('not-the-key', 't1')).toBeNull();
    expect(service.verifyKey(key, 't2')).toBeNull();

    service.revokeKey('t1', record.keyId);
    expect(service.verifyKey(key, 't1')).toBeNull();
    const revoked = service.revokeKey('t1', record.keyId);
    expect(revoked.status).toBe('revoked');
  });

  it('enforces scopes', () => {
    const service = makeService();
    const { record } = service.issueKey('t1', 'reader', ['orgs.read']);
    expect(service.hasScope(record, 'orgs.read')).toBe(true);
    expect(service.hasScope(record, 'billing.read')).toBe(false);
    expect(() => service.requireScope(record, 'billing.read')).toThrow(EnterpriseAuthorizationError);
    expect(() => service.requireScope(record, 'orgs.read')).not.toThrow();
  });

  it('lists, reads and deletes keys with tenant isolation', async () => {
    const service = makeService();
    const a = service.issueKey('t1', 'a', ['orgs.read']);
    service.issueKey('t1', 'b', ['orgs.read']);
    service.issueKey('t2', 'c', ['orgs.read']);

    expect(await service.listKeys('t1')).toHaveLength(2);
    const fetched = await service.getKey('t1', a.record.keyId);
    expect(fetched.keyId).toBe(a.record.keyId);
    await expect(service.getKey('t2', a.record.keyId)).rejects.toThrow(EnterpriseIsolationError);
    await expect(service.getKey('t1', 'key_missing')).rejects.toThrow(EnterpriseValidationError);
  });

  it('does not expose the plaintext after issuance', () => {
    const service = makeService();
    const { record } = service.issueKey('t1', 'key', ['orgs.read']);
    const fetched = service.verifyKey('wrong', 't1');
    expect(fetched).toBeNull();
    expect(record).not.toHaveProperty('key');
  });
});
