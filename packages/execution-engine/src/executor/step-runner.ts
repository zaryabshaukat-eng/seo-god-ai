import type { ExecutionDiff } from '../types/diff.js';
import type { Execution, ExecutionStep } from '../types/execution.js';
import type { OperationResult, OperationRegistry } from '../types/publisher.js';
import type { ExecutionRepository } from '../types/repository.js';
import type { SafetyConfig } from '../types/safety.js';
import type { ValidationContext } from '../types/validation.js';
import { buildExecutionDiff } from '../diff/diff-engine.js';
import type { OperationPublisher } from '../publisher/publisher.js';
import type { SafetyGuard } from '../safety/safety-guard.js';
import { withTimeout } from '../safety/timeout.js';
import { DEFAULT_SAFETY_CONFIG } from '../safety/config.js';
import { InvalidExecutionError } from '../utils/errors.js';
import { ValidationPipeline } from '../validators/validation-pipeline.js';

export interface StepRunnerOptions {
  publisher: OperationPublisher;
  safety: SafetyGuard;
  registry: OperationRegistry;
  pipeline?: ValidationPipeline;
  config?: SafetyConfig;
  repository?: ExecutionRepository;
  resourceStateProvider?: (step: ExecutionStep) => Promise<Record<string, unknown> | null>;
  writerCapabilities?: string[];
  now?: () => number;
}

export interface StepRunResult {
  step: ExecutionStep;
  result: OperationResult;
  diff: ExecutionDiff;
}

function isRealMode(mode: string): boolean {
  return mode === 'STAGING' || mode === 'PRODUCTION';
}

const DEFAULT_WRITER_CAPABILITIES = ['product', 'page', 'blog', 'theme', 'image'];

/** Builds the validation context for a single step from live engine state. */
export async function buildValidationContext(input: {
  execution: Execution;
  step: ExecutionStep;
  config: SafetyConfig;
  safety: SafetyGuard;
  registry: OperationRegistry;
  repository?: ExecutionRepository;
  resourceState?: Record<string, unknown> | null;
  writerCapabilities?: string[];
}): Promise<ValidationContext> {
  const { execution, step, config, safety, registry, repository, resourceState } = input;
  const existingKeys: string[] = [];
  if (repository !== undefined) {
    const prior = await repository.findCompletedStep(
      step.storeId,
      step.resourceType,
      step.resourceId,
      step.actionType,
    );
    if (prior !== null && prior.id !== step.id) existingKeys.push(prior.idempotencyKey);
  }
  const operation = registry.has(step.actionType, step.resourceType)
    ? registry.get(step.actionType, step.resourceType)
    : null;
  return {
    execution,
    step,
    config,
    mode: execution.mode,
    resourceState: resourceState ?? null,
    dependencies: { satisfied: [], missing: [] },
    approval: { approved: step.approved, requestId: step.approvalRequestId ?? undefined },
    existingKeys,
    storeLockedBy: safety.storeLock.owner(step.storeId),
    canWrite: isRealMode(execution.mode),
    hasRateBudget: safety.rateLimiter.canAcquire(step.storeId),
    writerCapabilities: input.writerCapabilities ?? DEFAULT_WRITER_CAPABILITIES,
    operationCapability: operation?.capability ?? null,
  };
}

/** Runs one step end-to-end: safety gate, validation, publish, diff, status. */
export class StepRunner {
  private readonly publisher: OperationPublisher;
  private readonly safety: SafetyGuard;
  private readonly registry: OperationRegistry;
  private readonly pipeline: ValidationPipeline;
  private readonly config: SafetyConfig;
  private readonly repository?: ExecutionRepository;
  private readonly resourceStateProvider?: (step: ExecutionStep) => Promise<Record<string, unknown> | null>;
  private readonly writerCapabilities?: string[];
  private readonly now: () => number;

  constructor(options: StepRunnerOptions) {
    this.publisher = options.publisher;
    this.safety = options.safety;
    this.registry = options.registry;
    this.pipeline = options.pipeline ?? new ValidationPipeline();
    this.config = options.config ?? DEFAULT_SAFETY_CONFIG;
    this.repository = options.repository;
    this.resourceStateProvider = options.resourceStateProvider;
    this.writerCapabilities = options.writerCapabilities;
    this.now = options.now ?? Date.now;
  }

  async run(execution: Execution, step: ExecutionStep, shopDomain: string): Promise<StepRunResult> {
    this.safety.assertStep(step);
    step.status = 'EXECUTING';
    step.attemptCount += 1;
    step.updatedAt = new Date();

    const resourceState = (this.resourceStateProvider !== undefined ? await this.resourceStateProvider(step) : null) ?? null;

    const context = await buildValidationContext({
      execution,
      step,
      config: this.config,
      safety: this.safety,
      registry: this.registry,
      repository: this.repository,
      resourceState,
      writerCapabilities: this.writerCapabilities,
    });
    const validation = await this.pipeline.validate(context);
    if (!validation.valid) {
      const messages = validation.failures.map((failure) => failure.message).join('; ');
      step.status = 'FAILED';
      step.error = messages;
      throw new InvalidExecutionError(`step ${step.id} failed validation: ${messages}`, {
        module: 'execution-engine',
        operation: 'execution.step.validate',
        context: { stepId: step.id, failures: validation.failures.map((f) => `${f.check}:${f.code}`) },
      });
    }

    const startedAt = this.now();
    const result = await withTimeout(
      this.publisher.publish(step, shopDomain, execution.mode),
      this.config.executionTimeoutMs,
      `step ${step.id} exceeded ${this.config.executionTimeoutMs}ms`,
    );
    const durationMs = this.now() - startedAt;

    step.before = resourceState ?? step.before;
    step.after = result.after;
    step.expectedAfter = step.expectedAfter ?? result.after;
    step.apiCalls = result.apiCalls;
    step.durationMs = durationMs;

    const diff = buildExecutionDiff({
      id: `${step.id}-diff`,
      executionId: execution.id,
      stepId: step.id,
      storeId: step.storeId,
      resourceType: step.resourceType,
      resourceId: step.resourceId,
      actionType: step.actionType,
      entityId: step.resourceId,
      before: step.before,
      after: step.after,
    });
    step.diffId = diff.id;

    step.status = isRealMode(execution.mode) ? 'COMPLETED' : 'SIMULATED';
    step.updatedAt = new Date();
    return { step, result, diff };
  }
}
