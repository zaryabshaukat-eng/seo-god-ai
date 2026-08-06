import { describe, expect, it } from 'vitest';
import { AuditService } from './audit.js';
import { EnterpriseIsolationError, EnterpriseNotFoundError, EnterpriseValidationError } from './errors.js';

function makeService(now = '2026-08-06T12:00:00.000Z') {
  return new AuditService({ now: () => now, retentionDays: 30 });
}

describe('AuditService', () => {
  it('records immutable entries with defaults and context', () => {
    const service = makeService();
    const entry = service.record({
      tenantId: 't1',
      actorId: 'u1',
      action: 'org.create',
      resourceType: 'organization',
      resourceId: 'org_1',
      metadata: { name: 'Acme' },
      ipAddress: '10.0.0.1',
      requestId: 'req-1',
    });
    expect(entry.entryId).toMatch(/^aud_/);
    expect(entry.actorType).toBe('user');
    expect(entry.occurredAt).toBe('2026-08-06T12:00:00.000Z');
    expect(entry.metadata?.name).toBe('Acme');
  });

  it('rejects invalid records', () => {
    const service = makeService();
    expect(() =>
      service.record({ tenantId: 't1', actorId: 'u1', action: ' ', resourceType: 'org', resourceId: 'r1' }),
    ).toThrow(EnterpriseValidationError);
    expect(() =>
      service.record({ tenantId: 't1', actorId: 'u1', action: 'x', resourceType: ' ', resourceId: 'r1' }),
    ).toThrow(EnterpriseValidationError);
    expect(() =>
      service.record({ tenantId: 't1', actorId: 'u1', action: 'x', resourceType: 'org', resourceId: 'r1', actorType: 'robot' as never }),
    ).toThrow(EnterpriseValidationError);
  });

  it('queries with filters, ordering and limits', () => {
    const service = makeService();
    service.record({ tenantId: 't1', actorId: 'u1', action: 'a', resourceType: 'org', resourceId: 'r1' });
    service.record({ tenantId: 't1', actorId: 'u2', action: 'b', resourceType: 'team', resourceId: 'r2' });
    service.record({ tenantId: 't2', actorId: 'u1', action: 'a', resourceType: 'org', resourceId: 'r3' });
    service.record({ tenantId: 't1', actorId: 'u1', action: 'c', resourceType: 'org', resourceId: 'r1' });

    expect(service.query({ tenantId: 't1' })).toHaveLength(3);
    expect(service.query({ tenantId: 't1', action: 'a' })).toHaveLength(1);
    expect(service.query({ tenantId: 't1', actorId: 'u1' })).toHaveLength(2);
    expect(service.query({ tenantId: 't1', resourceType: 'team' })).toHaveLength(1);
    expect(service.query({ tenantId: 't1', resourceId: 'r1' })).toHaveLength(2);
    expect(service.query({ tenantId: 't1', since: '2026-08-06', until: '2026-08-06' })).toHaveLength(3);
    expect(service.query({ tenantId: 't1', since: '2026-08-07' })).toHaveLength(0);
    expect(service.query({ tenantId: 't1', until: '2026-08-05' })).toHaveLength(0);
    expect(service.query({ tenantId: 't1', limit: 2 })).toHaveLength(2);
    expect(service.query()).toHaveLength(4);
    expect(service.count('t1')).toBe(3);
  });

  it('rejects invalid date filters', () => {
    const service = makeService();
    expect(() => service.query({ since: 'not-a-date' })).toThrow(EnterpriseValidationError);
    expect(() => service.query({ until: '2026-99-99' })).toThrow(EnterpriseValidationError);
  });

  it('returns the newest entries first', () => {
    const timestamps = ['2026-08-01T00:00:00.000Z', '2026-08-03T00:00:00.000Z', '2026-08-02T00:00:00.000Z'];
    const service = new AuditService({ now: () => timestamps.shift() ?? '2026-01-01T00:00:00.000Z' });
    service.record({ tenantId: 't1', actorId: 'u1', action: 'a', resourceType: 'org', resourceId: 'r1' });
    service.record({ tenantId: 't1', actorId: 'u1', action: 'b', resourceType: 'org', resourceId: 'r1' });
    service.record({ tenantId: 't1', actorId: 'u1', action: 'c', resourceType: 'org', resourceId: 'r1' });
    expect(service.query({ tenantId: 't1' }).map((e) => e.action)).toEqual(['b', 'c', 'a']);
  });

  it('fetches single entries with tenant isolation', () => {
    const service = makeService();
    const entry = service.record({ tenantId: 't1', actorId: 'u1', action: 'a', resourceType: 'org', resourceId: 'r1' });
    expect(service.get('t1', entry.entryId).entryId).toBe(entry.entryId);
    expect(() => service.get('t2', entry.entryId)).toThrow(EnterpriseIsolationError);
    expect(() => service.get('t1', 'aud_missing')).toThrow(EnterpriseNotFoundError);
  });

  it('purges entries older than a cutoff', () => {
    const service = makeService('2026-08-06T12:00:00.000Z');
    service.record({ tenantId: 't1', actorId: 'u1', action: 'a', resourceType: 'org', resourceId: 'r1' });
    service.record({ tenantId: 't1', actorId: 'u1', action: 'b', resourceType: 'org', resourceId: 'r1' });
    service.record({ tenantId: 't2', actorId: 'u1', action: 'c', resourceType: 'org', resourceId: 'r1' });
    const shifted = service.query({ tenantId: 't1' });
    expect(shifted).toHaveLength(2);
    expect(service.purgeOlderThan('t1', '2026-08-06')).toBe(0);
    expect(service.purgeOlderThan('t1', '2027-01-01')).toBe(2);
    expect(service.count('t1')).toBe(0);
    expect(service.count('t2')).toBe(1);
  });

  it('purges expired entries based on retention and validates cutoffs', () => {
    const service = makeService('2026-08-06T12:00:00.000Z');
    service.record({ tenantId: 't1', actorId: 'u1', action: 'a', resourceType: 'org', resourceId: 'r1' });
    expect(service.purgeExpired('t1')).toBe(0);
    expect(() => service.purgeOlderThan('t1', 'bad')).toThrow(EnterpriseValidationError);
  });
});
