import { ValidationError } from '@seogod/core';
import type { Agent } from '../interfaces/agent.js';
import type { AgentAction, AgentRecommendation, AgentResult } from '../types/output.js';
import { KNOWN_ACTION_TYPES, KNOWN_RESOURCE_TYPES } from '../types/output.js';
import type { ValidationFailure } from '../types/validation.js';
import { validateSchema } from './schema.js';

const STATUS_VALUES: readonly string[] = ['SUCCESS', 'PARTIAL', 'FAILED'];
const SEVERITY_VALUES: readonly string[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const RISK_VALUES: readonly string[] = ['LOW', 'MEDIUM', 'HIGH'];
const DIFFICULTY_VALUES: readonly string[] = ['TRIVIAL', 'LOW', 'MEDIUM', 'HIGH'];

/**
 * Strict validation of agent output against the output contract, the agent's
 * declared schema and its supported action types. Rejects schema failures,
 * hallucinated actions and unsupported operations.
 */
export class OutputValidator {
  validate(result: AgentResult, agent: Agent): ValidationFailure[] {
    return [
      ...this.validateContract(result, agent),
      ...this.validateRecommendations(result.recommendations),
      ...this.validateActions(result.actions, agent),
    ];
  }

  isValid(result: AgentResult, agent: Agent): boolean {
    return this.validate(result, agent).length === 0;
  }

  assertValid(result: AgentResult, agent: Agent): void {
    const failures = this.validate(result, agent);
    if (failures.length > 0) {
      throw new ValidationError(`Agent "${agent.id}" produced invalid output`, {
        module: 'agents',
        operation: 'agents.validate',
        context: { agentId: agent.id, taskId: result.taskId, failures },
      });
    }
  }

  private validateContract(result: AgentResult, agent: Agent): ValidationFailure[] {
    const failures: ValidationFailure[] = [];
    if (result.agentId !== agent.id) {
      failures.push(
        this.failure(
          'structure',
          '$.agentId',
          `expected "${agent.id}", got "${result.agentId}"`,
        ),
      );
    }
    if (typeof result.taskId !== 'string' || result.taskId.length === 0) {
      failures.push(this.failure('structure', '$.taskId', 'must be a non-empty string'));
    }
    if (!STATUS_VALUES.includes(result.status)) {
      failures.push(this.failure('structure', '$.status', `unexpected status "${result.status}"`));
    }
    failures.push(...this.checkBounds('$.confidence', result.confidence, 0, 1));
    failures.push(...this.checkBounds('$.estimatedImpact', result.estimatedImpact, 0, 100));
    if (!RISK_VALUES.includes(result.risk)) {
      failures.push(this.failure('bound', '$.risk', `unexpected risk "${result.risk}"`));
    }
    failures.push(...this.checkArray('$.recommendations', result.recommendations));
    failures.push(...this.checkArray('$.actions', result.actions));
    failures.push(...this.checkArray('$.evidence', result.evidence));
    failures.push(...this.checkArray('$.dependencies', result.dependencies));
    failures.push(...this.checkArray('$.warnings', result.warnings));
    failures.push(...this.checkArray('$.executionHints', result.executionHints));
    for (const entry of result.evidence) {
      if (typeof entry.url !== 'string' || typeof entry.field !== 'string') {
        failures.push(this.failure('structure', '$.evidence', 'invalid evidence entry'));
        break;
      }
    }
    const schemaFailures = validateSchema(result, agent.outputSchema);
    for (const violation of schemaFailures) {
      failures.push(this.failure('schema', violation.path, violation.message));
    }
    return failures;
  }

  private validateRecommendations(recommendations: AgentRecommendation[]): ValidationFailure[] {
    const failures: ValidationFailure[] = [];
    if (!Array.isArray(recommendations)) {
      return [this.failure('structure', '$.recommendations', 'must be an array')];
    }
    recommendations.forEach((recommendation, index) => {
      const base = `$.recommendations[${index}]`;
      this.pushNonEmpty(failures, `${base}.rule`, recommendation.rule);
      this.pushNonEmpty(failures, `${base}.title`, recommendation.title);
      this.pushNonEmpty(failures, `${base}.summary`, recommendation.summary);
      this.pushNonEmpty(failures, `${base}.reason`, recommendation.reason);
      this.pushNonEmpty(failures, `${base}.expectedExecutionTime`, recommendation.expectedExecutionTime);
      this.pushEnum(failures, `${base}.severity`, recommendation.severity, SEVERITY_VALUES);
      this.pushEnum(failures, `${base}.risk`, recommendation.risk, RISK_VALUES);
      this.pushEnum(
        failures,
        `${base}.implementationDifficulty`,
        recommendation.implementationDifficulty,
        DIFFICULTY_VALUES,
      );
      failures.push(...this.checkBounds(`${base}.confidence`, recommendation.confidence, 0, 1));
      failures.push(
        ...this.checkBounds(`${base}.estimatedImpact`, recommendation.estimatedImpact, 0, 100),
      );
      if (typeof recommendation.rollbackPossible !== 'boolean') {
        failures.push(
          this.failure('structure', `${base}.rollbackPossible`, 'must be a boolean'),
        );
      }
      if (typeof recommendation.approvalRequired !== 'boolean') {
        failures.push(this.failure('structure', `${base}.approvalRequired`, 'must be a boolean'));
      }
      if (!Array.isArray(recommendation.affectedUrls)) {
        failures.push(this.failure('structure', `${base}.affectedUrls`, 'must be an array'));
      } else if (
        recommendation.affectedUrls.some((url) => typeof url !== 'string' || url.length === 0)
      ) {
        failures.push(this.failure('structure', `${base}.affectedUrls`, 'must contain strings'));
      }
      if (!Array.isArray(recommendation.evidence)) {
        failures.push(this.failure('structure', `${base}.evidence`, 'must be an array'));
      } else {
        recommendation.evidence.forEach((entry, i) => {
          if (typeof entry.url !== 'string' || typeof entry.field !== 'string') {
            failures.push(
              this.failure('structure', `${base}.evidence[${i}]`, 'invalid evidence entry'),
            );
          }
        });
      }
    });
    return failures;
  }

  private validateActions(actions: AgentAction[], agent: Agent): ValidationFailure[] {
    const failures: ValidationFailure[] = [];
    if (!Array.isArray(actions)) {
      return [this.failure('structure', '$.actions', 'must be an array')];
    }
    actions.forEach((action, index) => {
      const base = `$.actions[${index}]`;
      if (!KNOWN_ACTION_TYPES.includes(action.actionType)) {
        failures.push(
          this.failure(
            'unsupported-operation',
            `${base}.actionType`,
            `unsupported action type "${action.actionType}"`,
          ),
        );
      } else if (!agent.supportedActionTypes.includes(action.actionType)) {
        failures.push(
          this.failure(
            'hallucinated-action',
            `${base}.actionType`,
            `agent "${agent.id}" does not support action "${action.actionType}"`,
          ),
        );
      }
      if (!KNOWN_RESOURCE_TYPES.includes(action.resourceType)) {
        failures.push(
          this.failure(
            'unsupported-operation',
            `${base}.resourceType`,
            `unsupported resource type "${action.resourceType}"`,
          ),
        );
      }
      this.pushNonEmpty(failures, `${base}.resourceId`, action.resourceId);
      this.pushNonEmpty(failures, `${base}.resourceRef`, action.resourceRef);
      this.pushNonEmpty(failures, `${base}.rationale`, action.rationale);
      if (!this.isRecord(action.payload)) {
        failures.push(this.failure('structure', `${base}.payload`, 'must be an object'));
      }
      if (typeof action.priority !== 'number' || action.priority < 0 || action.priority > 100) {
        failures.push(this.failure('bound', `${base}.priority`, 'must be a number in [0,100]'));
      }
      if (typeof action.estimatedSeconds !== 'number' || action.estimatedSeconds < 0) {
        failures.push(this.failure('bound', `${base}.estimatedSeconds`, 'must be a non-negative number'));
      }
    });
    return failures;
  }

  private checkArray(path: string, value: unknown): ValidationFailure[] {
    return Array.isArray(value) ? [] : [this.failure('structure', path, 'must be an array')];
  }

  private checkBounds(
    path: string,
    value: number,
    min: number,
    max: number,
  ): ValidationFailure[] {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return [this.failure('structure', path, 'must be a number')];
    }
    return value < min || value > max
      ? [this.failure('bound', path, `must be within [${min},${max}]`)]
      : [];
  }

  private pushNonEmpty(failures: ValidationFailure[], path: string, value: unknown): void {
    if (typeof value !== 'string' || value.length === 0) {
      failures.push(this.failure('structure', path, 'must be a non-empty string'));
    }
  }

  private pushEnum(
    failures: ValidationFailure[],
    path: string,
    value: string,
    allowed: readonly string[],
  ): void {
    if (!allowed.includes(value)) {
      failures.push(this.failure('bound', path, `must be one of ${allowed.join(', ')}`));
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private failure(
    code: ValidationFailure['code'],
    path: string,
    message: string,
  ): ValidationFailure {
    return { code, path, message };
  }
}
