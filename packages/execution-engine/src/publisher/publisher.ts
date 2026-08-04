import type { ExecutionStep } from '../types/execution.js';
import type {
  ExecutionOperation,
  OperationResult,
  OperationRegistry,
  Publisher,
  ShopifyWriter,
} from '../types/publisher.js';
import type { ExecutionMode } from '../types/shared.js';
import type { RateLimiter } from '../safety/rate-limiter.js';
import { ExecutionRateLimitError } from '../utils/errors.js';
import { realSleep, type SleepFn } from '../utils/time.js';
import { OperationRegistryImpl } from './operation-registry.js';

export interface OperationPublisherOptions {
  registry?: OperationRegistry;
  writer: ShopifyWriter;
  rateLimiter?: RateLimiter;
  sleepFn?: SleepFn;
  /** Longest time to wait for a rate-limit slot before failing. */
  maxWaitMs?: number;
}

/**
 * The only component allowed to call Shopify write methods. Every write goes
 * through an operation, is gated by the rate limiter, and is counted for
 * monitoring. Dry-run and simulation never reach the writer.
 */
export class OperationPublisher implements Publisher {
  private readonly registry: OperationRegistry;
  private readonly writer: ShopifyWriter;
  private readonly rateLimiter?: RateLimiter;
  private readonly sleepFn: SleepFn;
  private readonly maxWaitMs: number;
  private calls = 0;

  constructor(options: OperationPublisherOptions) {
    this.registry = options.registry ?? new OperationRegistryImpl();
    this.writer = options.writer;
    this.rateLimiter = options.rateLimiter;
    this.sleepFn = options.sleepFn ?? realSleep;
    this.maxWaitMs = options.maxWaitMs ?? 15_000;
  }

  get operationCount(): number {
    return this.registry.list().length;
  }

  get callCount(): number {
    return this.calls;
  }

  resetCalls(): void {
    this.calls = 0;
  }

  operationFor(actionType: string, resourceType: string): ExecutionOperation {
    return this.registry.get(actionType, resourceType);
  }

  /** The operation registry backing this publisher. */
  getRegistry(): OperationRegistry {
    return this.registry;
  }

  async publish(
    step: ExecutionStep,
    shopDomain: string,
    mode: ExecutionMode,
  ): Promise<OperationResult> {
    const operation = this.registry.get(step.actionType, step.resourceType);
    if (this.rateLimiter !== undefined && step.isMutating) {
      const wait = this.rateLimiter.waitMs(step.storeId, 1);
      if (wait > this.maxWaitMs) {
        throw new ExecutionRateLimitError(
          `rate limit for store ${step.storeId} would wait ${wait}ms (max ${this.maxWaitMs}ms)`,
          { module: 'execution-engine', operation: 'execution.publisher', context: { storeId: step.storeId } },
        );
      }
      if (wait > 0) await this.sleepFn(wait);
    }
    const result = await operation.apply(step, this.writer, shopDomain, mode);
    if (result.apiCalls > 0) {
      this.calls += result.apiCalls;
      this.rateLimiter?.consume(step.storeId, result.apiCalls);
    }
    return result;
  }

  /** Restores the previous state of a step (rollback path). */
  async restore(step: ExecutionStep, shopDomain: string): Promise<OperationResult> {
    const operation = this.registry.get(step.actionType, step.resourceType);
    return operation.restore(step, this.writer, shopDomain);
  }
}
