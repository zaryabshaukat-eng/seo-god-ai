import type { ValidationCheck, ValidationContext, ValidationFailure, ValidationResult } from '../types/validation.js';
import { ApprovalValidator } from './approval-validator.js';
import { ConflictValidator } from './conflict-validator.js';
import { DependencyValidator } from './dependency-validator.js';
import { IdempotencyValidator } from './idempotency-validator.js';
import { PermissionValidator } from './permission-validator.js';
import { PolicyValidator } from './policy-validator.js';
import { RateLimitValidator } from './rate-limit-validator.js';
import { RollbackValidator } from './rollback-validator.js';
import { SchemaValidator } from './schema-validator.js';
import { StateValidator } from './state-validator.js';

export interface ValidationPipelineOptions {
  checks?: ValidationCheck[];
  /** Stop collecting after this many failures (default: no limit). */
  maxFailures?: number;
}

/** Runs named checks in order and aggregates their failures. */
export class ValidationPipeline {
  private readonly checks: ValidationCheck[];
  private readonly maxFailures: number;

  constructor(options: ValidationPipelineOptions = {}) {
    this.checks = [...(options.checks ?? [])];
    this.maxFailures = options.maxFailures ?? Number.POSITIVE_INFINITY;
  }

  addCheck(check: ValidationCheck): void {
    if (this.hasCheck(check.id)) {
      throw new Error(`validation check "${check.id}" is already registered`);
    }
    this.checks.push(check);
  }

  hasCheck(id: string): boolean {
    return this.checks.some((check) => check.id === id);
  }

  listChecks(): string[] {
    return this.checks.map((check) => check.id);
  }

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const failures: ValidationFailure[] = [];
    for (const check of this.checks) {
      const result = await check.check(ctx);
      for (const failure of result.failures) {
        failures.push({ stepId: ctx.step.id, ...failure });
      }
      if (failures.length >= this.maxFailures) break;
    }
    return { valid: failures.length === 0, failures };
  }
}

/** Default validation checks wired by the engine (order matters). */
export function defaultChecks(): ValidationCheck[] {
  return [
    new SchemaValidator(),
    new PolicyValidator(),
    new ApprovalValidator(),
    new DependencyValidator(),
    new StateValidator(),
    new ConflictValidator(),
    new IdempotencyValidator(),
    new RollbackValidator(),
    new RateLimitValidator(),
    new PermissionValidator(),
  ];
}
