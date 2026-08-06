/**
 * Billing: plan catalog, subscriptions and entitlement enforcement. Plan
 * limits are compared against live usage to compute `allowed`/`remaining`
 * for each resource, and lifecycle events are emitted to a `BillingEventSink`
 * (and forwarded to an external `BillingHook`) when configured.
 */

import { EnterpriseBillingError, EnterpriseConflictError, EnterpriseNotFoundError, EnterpriseValidationError } from './errors.js';
import type {
  BillingEvent,
  BillingEventSink,
  BillingHook,
  BillingLimits,
  BillingPlan,
  BillingPlanInput,
  BillingUsage,
  EntitlementResource,
  Subscription,
  SubscriptionStatus,
  TenantEntitlements,
} from './types.js';
import { newId } from './utils.js';

export interface BillingServiceOptions {
  now?: () => string;
  id?: () => string;
  hook?: BillingHook;
  sink?: BillingEventSink;
}

export interface SubscribeOptions {
  trialDays?: number;
}

const DEFAULT_LIMITS: Record<string, BillingLimits> = {
  free: { seats: 5, apiKeys: 2, webhooks: 1, auditRetentionDays: 30 },
  pro: { seats: 25, apiKeys: 10, webhooks: 5, auditRetentionDays: 180 },
  enterprise: { seats: 500, apiKeys: 100, webhooks: 25, auditRetentionDays: 730 },
};

const RESOURCES: readonly EntitlementResource[] = ['seats', 'apiKeys', 'webhooks'];

export function defaultPlans(): BillingPlan[] {
  return [
    {
      planId: 'free',
      name: 'Free',
      priceMonthly: 0,
      currency: 'usd',
      features: ['Unlimited reports', '1 project'],
      limits: DEFAULT_LIMITS['free'] as BillingLimits,
      active: true,
    },
    {
      planId: 'pro',
      name: 'Pro',
      priceMonthly: 29,
      currency: 'usd',
      features: ['Unlimited reports', '10 projects', 'Scheduled reports'],
      limits: DEFAULT_LIMITS['pro'] as BillingLimits,
      active: true,
    },
    {
      planId: 'enterprise',
      name: 'Enterprise',
      priceMonthly: 199,
      currency: 'usd',
      features: ['Unlimited everything', 'SSO', 'Dedicated support'],
      limits: DEFAULT_LIMITS['enterprise'] as BillingLimits,
      active: true,
    },
  ];
}

export class BillingService {
  private readonly plans = new Map<string, BillingPlan>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly usage = new Map<string, BillingUsage>();
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly hook?: BillingHook;
  private readonly sink?: BillingEventSink;

  constructor(options: BillingServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => newId('sub'));
    this.hook = options.hook;
    this.sink = options.sink;
    for (const plan of defaultPlans()) {
      this.plans.set(plan.planId, plan);
    }
  }

  // -------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------

  createPlan(input: BillingPlanInput): BillingPlan {
    const planId = input.planId ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (this.plans.has(planId)) {
      throw new EnterpriseConflictError(`Plan '${planId}' already exists.`, { planId });
    }
    const plan: BillingPlan = {
      planId,
      name: input.name.trim(),
      priceMonthly: input.priceMonthly ?? 0,
      currency: input.currency ?? 'usd',
      features: input.features === undefined ? [] : input.features.slice(),
      limits: mergeLimits(DEFAULT_LIMITS['free'] as BillingLimits, input.limits),
      active: input.active ?? true,
    };
    this.plans.set(plan.planId, plan);
    return { ...plan };
  }

  updatePlan(planId: string, patch: Partial<Omit<BillingPlan, 'planId' | 'limits'>> & { limits?: Partial<BillingLimits> }): BillingPlan {
    const plan = this.getPlanOrThrow(planId);
    if (patch.name !== undefined) plan.name = patch.name.trim();
    if (patch.priceMonthly !== undefined) plan.priceMonthly = patch.priceMonthly;
    if (patch.currency !== undefined) plan.currency = patch.currency;
    if (patch.features !== undefined) plan.features = patch.features.slice();
    if (patch.limits !== undefined) plan.limits = { ...plan.limits, ...patch.limits };
    if (patch.active !== undefined) plan.active = patch.active;
    return { ...plan };
  }

  deactivatePlan(planId: string): BillingPlan {
    const plan = this.getPlanOrThrow(planId);
    plan.active = false;
    return { ...plan };
  }

  listPlans(activeOnly = false): BillingPlan[] {
    return [...this.plans.values()]
      .filter((plan) => !activeOnly || plan.active)
      .map((plan) => ({ ...plan }));
  }

  getPlan(planId: string): BillingPlan {
    return { ...this.getPlanOrThrow(planId) };
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  async subscribe(tenantId: string, planId: string, options: SubscribeOptions = {}): Promise<Subscription> {
    const plan = this.getPlanOrThrow(planId);
    if (!plan.active) {
      throw new EnterpriseValidationError(`Plan '${planId}' is not available.`, { tenantId, planId });
    }
    if (this.subscriptions.has(tenantId)) {
      throw new EnterpriseConflictError(`Tenant '${tenantId}' already has a subscription.`, { tenantId });
    }
    try {
      await this.hook?.subscribe(tenantId, planId);
    } catch (cause) {
      throw new EnterpriseBillingError(`Failed to subscribe tenant '${tenantId}' to '${planId}'.`, { tenantId, planId }, cause);
    }
    const timestamp = this.now();
    const trialDays = Math.max(options.trialDays ?? 0, 0);
    const status: SubscriptionStatus = trialDays > 0 ? 'trialing' : 'active';
    const subscription: Subscription = {
      subscriptionId: this.id(),
      tenantId,
      planId,
      status,
      currentPeriodStart: timestamp,
      currentPeriodEnd: addDaysIso(timestamp, trialDays > 0 ? trialDays : 30),
      seatsUsed: 0,
      cancelAtPeriodEnd: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.subscriptions.set(tenantId, subscription);
    await this.emit('subscription.created', tenantId, { planId, status });
    return { ...subscription };
  }

  async getSubscription(tenantId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(tenantId);
    if (subscription === undefined) {
      throw new EnterpriseNotFoundError(`Tenant '${tenantId}' has no subscription.`, { tenantId });
    }
    return { ...subscription };
  }

  async cancelSubscription(tenantId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(tenantId);
    if (subscription === undefined) {
      throw new EnterpriseNotFoundError(`Tenant '${tenantId}' has no subscription.`, { tenantId });
    }
    try {
      await this.hook?.cancel(tenantId);
    } catch (cause) {
      throw new EnterpriseBillingError(`Failed to cancel subscription for tenant '${tenantId}'.`, { tenantId }, cause);
    }
    subscription.status = 'canceled';
    subscription.cancelAtPeriodEnd = true;
    subscription.updatedAt = this.now();
    await this.emit('subscription.canceled', tenantId, { planId: subscription.planId });
    return { ...subscription };
  }

  async changePlan(tenantId: string, planId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(tenantId);
    if (subscription === undefined) {
      throw new EnterpriseNotFoundError(`Tenant '${tenantId}' has no subscription.`, { tenantId });
    }
    const plan = this.getPlanOrThrow(planId);
    if (!plan.active) {
      throw new EnterpriseValidationError(`Plan '${planId}' is not available.`, { tenantId, planId });
    }
    if (subscription.planId !== planId) {
      try {
        await this.hook?.subscribe(tenantId, planId);
      } catch (cause) {
        throw new EnterpriseBillingError(`Failed to change tenant '${tenantId}' to plan '${planId}'.`, { tenantId, planId }, cause);
      }
      subscription.planId = planId;
      subscription.status = 'active';
      subscription.updatedAt = this.now();
    }
    await this.emit('subscription.updated', tenantId, { planId });
    return { ...subscription };
  }

  /** Records a billing usage sample for a metric. */
  async recordUsage(tenantId: string, metric: string, amount: number): Promise<BillingUsage> {
    const usage: BillingUsage = {
      usageId: this.id(),
      tenantId,
      metric,
      amount,
      recordedAt: this.now(),
    };
    this.usage.set(usage.usageId, usage);
    try {
      await this.hook?.syncUsage(tenantId, metric, amount);
    } catch (cause) {
      throw new EnterpriseBillingError(`Failed to sync usage for tenant '${tenantId}'.`, { tenantId, metric }, cause);
    }
    await this.emit('usage.recorded', tenantId, { metric, amount });
    return { ...usage };
  }

  /** Updates the number of seats a subscription is billed for. */
  async syncSeats(tenantId: string, seatsUsed: number): Promise<Subscription> {
    const subscription = this.subscriptions.get(tenantId);
    if (subscription === undefined) {
      throw new EnterpriseNotFoundError(`Tenant '${tenantId}' has no subscription.`, { tenantId });
    }
    if (seatsUsed < 0) {
      throw new EnterpriseValidationError('Seats used cannot be negative.', { tenantId });
    }
    if (subscription.seatsUsed !== seatsUsed) {
      subscription.seatsUsed = seatsUsed;
      subscription.updatedAt = this.now();
      await this.emit('subscription.updated', tenantId, { planId: subscription.planId, seatsUsed });
    }
    return { ...subscription };
  }

  /** Computes entitlements from plan limits and current usage. */
  async entitlements(tenantId: string, usage: Partial<Record<EntitlementResource, number>> = {}): Promise<TenantEntitlements> {
    const subscription = this.subscriptions.get(tenantId);
    const plan = subscription === undefined ? null : (this.plans.get(subscription.planId) ?? null);
    const limits = plan === null ? { seats: 0, apiKeys: 0, webhooks: 0, auditRetentionDays: 0 } : { ...plan.limits };
    const counts: Record<EntitlementResource, number> = { seats: 0, apiKeys: 0, webhooks: 0 };
    for (const resource of RESOURCES) {
      counts[resource] = Math.max(usage[resource] ?? 0, 0);
    }
    const allowed: Record<EntitlementResource, boolean> = { seats: false, apiKeys: false, webhooks: false };
    const remaining: Record<EntitlementResource, number> = { seats: 0, apiKeys: 0, webhooks: 0 };
    for (const resource of RESOURCES) {
      allowed[resource] = counts[resource] < limits[resource];
      remaining[resource] = Math.max(limits[resource] - counts[resource], 0);
    }
    return {
      tenantId,
      plan: plan === null ? null : { ...plan },
      limits,
      usage: counts,
      allowed,
      remaining,
    };
  }

  async listUsage(tenantId: string): Promise<BillingUsage[]> {
    return [...this.usage.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => ({ ...entry }));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private getPlanOrThrow(planId: string): BillingPlan {
    const plan = this.plans.get(planId);
    if (plan === undefined) {
      throw new EnterpriseNotFoundError(`Plan '${planId}' not found.`, { planId });
    }
    return plan;
  }

  private async emit(
    type: BillingEvent['type'],
    tenantId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.sink === undefined) return;
    const event: BillingEvent = { id: this.id(), tenantId, type, occurredAt: this.now(), payload };
    await this.sink.emit(event);
  }
}

function mergeLimits(base: BillingLimits, patch: Partial<BillingLimits> | undefined): BillingLimits {
  return {
    seats: patch?.seats ?? base.seats,
    apiKeys: patch?.apiKeys ?? base.apiKeys,
    webhooks: patch?.webhooks ?? base.webhooks,
    auditRetentionDays: patch?.auditRetentionDays ?? base.auditRetentionDays,
  };
}

function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms + days * 86_400_000).toISOString();
}
