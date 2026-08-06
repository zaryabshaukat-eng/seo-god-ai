import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import type { ApiKey, AuditEntry, BillingEntitlements, Member, Tenant, Webhook } from '../types.js';
import {
  buildRoleMatrix,
  createAdminApi,
  maskApiKey,
  renderApiKeysPage,
  renderAuditPage,
  renderBillingPage,
  renderMembersPage,
  renderTenantsPage,
  renderWebhooksPage,
  roleTone,
  validateMemberInvite,
} from './enterprise.js';

describe('validateMemberInvite', () => {
  it('accepts a valid invite', () => {
    expect(validateMemberInvite({ email: 'a@b.com', role: 'member' })).toEqual({});
  });

  it('rejects a bad email', () => {
    expect(validateMemberInvite({ email: '', role: 'member' }).email).toBe('Email is required.');
    expect(validateMemberInvite({ email: 'nope', role: 'member' }).email).toBe('Enter a valid email address.');
  });

  it('rejects an unknown role', () => {
    expect(validateMemberInvite({ email: 'a@b.com', role: 'superuser' as never }).role).toBe('Choose a valid role.');
  });
});

describe('roleTone', () => {
  it('maps roles to tones', () => {
    expect(roleTone('owner')).toBe('success');
    expect(roleTone('admin')).toBe('warning');
    expect(roleTone('member')).toBe('info');
    expect(roleTone('viewer')).toBe('neutral');
  });
});

describe('maskApiKey', () => {
  it('masks the key prefix', () => {
    expect(maskApiKey('sk_live_')).toBe('sk_live_…********');
  });
});

describe('buildRoleMatrix', () => {
  it('builds a role × permission grid', () => {
    const matrix = buildRoleMatrix(['owner', 'viewer'], ['seo.read', 'billing.read']);
    expect(matrix[0]).toEqual({ role: 'owner', 'seo.read': '✓', 'billing.read': '✓' });
    expect(matrix[1]).toEqual({ role: 'viewer', 'seo.read': '✓', 'billing.read': '✓' });
  });

  it('grants read permissions to viewers', () => {
    const matrix = buildRoleMatrix(['viewer'], ['seo.read', 'seo.write']);
    expect(matrix[0]).toEqual({ role: 'viewer', 'seo.read': '✓', 'seo.write': '—' });
  });
});

const TENANTS: Tenant[] = [{ id: 't1', name: 'Acme', plan: 'pro', status: 'active', users: 5, stores: 2, createdAt: 1700000000000 }];
const MEMBERS: Member[] = [{ id: 'm1', name: 'Ada', email: 'a@b.com', role: 'admin', status: 'active', lastActiveAt: undefined }];
const AUDIT: AuditEntry[] = [{ id: 'a1', actor: 'ada@b.com', action: 'member.invite', target: 'm2', outcome: 'success', at: 1700000000000 }];
const KEYS: ApiKey[] = [{ id: 'k1', label: 'CI', prefix: 'sk_', scopes: ['seo.read'], createdAt: 1700000000000, enabled: true, lastUsedAt: undefined }];
const WEBHOOKS: Webhook[] = [{ id: 'w1', url: 'https://example.com/h', events: ['crawl.completed'], enabled: true, createdAt: 1700000000000 }];
const BILLING: BillingEntitlements = { plan: 'pro', seats: 10, usedSeats: 10, storesLimit: 5, storesUsed: 4, nextBillingAt: 1700000000000 };

describe('renderTenantsPage', () => {
  it('renders tenants with manage actions', () => {
    const html = renderToString(renderTenantsPage({ tenants: TENANTS, canWrite: true }));
    expect(html).toContain('id="tenants-table"');
    expect(html).toContain('data-action="admin:tenant:t1"');
    expect(html).toContain('badge--success');
  });

  it('renders read-only rows', () => {
    const html = renderToString(renderTenantsPage({ tenants: [], canWrite: false }));
    expect(html).toContain('No tenants.');
  });

  it('tones trial and other tenant statuses', () => {
    const html = renderToString(
      renderTenantsPage({
        tenants: [
          { id: 't2', name: 'Beta', plan: 'free', status: 'trial', users: 1, stores: 0, createdAt: 1700000000000 },
          { id: 't3', name: 'Gamma', plan: 'free', status: 'suspended', users: 0, stores: 0, createdAt: 1700000000000 },
        ],
        canWrite: false,
      }),
    );
    expect(html).toContain('badge--warning');
    expect(html).toContain('badge--danger');
    expect(html).not.toContain('admin:tenant:');
  });
});

describe('renderMembersPage', () => {
  it('renders members with role badges', () => {
    const html = renderToString(renderMembersPage({ members: MEMBERS, canWrite: true }));
    expect(html).toContain('id="members-table"');
    expect(html).toContain('badge--warning');
    expect(html).toContain('>Never</td>');
  });

  it('renders last-active dates and read-only rows', () => {
    const html = renderToString(
      renderMembersPage({
        members: [{ ...MEMBERS[0] as Member, lastActiveAt: 1700000000000 }],
        canWrite: false,
      }),
    );
    expect(html).not.toContain('>Never</td>');
    expect(html).not.toContain('admin:member:');
  });
});

describe('renderAuditPage', () => {
  it('renders audit rows with outcome badges', () => {
    const html = renderToString(renderAuditPage({ entries: AUDIT }));
    expect(html).toContain('id="audit-table"');
    expect(html).toContain('badge--success');
  });

  it('marks failed outcomes as dangerous', () => {
    const html = renderToString(renderAuditPage({ entries: [{ ...AUDIT[0] as AuditEntry, outcome: 'failure' }] }));
    expect(html).toContain('badge--danger');
  });
});

describe('renderApiKeysPage', () => {
  it('renders keys with masked prefixes and revoke actions', () => {
    const html = renderToString(renderApiKeysPage({ keys: KEYS, canWrite: true }));
    expect(html).toContain('sk_…********');
    expect(html).toContain('data-action="admin:apikey:revoke:k1"');
  });

  it('renders read-only keys', () => {
    const html = renderToString(renderApiKeysPage({ keys: [], canWrite: false }));
    expect(html).not.toContain('apikey:revoke');
  });

  it('renders key scopes, disabled and last-used variants', () => {
    const html = renderToString(
      renderApiKeysPage({
        keys: [
          { id: 'k2', label: 'Read-only', prefix: 'sk_', scopes: [], createdAt: 1700000000000, enabled: false, lastUsedAt: 1700000000000 },
        ],
        canWrite: false,
      }),
    );
    expect(html).toContain('>read-only</td>');
    expect(html).toContain('>No</td>');
    expect(html).not.toContain('>Never</td>');
  });
});

describe('renderWebhooksPage', () => {
  it('renders webhooks with edit actions', () => {
    const html = renderToString(renderWebhooksPage({ webhooks: WEBHOOKS, canWrite: true }));
    expect(html).toContain('https://example.com/h');
    expect(html).toContain('data-action="admin:webhook:w1"');
  });

  it('renders disabled webhooks read-only', () => {
    const html = renderToString(
      renderWebhooksPage({
        webhooks: [{ id: 'w2', url: 'https://example.com/x', events: [], enabled: false, createdAt: 1700000000000 }],
        canWrite: false,
      }),
    );
    expect(html).toContain('>No</td>');
    expect(html).not.toContain('admin:webhook:');
  });
});

describe('renderBillingPage', () => {
  it('renders entitlement cards', () => {
    const html = renderToString(renderBillingPage({ entitlements: BILLING }));
    expect(html).toContain('10/10');
    expect(html).toContain('4/5');
    expect(html).toContain('kpi-card--warning');
  });

  it('warns when stores are at the limit', () => {
    const html = renderToString(
      renderBillingPage({ entitlements: { plan: 'pro', seats: 10, usedSeats: 2, storesLimit: 5, storesUsed: 5, nextBillingAt: 1700000000000 } }),
    );
    expect(html).toContain('5/5');
    expect(html).toContain('kpi-card--warning');
  });
});

describe('createAdminApi', () => {
  it('wraps admin endpoints onto the client', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const api = {
      request: async <T>(method: string, url: string, body: unknown): Promise<T> => {
        calls.push({ method, url, body });
        return { ok: true } as T;
      },
    } as never;
    const adminApi = createAdminApi(api);
    await adminApi.tenants();
    await adminApi.createTenant({ name: 'Acme', plan: 'pro' });
    await adminApi.members();
    await adminApi.inviteMember({ email: 'a@b.com', role: 'member' });
    await adminApi.updateRole('m1', 'admin');
    await adminApi.audit();
    await adminApi.apiKeys();
    await adminApi.createApiKey({ label: 'CI', scopes: ['seo.read'] });
    await adminApi.revokeApiKey('k1');
    await adminApi.webhooks();
    await adminApi.createWebhook({ url: 'https://example.com/h', events: ['crawl.completed'] });
    await adminApi.billing();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/v1/admin/tenants',
      'POST /api/v1/admin/tenants',
      'GET /api/v1/admin/members',
      'POST /api/v1/admin/members/invite',
      'PATCH /api/v1/admin/members/m1/role',
      'GET /api/v1/admin/audit',
      'GET /api/v1/admin/api-keys',
      'POST /api/v1/admin/api-keys',
      'DELETE /api/v1/admin/api-keys/k1',
      'GET /api/v1/admin/webhooks',
      'POST /api/v1/admin/webhooks',
      'GET /api/v1/admin/billing',
    ]);
  });
});
