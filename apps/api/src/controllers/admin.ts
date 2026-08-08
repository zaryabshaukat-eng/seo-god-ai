/**
 * Enterprise administration endpoints: tenants, organizations, teams,
 * members, audit log, API keys, webhooks and billing. Mutations require the
 * `admin.write` permission; reads require `admin.read`. Everything is scoped
 * to the caller's tenant so the platform admin surface never crosses tenant
 * boundaries.
 */

import type { Platform } from '../platform.js';
import type { Router } from '../router.js';
import { bodyAs, requireParam } from '../context.js';
import { NotFoundError } from '../errors.js';
import { guard } from '../guards.js';
import { sendJson } from '../http.js';
import { PlatformPermissions, type Role } from '../permissions.js';
import { optionalNumber, optionalString, requireEmail, requireEnum, requireString } from '../validation.js';

const API_KEY_SCOPES = [
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
] as const;

const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

function tenantShape(platform: Platform, tenant: {
  tenantId: string;
  name: string;
  planId: string;
  status: string;
  createdAt: string;
}): Record<string, unknown> {
  return {
    id: tenant.tenantId,
    name: tenant.name,
    plan: tenant.planId,
    status: tenant.status,
    users: platform.auth.listUsers(tenant.tenantId).length,
    stores: 0,
    createdAt: Date.parse(tenant.createdAt),
  };
}

function memberShape(user: {
  userId: string;
  email: string;
  name: string;
  role: string;
}): Record<string, unknown> {
  return {
    id: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
    status: 'active',
  };
}

function apiKeyShape(key: {
  keyId: string;
  name: string;
  prefix: string;
  scopes: readonly string[];
  status: string;
  createdAt: string;
  lastUsedAt?: string;
}): Record<string, unknown> {
  return {
    id: key.keyId,
    label: key.name,
    prefix: key.prefix,
    scopes: [...key.scopes],
    createdAt: Date.parse(key.createdAt),
    lastUsedAt: key.lastUsedAt === undefined ? undefined : Date.parse(key.lastUsedAt),
    enabled: key.status === 'active',
  };
}

export function registerAdminRoutes(platform: Platform, router: Router): void {
  router.on(
    'GET',
    '/api/v1/admin/tenants',
    guard(platform, { permission: PlatformPermissions.adminRead }, async (ctx) => {
      const tenants = await platform.enterprise.tenant.list();
      const visible = tenants.filter((tenant) => tenant.tenantId === ctx.tenantId);
      sendJson(ctx.res, 200, { tenants: visible.map((tenant) => tenantShape(platform, tenant)) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/admin/tenants',
    guard(platform, { permission: PlatformPermissions.adminWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const name = requireString(body, 'name', 'Name');
      const planId = optionalString(body, 'planId') ?? 'free';
      const slug = optionalString(body, 'slug');
      const tenant = await platform.enterprise.tenant.provision({
        name,
        slug: slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32),
        planId,
      });
      await platform.enterprise.billing.subscribe(tenant.tenantId, planId).catch(() => undefined);
      sendJson(ctx.res, 201, { tenant: tenantShape(platform, tenant) });
    }),
  );

  router.on(
    'GET',
    '/api/v1/admin/orgs',
    guard(platform, { permission: PlatformPermissions.adminRead }, async (ctx) => {
      const tenantId = ctx.tenantId ?? '';
      const orgs = await platform.enterprise.orgs.listOrganizations(tenantId);
      sendJson(ctx.res, 200, {
        orgs: orgs.map((org) => ({ id: org.organizationId, tenantId: org.tenantId, name: org.name })),
      });
    }),
  );

  router.on(
    'GET',
    '/api/v1/admin/teams',
    guard(platform, { permission: PlatformPermissions.adminRead }, async (ctx) => {
      const tenantId = ctx.tenantId ?? '';
      const organizationId = optionalString({ organizationId: ctx.query.get('organizationId') ?? undefined }, 'organizationId');
      const teams = await platform.enterprise.orgs.listTeams(tenantId, organizationId);
      const teamsWithCounts = await Promise.all(
        teams.map(async (team) => {
          const members = await platform.enterprise.orgs.listTeamMembers(tenantId, team.teamId);
          return { id: team.teamId, orgId: team.organizationId, name: team.name, memberCount: members.length };
        }),
      );
      sendJson(ctx.res, 200, { teams: teamsWithCounts });
    }),
  );

  router.on(
    'GET',
    '/api/v1/admin/members',
    guard(platform, { permission: PlatformPermissions.adminRead }, async (ctx) => {
      const tenantId = ctx.tenantId ?? '';
      const users = platform.auth.listUsers(tenantId);
      sendJson(ctx.res, 200, { members: users.map(memberShape) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/admin/members/invite',
    guard(platform, { permission: PlatformPermissions.adminWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const tenantId = ctx.tenantId ?? '';
      const email = requireEmail(body, 'email');
      const role = requireEnum(body, 'role', ROLES, 'Role');
      const name = optionalString(body, 'name') ?? email;
      const orgs = await platform.enterprise.orgs.listOrganizations(tenantId);
      const firstOrg = orgs[0];
      if (firstOrg === undefined) {
        throw new NotFoundError('No organization exists for this tenant.');
      }
      const organizationId = optionalString(body, 'organizationId') ?? firstOrg.organizationId;
      const user = await platform.auth.inviteUser({ tenantId, organizationId, email, name, role });
      sendJson(ctx.res, 201, { member: memberShape(user) });
    }),
  );

  router.on(
    'PATCH',
    '/api/v1/admin/members/:id/role',
    guard(platform, { permission: PlatformPermissions.adminWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const role = requireEnum(body, 'role', ROLES, 'Role') as Role;
      const user = await platform.auth.updateUserRole(ctx.tenantId ?? '', requireParam(ctx, 'id'), role);
      sendJson(ctx.res, 200, { member: memberShape(user) });
    }),
  );

  router.on(
    'GET',
    '/api/v1/admin/audit',
    guard(platform, { permission: PlatformPermissions.adminRead }, async (ctx) => {
      const limit = optionalNumber({ limit: ctx.query.get('limit') ?? undefined }, 'limit');
      const action = optionalString({ action: ctx.query.get('action') ?? undefined }, 'action');
      const entries = platform.enterprise.audit.query({
        tenantId: ctx.tenantId ?? '',
        action,
        limit,
      });
      sendJson(ctx.res, 200, {
        entries: entries.map((entry) => ({
          id: entry.entryId,
          at: Date.parse(entry.occurredAt),
          actor: entry.actorId,
          action: entry.action,
          target: `${entry.resourceType}:${entry.resourceId}`,
          outcome: entry.metadata?.outcome === 'failure' ? 'failure' : 'success',
        })),
      });
    }),
  );

  router.on(
    'GET',
    '/api/v1/admin/api-keys',
    guard(platform, { permission: PlatformPermissions.adminRead }, async (ctx) => {
      const keys = await platform.enterprise.apiKeys.listKeys(ctx.tenantId ?? '');
      sendJson(ctx.res, 200, { apiKeys: keys.map(apiKeyShape) });
    }),
  );

  router.on(
    'POST',
    '/api/v1/admin/api-keys',
    guard(platform, { permission: PlatformPermissions.adminWrite }, async (ctx) => {
      const body = bodyAs<Record<string, unknown>>(ctx) ?? {};
      const label = requireString(body, 'label', 'Label');
      const scopes = optionalString(body, 'scopes');
      const expiresInDays = optionalNumber(body, 'expiresInDays');
      const granted = scopes === undefined
        ? ['tenant.read']
        : scopes.split(',').map((scope) => scope.trim()).filter((scope) => (API_KEY_SCOPES as readonly string[]).includes(scope));
      const { record, key } = platform.enterprise.apiKeys.issueKey(ctx.tenantId ?? '', label, granted as never, {
        createdBy: ctx.principal?.userId ?? ctx.principal?.keyId ?? 'system',
        expiresInDays,
      });
      sendJson(ctx.res, 201, { apiKey: { ...apiKeyShape(record), key } });
    }),
  );

  router.on(
    'DELETE',
    '/api/v1/admin/api-keys/:id',
    guard(platform, { permission: PlatformPermissions.adminWrite }, async (ctx) => {
      const key = await platform.enterprise.apiKeys.revokeKey(ctx.tenantId ?? '', requireParam(ctx, 'id'));
      sendJson(ctx.res, 200, { apiKey: apiKeyShape(key) });
    }),
  );

  router.on(
    'GET',
    '/api/v1/admin/billing',
    guard(platform, { permission: PlatformPermissions.adminRead }, async (ctx) => {
      const tenantId = ctx.tenantId ?? '';
      const entitlements = await platform.enterprise.entitlementsFor(tenantId);
      const subscription = await platform.enterprise.billing.getSubscription(tenantId).catch(() => null);
      sendJson(ctx.res, 200, {
        plan: entitlements.plan?.planId ?? 'free',
        seats: entitlements.limits.seats,
        usedSeats: entitlements.usage.seats,
        storesLimit: 0,
        storesUsed: 0,
        nextBillingAt: subscription === null
          ? undefined
          : Date.parse(subscription.currentPeriodEnd),
      });
    }),
  );
}
