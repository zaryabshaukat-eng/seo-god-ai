import { describe, expect, it } from 'vitest';
import { EnterpriseService } from './service.js';
import { EnterpriseLimitError } from './errors.js';
import { Permissions, RoleManager } from './rbac.js';
import { EnterpriseMetrics } from './metrics.js';
import type { WebhookDeliverer } from './types.js';

const FIXED = '2026-08-06T12:00:00.000Z';

describe('EnterpriseService', () => {
  it('wires all sub-services into one facade', () => {
    const service = new EnterpriseService({ now: () => FIXED });
    expect(service.tenant).toBeDefined();
    expect(service.orgs).toBeDefined();
    expect(service.audit).toBeDefined();
    expect(service.apiKeys).toBeDefined();
    expect(service.webhooks).toBeDefined();
    expect(service.billing).toBeDefined();
    expect(service.rbac).toBeInstanceOf(RoleManager);
    expect(service.metrics).toBeInstanceOf(EnterpriseMetrics);
    expect(EnterpriseService.Permissions).toBe(Permissions);
  });

  it('runs work inside a tenant context', async () => {
    const service = new EnterpriseService();
    let seen: string | null = null;
    await service.runInTenant('t1', async () => {
      const { currentTenantId } = await import('./tenant.js');
      seen = currentTenantId();
    });
    expect(seen).toBe('t1');
  });

  it('authorizes roles against the shared manager', () => {
    const service = new EnterpriseService();
    expect(() => service.authorize('owner', Permissions.billingManage)).not.toThrow();
    expect(() => service.authorize('viewer', Permissions.webhookManage)).toThrow();
  });

  it('composes entitlements from live org/key/webhook usage', async () => {
    const service = new EnterpriseService({ now: () => FIXED });
    const tenant = await service.tenant.provision({ name: 'Acme', slug: 'acme' });
    await service.billing.subscribe(tenant.tenantId, 'free');
    const org = await service.orgs.createOrganization(tenant.tenantId, 'Acme Inc');
    await service.orgs.addMember(tenant.tenantId, org.organizationId, 'u1', 'member');
    await service.orgs.addMember(tenant.tenantId, org.organizationId, 'u2', 'member');
    service.apiKeys.issueKey(tenant.tenantId, 'ci', ['orgs.read']);
    service.webhooks.register(tenant.tenantId, { url: 'https://hooks.example.com/x', events: ['report.completed'] });

    const entitlements = await service.entitlementsFor(tenant.tenantId);
    expect(entitlements.usage.seats).toBe(2);
    expect(entitlements.usage.apiKeys).toBe(1);
    expect(entitlements.usage.webhooks).toBe(1);
    expect(entitlements.allowed.seats).toBe(true);
  });

  it('enforces entitlements and throws limit errors', async () => {
    const service = new EnterpriseService({ now: () => FIXED });
    const tenant = await service.tenant.provision({ name: 'Acme', slug: 'acme' });
    await service.billing.subscribe(tenant.tenantId, 'free');
    const org = await service.orgs.createOrganization(tenant.tenantId, 'Acme Inc');
    for (let index = 0; index < 5; index += 1) {
      await service.orgs.addMember(tenant.tenantId, org.organizationId, `u${index}`, 'member');
    }
    await expect(service.enforceEntitlement(tenant.tenantId, 'seats')).rejects.toThrow(EnterpriseLimitError);

    const entitlements = await service.enforceEntitlement(tenant.tenantId, 'apiKeys');
    expect(entitlements.allowed.apiKeys).toBe(true);
  });

  it('authenticates API keys via the facade', async () => {
    const service = new EnterpriseService({ now: () => FIXED });
    const { key } = service.apiKeys.issueKey('t1', 'ci', ['orgs.read']);
    expect(service.verifyApiKey(key, 't1')?.name).toBe('ci');
    expect(service.verifyApiKey('bogus', 't1')).toBeNull();
  });

  it('accepts custom wiring options', async () => {
    const deliverer: WebhookDeliverer = {
      async deliver() {
        return { status: 200 };
      },
    };
    const service = new EnterpriseService({
      now: () => FIXED,
      auditRetentionDays: 14,
      webhookDeliverer: deliverer,
      webhookDelay: async () => undefined,
    });
    const endpoint = service.webhooks.register('t1', { url: 'https://hooks.example.com/x', events: ['a'] });
    const result = await service.webhooks.deliver(endpoint, {
      id: 'evt_1',
      tenantId: 't1',
      type: 'a',
      createdAt: FIXED,
      payload: {},
    });
    expect(result.delivered).toBe(true);
  });
});
