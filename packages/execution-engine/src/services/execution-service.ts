import type { MetricsRegistry } from '@seogod/monitoring';
import type { Execution } from '../types/execution.js';
import type { ExecutionSink } from '../types/events.js';
import type { ExecutionPlanInput, ExecutionOptions } from '../types/plan.js';
import type { ExecutionReport } from '../types/report.js';
import type { ExecutionFilter, ExecutionRepository } from '../types/repository.js';
import type { SafetyConfig } from '../types/safety.js';
import type { ValidationCheck } from '../types/validation.js';
import { ExecutionEngine } from '../executor/execution-engine.js';
import { ExecutionPlanner } from '../planner/execution-planner.js';
import { OperationPublisher } from '../publisher/publisher.js';
import { InMemoryExecutionRepository } from '../repositories/in-memory-repository.js';
import { RollbackEngine } from '../rollback/engine.js';
import { SafetyGuard } from '../safety/safety-guard.js';
import { MemoryShopifyWriter } from '../publisher/shopify-writer.js';
import type { ExecutionWorker } from '../workers/execution-worker.js';

export interface ExecutionServiceDependencies {
  planner?: ExecutionPlanner;
  publisher?: OperationPublisher;
  safety?: SafetyGuard;
  rollback?: RollbackEngine;
  config?: SafetyConfig;
  validators?: ValidationCheck[];
  eventSink?: ExecutionSink;
  metricsRegistry?: MetricsRegistry;
  repository?: ExecutionRepository;
  worker?: ExecutionWorker;
}

/** High-level façade over the engine, publisher and repositories. */
export class ExecutionService {
  readonly engine: ExecutionEngine;
  private readonly repository: ExecutionRepository;

  constructor(dependencies: ExecutionServiceDependencies) {
    this.repository = dependencies.repository ?? new InMemoryExecutionRepository();
    const safety = dependencies.safety ?? new SafetyGuard({ config: dependencies.config });
    const publisher = dependencies.publisher ?? new OperationPublisher({ writer: defaultMemoryWriter() });
    const planner = dependencies.planner ?? new ExecutionPlanner({ registry: publisher.getRegistry(), config: dependencies.config });
    const rollback = dependencies.rollback ?? new RollbackEngine({ publisher });
    this.engine = new ExecutionEngine({
      planner,
      publisher,
      safety,
      rollback,
      validators: dependencies.validators,
      config: dependencies.config,
      eventSink: dependencies.eventSink,
      metricsRegistry: dependencies.metricsRegistry,
      repository: this.repository,
      worker: dependencies.worker,
    });
  }

  async execute(input: ExecutionPlanInput, options: ExecutionOptions = {}): Promise<Execution> {
    return this.engine.execute(input, options);
  }

  async approve(executionId: string, stepIds: string[]): Promise<Execution | null> {
    return this.engine.approve(executionId, stepIds);
  }

  async resume(executionId: string, shopDomain?: string): Promise<Execution> {
    return this.engine.resume(executionId, shopDomain);
  }

  async cancel(executionId: string, reason?: string): Promise<boolean> {
    return this.engine.cancel(executionId, reason);
  }

  async getExecution(id: string): Promise<Execution | null> {
    return this.repository.getExecution(id);
  }

  async listExecutions(filter?: ExecutionFilter): Promise<Execution[]> {
    return this.repository.listExecutions(filter);
  }

  /** Assembles the full audit report for an execution. */
  async report(executionId: string): Promise<ExecutionReport | null> {
    const execution = await this.repository.getExecution(executionId);
    if (execution === null) return null;
    const diffs: ExecutionReport['diffs'] = [];
    for (const step of execution.steps) {
      if (step.diffId !== null) {
        const diff = await this.repository.getDiff(step.diffId);
        if (diff !== null) diffs.push(diff);
      }
    }
    const metrics = await this.repository.getMetrics(executionId);
    return { execution, diffs, rollbacks: [], metrics, validations: {} };
  }
}

function defaultMemoryWriter(): MemoryShopifyWriter {
  return new MemoryShopifyWriter();
}
