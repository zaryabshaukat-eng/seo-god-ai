import { describe, expect, it } from 'vitest';
import type { ExecutionStep } from '../types/execution.js';
import { buildStep } from '../models/execution.js';
import { RateLimiter } from '../safety/rate-limiter.js';
import { ExecutionRateLimitError } from '../utils/errors.js';
import { OperationPublisher } from './publisher.js';
import { MemoryShopifyWriter } from './shopify-writer.js';

function step(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return buildStep({
    executionId: 'e1',
    batchId: 'b1',
    storeId: 's1',
    actionType: 'update_title',
    resourceType: 'product',
    resourceId: 'p1',
    payload: { title: 'New' },
    order: 0,
    ...overrides,
  });
}

describe('operation publisher', () => {
  it('publishes writes through the writer and counts api calls', async () => {
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    const result = await publisher.publish(step(), 'shop', 'PRODUCTION');
    expect(result.apiCalls).toBe(1);
    expect(writer.calls).toHaveLength(1);
    expect(publisher.callCount).toBe(1);
    expect(publisher.operationCount).toBeGreaterThan(0);
    publisher.resetCalls();
    expect(publisher.callCount).toBe(0);
  });

  it('never reaches the writer in non-real modes', async () => {
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    for (const mode of ['DRY_RUN', 'SIMULATION'] as const) {
      const result = await publisher.publish(step(), 'shop', mode);
      expect(result.apiCalls).toBe(0);
    }
    expect(writer.calls).toHaveLength(0);
    expect(publisher.callCount).toBe(0);
  });

  it('honors the rate limiter and throws when the wait is too long', async () => {
    let now = 0;
    const writer = new MemoryShopifyWriter();
    const limiter = new RateLimiter({ perMinute: 1, nowMs: () => now });
    const publisher = new OperationPublisher({
      writer,
      rateLimiter: limiter,
      sleepFn: async () => {},
      maxWaitMs: 100,
    });
    await publisher.publish(step(), 'shop', 'PRODUCTION');
    now = 10;
    await expect(publisher.publish(step(), 'shop', 'PRODUCTION')).rejects.toThrow(ExecutionRateLimitError);
    expect(writer.calls).toHaveLength(1);
  });

  it('waits for a rate slot when one is available', async () => {
    let now = 0;
    const slept: number[] = [];
    const writer = new MemoryShopifyWriter();
    const limiter = new RateLimiter({ perMinute: 1, windowMs: 100, nowMs: () => now });
    const publisher = new OperationPublisher({
      writer,
      rateLimiter: limiter,
      sleepFn: async (ms) => {
        slept.push(ms);
        now += ms;
      },
      maxWaitMs: 1000,
    });
    await publisher.publish(step(), 'shop', 'PRODUCTION');
    now = 50;
    const result = await publisher.publish(step(), 'shop', 'PRODUCTION');
    expect(result.apiCalls).toBe(1);
    expect(slept).toEqual([50]);
    expect(writer.calls).toHaveLength(2);
  });

  it('operationFor and getRegistry expose the registry', () => {
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    expect(publisher.operationFor('update_title', 'product').id).toBe('product.update_title');
    expect(publisher.getRegistry().has('update_title', 'product')).toBe(true);
  });

  it('restore delegates to the operation restore path', async () => {
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    const theStep = step();
    theStep.before = { seo: { title: 'Old' } };
    const result = await publisher.restore(theStep, 'shop');
    expect(result.apiCalls).toBe(1);
    expect(writer.calls[0]!.args[1]).toEqual({ id: 'p1', seo: { title: 'Old' } });
  });
});
