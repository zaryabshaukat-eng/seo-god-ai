/**
 * Enterprise domain types. Every record carries a `tenantId` so isolation is
 * structural: reads/writes are scoped per tenant and cross-tenant access is
 * rejected by the isolation guards in `tenant.ts`.
 */

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export type TenantStatus = 'active' | 'suspended' | 'deleted';

export interface Tenant {
  tenantId: string;
  name: string;
  slug: string;
  status: TenantStatus;
  planId: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface TenantInput {
  name: string;
  slug: string;
  planId?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Organizations & teams
// ---------------------------------------------------------------------------

export interface Organization {
  organizationId: string;
  tenantId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  teamId: string;
  tenantId: string;
  organizationId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface CustomRole {
  name: string;
  permissions: readonly string[];
}

export interface OrganizationMember {
  membershipId: string;
  tenantId: string;
  organizationId: string;
  userId: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  teamMemberId: string;
  tenantId: string;
  teamId: string;
  userId: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

export type ActorType = 'user' | 'system' | 'api_key' | 'webhook';

export interface AuditLogEntry {
  entryId: string;
  tenantId: string;
  actorId: string;
  actorType: ActorType;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  requestId?: string;
  occurredAt: string;
}

export interface AuditRecordInput {
  tenantId: string;
  actorId: string;
  actorType?: ActorType;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  requestId?: string;
}

export interface AuditFilter {
  tenantId?: string;
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  since?: string;
  until?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export type ApiKeyStatus = 'active' | 'revoked';

export type ApiKeyScope =
  | 'tenant.read'
  | 'tenant.write'
  | 'orgs.read'
  | 'orgs.write'
  | 'teams.write'
  | 'audit.read'
  | 'apikeys.manage'
  | 'webhooks.manage'
  | 'billing.read'
  | 'billing.manage';

export interface ApiKeyRecord {
  keyId: string;
  tenantId: string;
  name: string;
  /** Publicly displayable prefix (never a usable key). */
  prefix: string;
  scopes: readonly ApiKeyScope[];
  status: ApiKeyStatus;
  createdBy: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}

export interface ApiKeyCredentials {
  keyId: string;
  tenantId: string;
  /** One-time plaintext; never stored after creation. */
  key: string;
  prefix: string;
  scopes: readonly ApiKeyScope[];
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookEventLike {
  id: string;
  tenantId: string;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface WebhookEndpoint {
  webhookId: string;
  tenantId: string;
  url: string;
  secret: string;
  events: readonly string[];
  enabled: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type WebhookDeliveryStatus = 'delivered' | 'failed' | 'expired';

export interface WebhookDeliveryAttempt {
  attemptId: string;
  webhookId: string;
  tenantId: string;
  eventId: string;
  status: WebhookDeliveryStatus;
  attemptNumber: number;
  httpStatus?: number;
  error?: string;
  attemptedAt: string;
}

export interface WebhookDeliveryResult {
  webhookId: string;
  eventId: string;
  attempts: WebhookDeliveryAttempt[];
  delivered: boolean;
}

/** Structural subset of the HTTP client used to deliver webhooks. */
export interface WebhookDeliverer {
  deliver(
    endpoint: WebhookEndpoint,
    event: WebhookEventLike,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number }>;
}

export interface WebhookDeliveryOptions {
  attempts?: number;
  backoffMs?: number;
  now?: () => string;
  delay?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export interface BillingLimits {
  seats: number;
  apiKeys: number;
  webhooks: number;
  auditRetentionDays: number;
}

export interface BillingPlan {
  planId: string;
  name: string;
  priceMonthly: number;
  currency: string;
  features: readonly string[];
  limits: BillingLimits;
  active: boolean;
}

export interface BillingPlanInput {
  planId?: string;
  name: string;
  priceMonthly?: number;
  currency?: string;
  features?: readonly string[];
  limits?: Partial<BillingLimits>;
  active?: boolean;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface Subscription {
  subscriptionId: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  seatsUsed: number;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EntitlementResource = 'seats' | 'apiKeys' | 'webhooks';

export interface BillingUsage {
  usageId: string;
  tenantId: string;
  metric: string;
  amount: number;
  recordedAt: string;
}

export interface TenantEntitlements {
  tenantId: string;
  plan: BillingPlan | null;
  limits: BillingLimits;
  usage: Record<EntitlementResource, number>;
  allowed: Record<EntitlementResource, boolean>;
  remaining: Record<EntitlementResource, number>;
}

export interface BillingEvent {
  id: string;
  tenantId: string;
  type: 'subscription.created' | 'subscription.canceled' | 'subscription.updated' | 'usage.recorded';
  occurredAt: string;
  payload: Record<string, unknown>;
}

/** Structural subset of an external billing provider (Stripe, Chargebee, …). */
export interface BillingHook {
  createCustomer(tenantId: string, name: string): Promise<string>;
  subscribe(tenantId: string, planId: string): Promise<void>;
  cancel(tenantId: string): Promise<void>;
  syncUsage(tenantId: string, metric: string, amount: number): Promise<void>;
}

/** Structural event sink for billing lifecycle events. */
export interface BillingEventSink {
  emit(event: BillingEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export interface IdGenerator {
  (): string;
}

export interface Clock {
  (): string;
}
