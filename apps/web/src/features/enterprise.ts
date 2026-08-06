import { createApiFunctions } from './api-helpers.js';
import { badgeEl, cardEl, tableEl } from '../ui/primitives.js';
import { gridEl, pageHeaderEl } from '../ui/layout.js';
import { className, h } from '../vdom.js';
import type { ApiClient } from '../api/client.js';
import type {
  ApiKey,
  AuditEntry,
  BillingEntitlements,
  Member,
  Permission,
  Role,
  Tenant,
  Webhook,
  VNode,
} from '../types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates a member invite. */
export function validateMemberInvite(input: { email: string; role: Role }): { email?: string; role?: string } {
  const errors: { email?: string; role?: string } = {};
  if (input.email.trim().length === 0) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(input.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  if (!['owner', 'admin', 'member', 'viewer'].includes(input.role)) {
    errors.role = 'Choose a valid role.';
  }
  return errors;
}

/** Badge tone for a member role. */
export function roleTone(role: Role): 'info' | 'warning' | 'success' | 'neutral' {
  switch (role) {
    case 'owner':
      return 'success';
    case 'admin':
      return 'warning';
    case 'member':
      return 'info';
    default:
      return 'neutral';
  }
}

/** Masks an API key prefix for display. */
export function maskApiKey(prefix: string): string {
  return `${prefix}…${'*'.repeat(8)}`;
}

/** Builds a role × permission matrix (rows of checkmarks). */
export function buildRoleMatrix(roles: readonly Role[], permissions: readonly Permission[]): Array<Record<string, VNode | string>> {
  const GRANTS: Record<Role, readonly Permission[]> = {
    owner: [...permissions],
    admin: permissions.filter((permission) => !permission.startsWith('billing.')),
    member: permissions.filter((permission) => permission.includes('read') || permission === 'execution.write'),
    viewer: permissions.filter((permission) => permission.endsWith('.read')),
  };
  return roles.map((role) => ({
    role: role,
    ...Object.fromEntries(permissions.map((permission) => [permission, GRANTS[role]?.includes(permission) ? '✓' : '—'])),
  }));
}

/** Renders the tenants administration page. */
export function renderTenantsPage(model: { tenants: Tenant[]; canWrite: boolean }): VNode {
  const rows = model.tenants.map((tenant) => ({
    name: tenant.name,
    plan: badgeEl({ label: tenant.plan, tone: 'info' }),
    status: badgeEl({ label: tenant.status, tone: tenant.status === 'active' ? 'success' : tenant.status === 'trial' ? 'warning' : 'danger' }),
    users: String(tenant.users),
    stores: String(tenant.stores),
    actions: model.canWrite ? h('a', { class: className('btn', 'btn--secondary'), href: '#', 'data-action': `admin:tenant:${tenant.id}` }, 'Manage') : '—',
  }));
  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Administration', subtitle: 'Tenants and organizations' }),
    cardEl({ title: 'Tenants', children: [tableEl({ id: 'tenants-table', caption: 'Tenants', columns: [{ key: 'name', label: 'Tenant' }, { key: 'plan', label: 'Plan' }, { key: 'status', label: 'Status' }, { key: 'users', label: 'Users', align: 'right' }, { key: 'stores', label: 'Stores', align: 'right' }, { key: 'actions', label: 'Actions' }], rows, emptyText: 'No tenants.' })] }),
  );
}

/** Renders the members administration page. */
export function renderMembersPage(model: { members: Member[]; canWrite: boolean }): VNode {
  const rows = model.members.map((member) => ({
    name: member.name,
    email: member.email,
    role: badgeEl({ label: member.role, tone: roleTone(member.role) }),
    status: member.status,
    lastActive: member.lastActiveAt !== undefined ? new Date(member.lastActiveAt).toLocaleDateString() : 'Never',
    actions: model.canWrite ? h('a', { class: className('btn', 'btn--secondary'), href: '#', 'data-action': `admin:member:${member.id}` }, 'Manage') : '—',
  }));
  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Members', subtitle: 'Teams, roles and access' }),
    cardEl({ title: 'Members', children: [tableEl({ id: 'members-table', caption: 'Members', columns: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role' }, { key: 'status', label: 'Status' }, { key: 'lastActive', label: 'Last active' }, { key: 'actions', label: 'Actions' }], rows, emptyText: 'No members.' })] }),
  );
}

/** Renders the audit log page. */
export function renderAuditPage(model: { entries: AuditEntry[] }): VNode {
  const rows = model.entries.map((entry) => ({
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    outcome: badgeEl({ label: entry.outcome, tone: entry.outcome === 'success' ? 'success' : 'danger' }),
    at: new Date(entry.at).toLocaleString(),
  }));
  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Audit log', subtitle: 'Immutable record of administrative actions' }),
    cardEl({ title: 'Audit entries', children: [tableEl({ id: 'audit-table', caption: 'Audit entries', columns: [{ key: 'actor', label: 'Actor' }, { key: 'action', label: 'Action' }, { key: 'target', label: 'Target' }, { key: 'outcome', label: 'Outcome' }, { key: 'at', label: 'When' }], rows, emptyText: 'No audit entries.' })] }),
  );
}

/** Renders the API keys page. */
export function renderApiKeysPage(model: { keys: ApiKey[]; canWrite: boolean }): VNode {
  const rows = model.keys.map((key) => ({
    label: key.label,
    key: maskApiKey(key.prefix),
    scopes: key.scopes.length > 0 ? key.scopes.join(', ') : 'read-only',
    enabled: key.enabled ? 'Yes' : 'No',
    lastUsed: key.lastUsedAt !== undefined ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never',
    actions: model.canWrite ? h('a', { class: className('btn', 'btn--danger'), href: '#', 'data-action': `admin:apikey:revoke:${key.id}` }, 'Revoke') : '—',
  }));
  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'API keys', subtitle: 'Programmatic access' }),
    cardEl({ title: 'API keys', children: [tableEl({ id: 'apikeys-table', caption: 'API keys', columns: [{ key: 'label', label: 'Label' }, { key: 'key', label: 'Key' }, { key: 'scopes', label: 'Scopes' }, { key: 'enabled', label: 'Enabled' }, { key: 'lastUsed', label: 'Last used' }, { key: 'actions', label: 'Actions' }], rows, emptyText: 'No API keys.' })] }),
  );
}

/** Renders the webhooks page. */
export function renderWebhooksPage(model: { webhooks: Webhook[]; canWrite: boolean }): VNode {
  const rows = model.webhooks.map((webhook) => ({
    url: webhook.url,
    events: webhook.events.join(', '),
    enabled: webhook.enabled ? 'Yes' : 'No',
    created: new Date(webhook.createdAt).toLocaleDateString(),
    actions: model.canWrite ? h('a', { class: className('btn', 'btn--secondary'), href: '#', 'data-action': `admin:webhook:${webhook.id}` }, 'Edit') : '—',
  }));
  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Webhooks', subtitle: 'Event delivery' }),
    cardEl({ title: 'Webhooks', children: [tableEl({ id: 'webhooks-table', caption: 'Webhooks', columns: [{ key: 'url', label: 'URL' }, { key: 'events', label: 'Events' }, { key: 'enabled', label: 'Enabled' }, { key: 'created', label: 'Created' }, { key: 'actions', label: 'Actions' }], rows, emptyText: 'No webhooks.' })] }),
  );
}

/** Renders the billing entitlements page. */
export function renderBillingPage(model: { entitlements: BillingEntitlements }): VNode {
  const e = model.entitlements;
  const cards = [
    { id: 'plan', label: 'Plan', value: e.plan, tone: 'info' },
    { id: 'seats', label: 'Seats', value: `${e.usedSeats}/${e.seats}`, tone: e.usedSeats >= e.seats ? 'warning' : 'success' },
    { id: 'stores', label: 'Stores', value: `${e.storesUsed}/${e.storesLimit}`, tone: e.storesUsed >= e.storesLimit ? 'warning' : 'success' },
  ];
  const cardsEl = cards.map((card) => h('div', { class: className('kpi-card', `kpi-card--${card.tone}`) }, h('div', { class: 'kpi-card__value' }, card.value), h('div', { class: 'kpi-card__label' }, card.label)));
  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'Billing', subtitle: `Next billing cycle: ${new Date(e.nextBillingAt).toLocaleDateString()}` }),
    gridEl(cardsEl, { sm: 1, md: 3 }),
  );
}

/** REST wrappers for enterprise administration endpoints. */
export function createAdminApi(api: ApiClient) {
  const call = createApiFunctions(api);
  return {
    tenants: () => call.get<Tenant[]>('tenantsList'),
    createTenant: (body: { name: string; plan: string }) => call.post<Tenant>('tenantsCreate', body),
    members: () => call.get<Member[]>('membersList'),
    inviteMember: (body: { email: string; role: Role }) => call.post<Member>('membersInvite', body),
    updateRole: (id: string, role: Role) => call.patch<Member>('membersUpdateRole', { role }, { id }),
    audit: () => call.get<AuditEntry[]>('auditList'),
    apiKeys: () => call.get<ApiKey[]>('apiKeysList'),
    createApiKey: (body: { label: string; scopes: Permission[] }) => call.post<ApiKey>('apiKeysCreate', body),
    revokeApiKey: (id: string) => call.del<void>('apiKeysRevoke', { id }),
    webhooks: () => call.get<Webhook[]>('webhooksList'),
    createWebhook: (body: { url: string; events: string[] }) => call.post<Webhook>('webhooksCreate', body),
    billing: () => call.get<BillingEntitlements>('billingGet'),
  };
}
