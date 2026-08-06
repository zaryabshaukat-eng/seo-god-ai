import { describe, expect, it } from 'vitest';
import {
  EnterpriseConflictError,
  EnterpriseIsolationError,
  EnterpriseNotFoundError,
  EnterpriseValidationError,
} from './errors.js';
import {
  TenantScopedCollection,
  TenantService,
  assertSameTenant,
  assertTenantContext,
  currentTenantId,
  scopeRecords,
  withTenantScope,
} from './tenant.js';

describe('TenantService', () => {
  it('provisions tenants with generated ids and default plan', async () => {
    const service = new TenantService({ now: () => '2026-01-01T00:00:00.000Z' });
    const tenant = await service.provision({ name: 'Acme', slug: 'acme' });
    expect(tenant.tenantId).toMatch(/^tnt_/);
    expect(tenant.slug).toBe('acme');
    expect(tenant.status).toBe('active');
    expect(tenant.planId).toBe('free');
    expect(tenant.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects invalid and duplicate slugs', async () => {
    const service = new TenantService();
    await service.provision({ name: 'Acme', slug: 'acme' });
    await expect(service.provision({ name: 'Other', slug: 'acme' })).rejects.toThrow(EnterpriseConflictError);
    await expect(service.provision({ name: 'Bad', slug: 'UPPER' })).rejects.toThrow(EnterpriseValidationError);
    await expect(service.provision({ name: 'Bad', slug: 'a' })).rejects.toThrow(EnterpriseValidationError);
  });

  it('lists, suspends, activates and soft-deletes tenants', async () => {
    const service = new TenantService();
    const tenant = await service.provision({ name: 'Acme', slug: 'acme' });
    const suspended = await service.suspend(tenant.tenantId);
    expect(suspended.status).toBe('suspended');
    await expect(service.suspend(tenant.tenantId)).rejects.toThrow(EnterpriseConflictError);
    await expect(service.assertActive(tenant.tenantId)).rejects.toThrow(EnterpriseValidationError);

    const active = await service.activate(tenant.tenantId);
    expect(active.status).toBe('active');
    await expect(service.activate(tenant.tenantId)).rejects.toThrow(EnterpriseConflictError);
    await service.assertActive(tenant.tenantId);

    await service.remove(tenant.tenantId);
    await expect(service.assertActive(tenant.tenantId)).rejects.toThrow(EnterpriseValidationError);
    expect((await service.list()).length).toBe(1);
  });

  it('throws NotFoundError for unknown tenants', async () => {
    const service = new TenantService();
    await expect(service.get('tnt_missing')).rejects.toThrow(EnterpriseNotFoundError);
    await expect(service.suspend('tnt_missing')).rejects.toThrow(EnterpriseNotFoundError);
  });

  it('isolates copies so callers cannot mutate stored state', async () => {
    const service = new TenantService();
    const tenant = await service.provision({ name: 'Acme', slug: 'acme' });
    tenant.name = 'Mutated';
    const fetched = await service.get(tenant.tenantId);
    expect(fetched.name).toBe('Acme');
  });
});

describe('tenant isolation', () => {
  it('assertSameTenant rejects cross-tenant records', () => {
    expect(() => assertSameTenant('t1', 't1')).not.toThrow();
    expect(() => assertSameTenant('t1', 't2')).toThrow(EnterpriseIsolationError);
  });

  it('scopeRecords filters a list to one tenant', () => {
    const records = [
      { tenantId: 't1', id: 'a' },
      { tenantId: 't2', id: 'b' },
      { tenantId: 't1', id: 'c' },
    ];
    expect(scopeRecords(records, 't1').map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('withTenantScope establishes a request-scoped context', async () => {
    expect(currentTenantId()).toBeNull();
    let inside = 'unset';
    await withTenantScope('t1', async () => {
      inside = currentTenantId() ?? 'none';
      expect(currentTenantId()).toBe('t1');
      expect(() => assertTenantContext('t1')).not.toThrow();
      expect(() => assertTenantContext('t2')).toThrow(EnterpriseIsolationError);
    });
    expect(inside).toBe('t1');
    expect(currentTenantId()).toBeNull();
  });

  it('TenantScopedCollection enforces isolation on every operation', async () => {
    const collection = new TenantScopedCollection<{ tenantId: string; id: string; value: number }>('t1', (r) => r.id);
    collection.save({ tenantId: 't1', id: 'a', value: 1 });
    collection.save({ tenantId: 't1', id: 'b', value: 2 });
    expect(collection.size).toBe(2);
    expect(collection.find('a')?.value).toBe(1);
    expect(collection.find('zz')).toBeNull();
    expect(collection.list().map((r) => r.id)).toEqual(['a', 'b']);
    expect(collection.delete('a')).toBe(true);
    expect(collection.delete('a')).toBe(false);
    expect(collection.size).toBe(1);

    expect(() => collection.save({ tenantId: 't2', id: 'x', value: 3 })).toThrow(EnterpriseIsolationError);
    collection.save({ tenantId: 't1', id: 'c', value: 3 });
    expect(() => collection.find('c')).not.toThrow();
    expect(() => collection.delete('b')).not.toThrow();
  });

  it('isolates one collection from another tenant', () => {
    const t1 = new TenantScopedCollection<{ tenantId: string; id: string }>('t1', (r) => r.id);
    const t2 = new TenantScopedCollection<{ tenantId: string; id: string }>('t2', (r) => r.id);
    t1.save({ tenantId: 't1', id: 'a' });
    t2.save({ tenantId: 't2', id: 'b' });
    expect(t1.list()).toHaveLength(1);
    expect(t2.list()).toHaveLength(1);
  });
});
