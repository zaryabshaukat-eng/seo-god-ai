import type { MetricsRegistry } from '@seogod/monitoring';
import type { Execution, ExecutionStep } from '../types/execution.js';
import type { ExecutionEvent } from '../types/events.js';
import type { ExecutionSink } from '../types/events.js';
import type { ExecutionPlanInput, ExecutionOptions } from '../types/plan.js';
import type { ExecutionRepository } from '../types/repository.js';
import type { SafetyConfig } from '../types/safety.js';
import type { ValidationCheck } from '../types/validation.js';
import { ApprovalGate } from '../approval/gate.js';
import { DryRunPlanner } from '../dry-run/planner.js';
import { buildMetrics } from '../models/metrics.js';
import { buildRollbackRecord } from '../models/rollback.js';
import type { ExecutionPlanner } from '../planner/execution-planner.js';
import type { OperationPublisher } from '../publisher/publisher.js';
import type { RollbackEngine } from '../rollback/engine.js';
import { InMemoryExecutionRepository } from '../repositories/in-memory-repository.js';
import type { SafetyGuard } from '../safety/safety-guard.js';
import { DEFAULT_SAFETY_CONFIG } from '../safety/config.js';
import { InMemorySink } from '../monitoring/event-publisher.js';
import type { ExecutionWorker } from '../workers/execution-worker.js';
import {
  ExecutionError,
  ExecutionErrorCodes,
  ExecutionRateLimitError,
  InvalidExecutionError,
  isExecutionError,
  StoreLockedError,
} from '../utils/errors.js';
import { ValidationPipeline } from '../validators/validation-pipeline.js';
import { StepRunner } from './step-runner.js';

export interface ExecutionEngineOptions {
  planner: ExecutionPlanner;
  publisher: OperationPublisher;
  safety: SafetyGuard;
  rollback: RollbackEngine;
  validators?: ValidationCheck[];
  config?: SafetyConfig;
  eventSink?: ExecutionSink;
  metricsRegistry?: MetricsRegistry;
  repository?: ExecutionRepository;
  resourceStateProvider?: (step: ExecutionStep) => Promise<Record<string, unknown> | null>;
  worker?: ExecutionWorker;
  writerCapabilities?: string[];
  now?: () => number;
}

function isReal(mode: string): boolean {
  return mode === 'STAGING' || mode === 'PRODUCTION';
}

function lastError(execution: Execution): string {
  const step = [...execution.steps].reverse().find((candidate) => candidate.error !== null);
  return step?.error ?? 'execution failed';
}

/** Orchestrates executions end-to-end. The engine is the only entry point that
 * turns an approved plan into writes, diffs, metrics and rollbacks. */
export class ExecutionEngine {
  private readonly planner: ExecutionPlanner;
  private readonly publisher: OperationPublisher;
  private readonly safety: SafetyGuard;
  private readonly rollback: RollbackEngine;
  private readonly config: SafetyConfig;
  private readonly eventSink: ExecutionSink;
  private readonly repository: ExecutionRepository;
  private readonly dryRun: DryRunPlanner;
  private readonly approvals: ApprovalGate;
  private readonly stepRunner: StepRunner;
  private readonly worker?: ExecutionWorker;
  private readonly metricsRegistry?: MetricsRegistry;
  private readonly now: () => number;

  constructor(options: ExecutionEngineOptions) {
    this.planner = options.planner;
    this.publisher = options.publisher;
    this.safety = options.safety;
    this.rollback = options.rollback;
    this.config = options.config ?? DEFAULT_SAFETY_CONFIG;
    this.eventSink = options.eventSink ?? new InMemorySink();
    this.repository = options.repository ?? new InMemoryExecutionRepository();
    this.dryRun = new DryRunPlanner(options.publisher.getRegistry());
    this.approvals = new ApprovalGate(this.repository);
    const pipeline = new ValidationPipeline({ checks: options.validators });
    this.stepRunner = new StepRunner({
      publisher: options.publisher,
      safety: options.safety,
      registry: options.publisher.getRegistry(),
      pipeline,
      config: this.config,
      repository: this.repository,
      resourceStateProvider: options.resourceStateProvider,
      writerCapabilities: options.writerCapabilities,
      now: options.now,
    });
    this.worker = options.worker;
    this.metricsRegistry = options.metricsRegistry;
    this.now = options.now ?? Date.now;
  }

  get executionRepository(): ExecutionRepository {
    return this.repository;
  }

  get safetyGuard(): SafetyGuard {
    return this.safety;
  }

  get publisherOf(): OperationPublisher {
    return this.publisher;
  }

  /** Plans and submits an execution. Returns immediately (PENDING/QUEUED)
   * when the execution requires approval or uses the queue; runs inline
   * otherwise. */
  async execute(input: ExecutionPlanInput, options: ExecutionOptions = {}): Promise<Execution> {
    const execution = this.planner.plan(input);
    await this.repository.saveExecution(execution);
    this.dryRun.plan(execution);

    if (this.approvals.pendingApprovals(execution).length > 0) {
      await this.repository.saveExecution(execution);
      await this.emit({
        type: 'execution.queued',
        executionId: execution.id,
        storeId: execution.storeId,
        workflowId: execution.workflowId ?? undefined,
        status: 'PENDING',
      });
      return execution;
    }

    if (options.submit === 'queue') {
      if (this.worker === undefined) {
        throw new InvalidExecutionError('queue submission requested but no execution worker is configured', {
          module: 'execution-engine',
          operation: 'execution.submit',
          context: { executionId: execution.id },
        });
      }
      await this.worker.enqueue({ executionId: execution.id });
      execution.status = 'QUEUED';
      await this.repository.saveExecution(execution);
      await this.emit({
        type: 'execution.queued',
        executionId: execution.id,
        storeId: execution.storeId,
        workflowId: execution.workflowId ?? undefined,
        status: 'QUEUED',
      });
      return execution;
    }

    return this.run(execution, options.shopDomain ?? execution.storeId);
  }

  /** Marks steps approved so a pending execution can be resumed. */
  async approve(executionId: string, stepIds: string[]): Promise<Execution | null> {
    const execution = await this.repository.getExecution(executionId);
    if (execution === null) return null;
    for (const step of execution.steps) {
      if (stepIds.includes(step.id)) step.approved = true;
    }
    await this.repository.saveExecution(execution);
    return execution;
  }

  /** Runs a previously-planned execution (e.g. after approval or from the queue). */
  async resume(executionId: string, shopDomain?: string): Promise<Execution> {
    const execution = await this.repository.getExecution(executionId);
    if (execution === null) {
      throw new InvalidExecutionError(`execution ${executionId} not found`, {
        module: 'execution-engine',
        operation: 'execution.resume',
      });
    }
    return this.run(execution, shopDomain ?? execution.storeId);
  }

  /** Cancels a pending/queued execution. */
  async cancel(executionId: string, reason = 'cancelled by operator'): Promise<boolean> {
    const execution = await this.repository.getExecution(executionId);
    if (execution === null) return false;
    if (execution.status !== 'PENDING' && execution.status !== 'QUEUED') return false;
    execution.status = 'CANCELLED';
    for (const step of execution.steps) {
      if (step.status === 'PENDING' || step.status === 'READY') step.status = 'CANCELLED';
    }
    await this.repository.saveExecution(execution);
    await this.emit({
      type: 'execution.cancelled',
      executionId: execution.id,
      storeId: execution.storeId,
      reason,
      status: 'CANCELLED',
    });
    return true;
  }

  emergencyStop(storeId?: string): void {
    this.safety.emergencyStop(storeId);
  }

  resumeFromStop(storeId?: string): void {
    this.safety.resume(storeId);
  }

  start(): void {
    this.worker?.start();
  }

  async stop(): Promise<void> {
    await this.worker?.stop();
  }

  /** Runs the inline execution loop. */
  private async run(execution: Execution, shopDomain: string): Promise<Execution> {
    const startedAt = this.now();
    const active = (await this.repository.listActiveExecutions(execution.storeId)).filter((e) => e.id !== execution.id);
    try {
      this.safety.assertCanExecute(execution, active);
    } catch (error) {
      execution.status = 'REJECTED';
      await this.repository.saveExecution(execution);
      await this.emit({
        type: 'execution.safety_violation',
        executionId: execution.id,
        storeId: execution.storeId,
        violation: error instanceof Error ? error.message : String(error),
        status: 'REJECTED',
      });
      throw error;
    }

    if (isReal(execution.mode) && this.config.enforceStoreLock) {
      const acquired = this.safety.storeLock.acquire(execution.storeId, execution.id);
      if (!acquired) {
        const owner = this.safety.storeLock.owner(execution.storeId);
        throw new StoreLockedError(
          `store ${execution.storeId} is locked by execution ${owner ?? 'unknown'}`,
          { module: 'execution-engine', operation: 'execution.acquire_lock', context: { executionId: execution.id, storeId: execution.storeId, owner: owner ?? null } },
        );
      }
    }

    execution.status = 'EXECUTING';
    execution.startedAt = new Date(startedAt);
    await this.repository.saveExecution(execution);
    await this.emit({
      type: 'execution.started',
      executionId: execution.id,
      storeId: execution.storeId,
      workflowId: execution.workflowId ?? undefined,
      status: 'EXECUTING',
    });

    try {
      await this.runSteps(execution, shopDomain);
      const currentStatus: string = execution.status;
      const failed = execution.steps.some((step) => step.status === 'FAILED');
      if (currentStatus !== 'ROLLED_BACK' && currentStatus !== 'FAILED') {
        execution.status = failed ? 'FAILED' : 'COMPLETED';
      }
      execution.completedAt = new Date();
      await this.finalize(execution, startedAt);
      const duration = this.now() - startedAt;
      const finalStatus: string = execution.status;
      if (finalStatus === 'ROLLED_BACK') {
        await this.emit({ type: 'execution.rollback_completed', executionId: execution.id, storeId: execution.storeId, status: 'ROLLED_BACK', duration });
      } else if (finalStatus === 'COMPLETED') {
        await this.emit({
          type: 'execution.completed',
          executionId: execution.id,
          storeId: execution.storeId,
          duration,
          status: 'COMPLETED',
        });
      } else {
        await this.emit({
          type: 'execution.failed',
          executionId: execution.id,
          storeId: execution.storeId,
          duration,
          status: 'FAILED',
          error: lastError(execution),
        });
      }
    } catch (error) {
      execution.status = 'FAILED';
      execution.completedAt = new Date();
      await this.finalize(execution, startedAt);
      await this.emit({
        type: 'execution.failed',
        executionId: execution.id,
        storeId: execution.storeId,
        duration: this.now() - startedAt,
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
      if (isExecutionError(error)) throw error;
      throw new ExecutionError(
        `execution ${execution.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        ExecutionErrorCodes.execution,
        { module: 'execution-engine', operation: 'execution.run', context: { executionId: execution.id } },
      );
    } finally {
      if (isReal(execution.mode)) {
        this.safety.storeLock.releaseIfOwner(execution.storeId, execution.id);
      }
      await this.repository.saveExecution(execution);
    }
    return execution;
  }

  private async runSteps(execution: Execution, shopDomain: string): Promise<void> {
    const executed: ExecutionStep[] = [];
    for (const step of execution.steps) {
      if (step.status === 'CANCELLED' || step.status === 'SKIPPED') continue;
      try {
        const outcome = await this.stepRunner.run(execution, step, shopDomain);
        await this.repository.saveDiff(outcome.diff);
        executed.push(outcome.step);
      } catch (error) {
        step.status = 'FAILED';
        step.error = error instanceof Error ? error.message : String(error);
        if (error instanceof ExecutionRateLimitError) {
          await this.emit({
            type: 'execution.publisher_failed',
            executionId: execution.id,
            storeId: execution.storeId,
            error: step.error,
            status: 'FAILED',
          });
        }
        if (isReal(execution.mode) && this.config.autoRollbackOnFailure) {
          await this.rollbackSteps(execution, executed, shopDomain);
          for (const remaining of execution.steps) {
            if (remaining.status === 'PENDING' || remaining.status === 'READY') remaining.status = 'CANCELLED';
          }
          execution.status = 'ROLLED_BACK';
        } else {
          for (const remaining of execution.steps) {
            if (remaining.status === 'PENDING' || remaining.status === 'READY') remaining.status = 'CANCELLED';
          }
          execution.status = 'FAILED';
        }
        break;
      }
    }
    this.updateBatches(execution);
    this.refreshSummary(execution);
  }

  private async rollbackSteps(execution: Execution, executed: ExecutionStep[], shopDomain: string): Promise<void> {
    await this.emit({
      type: 'execution.rollback_started',
      executionId: execution.id,
      storeId: execution.storeId,
      status: 'ROLLED_BACK',
    });
    for (const step of [...executed].reverse()) {
      const record = buildRollbackRecord({
        executionId: execution.id,
        storeId: execution.storeId,
        scope: 'single',
        mode: execution.mode,
        stepId: step.id,
        plan: step.rollbackPlan,
        reason: 'auto-rollback after step failure',
      });
      record.status = 'EXECUTING';
      record.startedAt = new Date();
      await this.repository.saveRollback(record);
      const result = await this.rollback.rollbackStep(step, shopDomain);
      record.apiCalls = result.apiCalls;
      record.status = result.status;
      record.completedAt = new Date();
      record.error = result.error;
      step.rollbackId = record.id;
      step.status = result.status === 'COMPLETED' ? 'ROLLED_BACK' : 'FAILED';
      if (result.status === 'FAILED') {
        await this.emit({
          type: 'execution.rollback_failed',
          executionId: execution.id,
          storeId: execution.storeId,
          rollbackId: record.id,
          error: result.error ?? 'rollback failed',
          status: 'ROLLED_BACK',
        });
      }
      await this.repository.saveRollback(record);
      await this.repository.saveStep(step);
    }
  }

  private updateBatches(execution: Execution): void {
    for (const batch of execution.batches) {
      const steps = batch.stepIds
        .map((id) => execution.steps.find((step) => step.id === id))
        .filter((step): step is ExecutionStep => step !== undefined);
      batch.apiCalls = steps.reduce((sum, step) => sum + step.apiCalls, 0);
      if (steps.length === 0) {
        batch.status = 'CANCELLED';
      } else if (steps.every((step) => step.status === 'COMPLETED')) {
        batch.status = 'COMPLETED';
      } else if (steps.every((step) => step.status === 'SIMULATED')) {
        batch.status = 'SIMULATED';
      } else if (steps.some((step) => step.status === 'ROLLED_BACK')) {
        batch.status = 'ROLLED_BACK';
      } else if (steps.some((step) => step.status === 'FAILED')) {
        batch.status = 'FAILED';
      } else if (steps.some((step) => step.status === 'CANCELLED')) {
        batch.status = 'CANCELLED';
      } else if (steps.every((step) => step.status === 'SKIPPED')) {
        batch.status = 'SKIPPED';
      } else {
        batch.status = 'EXECUTING';
      }
      batch.updatedAt = new Date();
    }
  }

  private async finalize(execution: Execution, startedAt: number): Promise<void> {
    const rollbacks = execution.steps.filter((step) => step.status === 'ROLLED_BACK').length;
    const metrics = buildMetrics(execution, {
      startedAt: new Date(startedAt),
      completedAt: execution.completedAt ?? new Date(),
      apiCalls: execution.steps.reduce((sum, step) => sum + step.apiCalls, 0),
      rollbacks,
    });
    await this.repository.saveMetrics(execution.id, metrics);
    this.metricsRegistry?.increment(`execution.${execution.mode}.${execution.status}`);
    for (const step of execution.steps) await this.repository.saveStep(step);
    for (const batch of execution.batches) await this.repository.saveBatch(batch);
  }

  private refreshSummary(execution: Execution): void {
    let completed = 0;
    let simulated = 0;
    let failed = 0;
    let skipped = 0;
    let cancelled = 0;
    let rolledBack = 0;
    let apiCalls = 0;
    for (const step of execution.steps) {
      switch (step.status) {
        case 'COMPLETED': completed += 1; break;
        case 'SIMULATED': simulated += 1; break;
        case 'FAILED': failed += 1; break;
        case 'SKIPPED': skipped += 1; break;
        case 'CANCELLED': cancelled += 1; break;
        case 'ROLLED_BACK': rolledBack += 1; break;
        default: break;
      }
      apiCalls += step.apiCalls;
    }
    execution.summary = {
      total: execution.steps.length,
      completed,
      simulated,
      failed,
      skipped,
      cancelled,
      rolledBack,
      apiCalls,
      durationMs: execution.startedAt !== null ? this.now() - execution.startedAt.getTime() : null,
    };
  }

  private async emit(event: ExecutionEvent): Promise<void> {
    await this.eventSink.emit(event);
  }
}
