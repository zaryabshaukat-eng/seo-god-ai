import { describe, expect, it, vi, type Mock } from 'vitest';
import { BillingService, defaultPlans } from './billing.js';
import { EnterpriseBillingError, EnterpriseConflictError, EnterpriseNotFoundError, EnterpriseValidationError } from './errors.js';
import type { BillingEvent, BillingEventSink, BillingHook } from './types.js';

const FIXED = '2026-08-06T12:00:00.000Z';

interface MockedBillingHook extends BillingHook {
  createCustomer: Mock;
  subscribe: Mock;
  cancel: Mock;
  syncUsage: Mock;
}

function makeHook(): MockedBillingHook {
  return {
    createCustomer: vi.fn(async () => 'cus_1'),
    subscribe: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    syncUsage: vi.fn(async () => undefined),
  };
}

function makeSink() {
  const events: BillingEvent[] = [];
  const emit = vi.fn(async (event: BillingEvent) => {
    events.push(event);
  });
  const sink: BillingEventSink = { emit };
  return { sink, events };
}

describe('BillingService plans', () => {
  it('seeds default plans', () => {
    const service = new BillingService({ now: () => FIXED });
    const plans = service.listPlans();
    expect(plans.map((p) => p.planId)).toEqual(['free', 'pro', 'enterprise']);
    expect(defaultPlans()).toHaveLength(3);
  });

  it('creates plans with derived ids and merged limits', () => {
    const service = new BillingService({ now: () => FIXED });
    const plan = service.createPlan({ name: 'Growth Plan', priceMonthly: 49, limits: { seats: 100 } });
    expect(plan.planId).toBe('growth-plan');
    expect(plan.limits).toEqual({ seats: 100, apiKeys: 2, webhooks: 1, auditRetentionDays: 30 });
    expect(() => service.createPlan({ name: 'Growth Plan' })).toThrow(EnterpriseConflictError);
  });

  it('updates, deactivates and filters plans', () => {
    const service = new BillingService({ now: () => FIXED });
    const updated = service.updatePlan('free', { priceMonthly: 0, features: ['a'], limits: { seats: 10 } });
    expect(updated.limits.seats).toBe(10);
    expect(service.getPlan('free').features).toEqual(['a']);
    expect(() => service.getPlan('missing')).toThrow(EnterpriseNotFoundError);

    const deactivated = service.deactivatePlan('pro');
    expect(deactivated.active).toBe(false);
    expect(service.listPlans().map((p) => p.planId)).toContain('pro');
    expect(service.listPlans(true).map((p) => p.planId)).not.toContain('pro');
    expect(() => service.updatePlan('missing', {})).toThrow(EnterpriseNotFoundError);
  });
});

describe('BillingService subscriptions', () => {
  it('subscribes a tenant, calling the hook and emitting events', async () => {
    const hook = makeHook();
    const { sink, events } = makeSink();
    const service = new BillingService({ now: () => FIXED, hook, sink });
    const subscription = await service.subscribe('t1', 'pro');
    expect(subscription.subscriptionId).toMatch(/^sub_/);
    expect(subscription.planId).toBe('pro');
    expect(subscription.status).toBe('active');
    expect(hook.subscribe).toHaveBeenCalledWith('t1', 'pro');
    expect(events.map((e) => e.type)).toEqual(['subscription.created']);
  });

  it('starts a trial when requested', async () => {
    const service = new BillingService({ now: () => FIXED });
    const subscription = await service.subscribe('t1', 'free', { trialDays: 14 });
    expect(subscription.status).toBe('trialing');
    expect(subscription.currentPeriodEnd).toBe('2026-08-20T12:00:00.000Z');
  });

  it('rejects duplicates, inactive plans and missing plans', async () => {
    const service = new BillingService({ now: () => FIXED });
    await service.subscribe('t1', 'free');
    await expect(service.subscribe('t1', 'pro')).rejects.toThrow(EnterpriseConflictError);
    await expect(service.subscribe('t2', 'missing')).rejects.toThrow(EnterpriseNotFoundError);

    service.deactivatePlan('pro');
    await expect(service.subscribe('t3', 'pro')).rejects.toThrow(EnterpriseValidationError);
  });

  it('wraps hook failures as billing errors', async () => {
    const hook = makeHook();
    hook.subscribe.mockRejectedValueOnce(new Error('stripe down'));
    const service = new BillingService({ now: () => FIXED, hook });
    await expect(service.subscribe('t1', 'pro')).rejects.toThrow(EnterpriseBillingError);
  });

  it('cancels subscriptions', async () => {
    const hook = makeHook();
    const { sink, events } = makeSink();
    const service = new BillingService({ now: () => FIXED, hook, sink });
    await service.subscribe('t1', 'pro');
    const canceled = await service.cancelSubscription('t1');
    expect(canceled.status).toBe('canceled');
    expect(canceled.cancelAtPeriodEnd).toBe(true);
    expect(hook.cancel).toHaveBeenCalledWith('t1');
    expect(events.map((e) => e.type)).toEqual(['subscription.created', 'subscription.canceled']);
    await expect(service.cancelSubscription('t2')).rejects.toThrow(EnterpriseNotFoundError);
  });

  it('wraps cancel hook failures', async () => {
    const hook = makeHook();
    const service = new BillingService({ now: () => FIXED, hook });
    await service.subscribe('t1', 'pro');
    hook.cancel.mockRejectedValueOnce(new Error('down'));
    await expect(service.cancelSubscription('t1')).rejects.toThrow(EnterpriseBillingError);
  });

  it('fetches subscriptions directly', async () => {
    const service = new BillingService({ now: () => FIXED });
    await service.subscribe('t1', 'free');
    const subscription = await service.getSubscription('t1');
    expect(subscription.planId).toBe('free');
    await expect(service.getSubscription('t2')).rejects.toThrow(EnterpriseNotFoundError);
  });

  it('changes plans and emits updated events', async () => {
    const hook = makeHook();
    const { sink, events } = makeSink();
    const service = new BillingService({ now: () => FIXED, hook, sink });
    await service.subscribe('t1', 'free');
    const changed = await service.changePlan('t1', 'pro');
    expect(changed.planId).toBe('pro');
    expect(events.map((e) => e.type)).toEqual(['subscription.created', 'subscription.updated']);

    const same = await service.changePlan('t1', 'pro');
    expect(same.planId).toBe('pro');
    await expect(service.changePlan('t2', 'pro')).rejects.toThrow(EnterpriseNotFoundError);
  });

  it('rejects changes to inactive plans and wraps hook failures', async () => {
    const hook = makeHook();
    const service = new BillingService({ now: () => FIXED, hook });
    await service.subscribe('t1', 'free');
    service.deactivatePlan('pro');
    await expect(service.changePlan('t1', 'pro')).rejects.toThrow(EnterpriseValidationError);
    service.updatePlan('pro', { active: true });
    hook.subscribe.mockRejectedValueOnce(new Error('down'));
    await expect(service.changePlan('t1', 'pro')).rejects.toThrow(EnterpriseBillingError);
  });

  it('syncs seat usage', async () => {
    const service = new BillingService({ now: () => FIXED });
    await service.subscribe('t1', 'pro');
    const synced = await service.syncSeats('t1', 7);
    expect(synced.seatsUsed).toBe(7);
    await expect(service.syncSeats('t1', -1)).rejects.toThrow(EnterpriseValidationError);
    await expect(service.syncSeats('t2', 1)).rejects.toThrow(EnterpriseNotFoundError);
  });
});

describe('BillingService usage and entitlements', () => {
  it('records usage against the hook and sink', async () => {
    const hook = makeHook();
    const { sink, events } = makeSink();
    const service = new BillingService({ now: () => FIXED, hook, sink });
    const usage = await service.recordUsage('t1', 'api_calls', 120);
    expect(usage.usageId).toMatch(/^sub_/);
    expect(usage.metric).toBe('api_calls');
    expect(hook.syncUsage).toHaveBeenCalledWith('t1', 'api_calls', 120);
    expect(events.map((e) => e.type)).toEqual(['usage.recorded']);
    expect(await service.listUsage('t1')).toHaveLength(1);
    expect(await service.listUsage('t2')).toHaveLength(0);
  });

  it('wraps usage hook failures', async () => {
    const hook = makeHook();
    hook.syncUsage.mockRejectedValueOnce(new Error('down'));
    const service = new BillingService({ now: () => FIXED, hook });
    await expect(service.recordUsage('t1', 'api_calls', 1)).rejects.toThrow(EnterpriseBillingError);
  });

  it('computes entitlements for tenants without a subscription', async () => {
    const service = new BillingService({ now: () => FIXED });
    const entitlements = await service.entitlements('t1');
    expect(entitlements.plan).toBeNull();
    expect(entitlements.limits.seats).toBe(0);
    expect(entitlements.allowed.seats).toBe(false);
    expect(entitlements.remaining.seats).toBe(0);
  });

  it('computes entitlements from plan limits and live usage', async () => {
    const service = new BillingService({ now: () => FIXED });
    await service.subscribe('t1', 'pro');
    const entitlements = await service.entitlements('t1', { seats: 20, apiKeys: 11, webhooks: 0 });
    expect(entitlements.plan?.planId).toBe('pro');
    expect(entitlements.limits.seats).toBe(25);
    expect(entitlements.allowed.seats).toBe(true);
    expect(entitlements.remaining.seats).toBe(5);
    expect(entitlements.allowed.apiKeys).toBe(false);
    expect(entitlements.remaining.apiKeys).toBe(0);
    expect(entitlements.usage.seats).toBe(20);
    expect(entitlements.remaining.webhooks).toBe(5);
  });

  it('clamps negative usage to zero', async () => {
    const service = new BillingService({ now: () => FIXED });
    await service.subscribe('t1', 'free');
    const entitlements = await service.entitlements('t1', { seats: -3 });
    expect(entitlements.usage.seats).toBe(0);
  });
});
