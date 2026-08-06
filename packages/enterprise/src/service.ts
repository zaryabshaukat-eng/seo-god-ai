/**
 * `EnterpriseService` — the composition root for the enterprise package. It
 * wires the tenant, org/team, audit, API key, webhook and billing services
 * under one facade and offers cross-cutting conveniences: scoped execution,
 * entitlement enforcement and composite usage counting.
 */

import { ApiKeyService } from './apikeys.js';
import { AuditService } from './audit.js';
import { BillingService } from './billing.js';
import { EnterpriseLimitError } from './errors.js';
import { EnterpriseMetrics } from './metrics.js';
import { OrgService } from './orgs.js';
import { Permissions, RoleManager, type Permission } from './rbac.js';
import { TenantService, withTenantScope } from './tenant.js';
import type { EntitlementResource, TenantEntitlements } from './types.js';
import { WebhookService, type WebhookServiceOptions } from './webhooks.js';
import type { BillingEventSink, BillingHook, WebhookDeliverer } from './types.js';

export interface EnterpriseServiceOptions {
  now?: () => string;
  id?: () => string;
  roleManager?: RoleManager;
  auditRetentionDays?: number;
  webhookDeliverer?: WebhookDeliverer;
  webhookDelay?: WebhookServiceOptions['delay'];
  billingHook?: BillingHook;
  billingSink?: BillingEventSink;
  metrics?: EnterpriseMetrics;
}

export class EnterpriseService {
  readonly tenant: TenantService;
  readonly orgs: OrgService;
  readonly audit: AuditService;
  readonly apiKeys: ApiKeyService;
  readonly webhooks: WebhookService;
  readonly billing: BillingService;
  readonly rbac: RoleManager;
  readonly metrics: EnterpriseMetrics;

  constructor(options: EnterpriseServiceOptions = {}) {
    const rbac = options.roleManager ?? new RoleManager();
    this.rbac = rbac;
    this.tenant = new TenantService({ now: options.now, id: options.id });
    this.orgs = new OrgService({ now: options.now, id: options.id, roleManager: rbac });
    this.audit = new AuditService({ now: options.now, id: options.id, retentionDays: options.auditRetentionDays });
    this.apiKeys = new ApiKeyService({ now: options.now, id: options.id });
    this.webhooks = new WebhookService({
      now: options.now,
      id: options.id,
      deliverer: options.webhookDeliverer,
      delay: options.webhookDelay,
    });
    this.billing = new BillingService({ now: options.now, id: options.id, hook: options.billingHook, sink: options.billingSink });
    this.metrics = options.metrics ?? new EnterpriseMetrics();
  }

  /** Runs `fn` inside the tenant context established by `withTenantScope`. */
  async runInTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return withTenantScope(tenantId, fn);
  }

  /** RBAC guard delegating to the shared `RoleManager`. */
  authorize(role: string, permission: Permission, context: { userId?: string; tenantId?: string } = {}): void {
    this.rbac.requirePermission(role, permission, context);
  }

  /**
   * Composes live usage from the org/API key/webhook services and computes the
   * tenant's entitlements against its current plan.
   */
  async entitlementsFor(tenantId: string): Promise<TenantEntitlements> {
    const organizations = await this.orgs.listOrganizations(tenantId);
    let seats = 0;
    for (const organization of organizations) {
      seats += (await this.orgs.listMembers(tenantId, organization.organizationId)).length;
    }
    const apiKeys = (await this.apiKeys.listKeys(tenantId)).filter((key) => key.status === 'active').length;
    const webhooks = (await this.webhooks.listEndpoints(tenantId)).filter((endpoint) => endpoint.enabled).length;
    return this.billing.entitlements(tenantId, { seats, apiKeys, webhooks });
  }

  /** Throws when the tenant has exhausted the entitlement for a resource. */
  async enforceEntitlement(tenantId: string, resource: EntitlementResource): Promise<TenantEntitlements> {
    const entitlements = await this.entitlementsFor(tenantId);
    if (!entitlements.allowed[resource]) {
      throw new EnterpriseLimitError(
        `Tenant '${tenantId}' has exceeded its '${resource}' limit.`,
        { tenantId, permission: resource },
      );
    }
    return entitlements;
  }

  /** Authenticates a plaintext API key scoped to a tenant. */
  verifyApiKey(plaintext: string, tenantId: string) {
    return this.apiKeys.verifyKey(plaintext, tenantId);
  }

  /** Convenience accessor for the full permission constant set. */
  static readonly Permissions = Permissions;
}
