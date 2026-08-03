import type { SafetyCheck, SafetyDecision } from '../types/safety.js';
import type { ValidationSchema } from '../types/validation.js';
import { matchSchema } from '../validation/schema.js';
import { isUnsafeAction, isSupportedAction } from './action-policy.js';

export interface AgentOutput {
  text: string;
  data: unknown;
  /** When provided, the output is additionally matched against this schema. */
  schema?: ValidationSchema;
}

export interface SafetyGuardOptions {
  /**
   * Action types the plan authorizes for this task. Agents may only echo
   * these; proposing anything else is blocked. When omitted, only the
   * global supported/unsafe allow-list applies.
   */
  allowedActions?: string[];
}

/** Data keys inspected for proposed actions. */
const ACTION_KEYS = ['action', 'actionType'] as const;

/**
 * Safety gate applied to every agent output before it is handed to a
 * workflow: reject empty outputs, invalid JSON, schema violations,
 * unsupported actions, and unsafe (unauthorized) actions.
 */
export class SafetyGuard {
  evaluate(output: AgentOutput, options: SafetyGuardOptions = {}): SafetyDecision {
    const checks: SafetyCheck[] = [];
    const allowed = options.allowedActions;

    const nonEmpty = output.text.trim() !== '';
    checks.push({ id: 'non-empty', label: 'output is non-empty', passed: nonEmpty });

    const parsed = output.data !== null && output.data !== undefined;
    checks.push({ id: 'valid-json', label: 'output parses as JSON', passed: parsed });

    const schemaIssues =
      output.schema === undefined ? [] : matchSchema(output.data, output.schema, '$');
    checks.push({
      id: 'schema',
      label: 'output matches its schema',
      passed: schemaIssues.length === 0,
      detail: schemaIssues.length === 0 ? undefined : schemaIssues[0]?.message,
    });

    const actions = this.extractActions(output.data);
    if (actions.length === 0) {
      checks.push({
        id: 'supported-action',
        label: 'proposed action is supported',
        passed: true,
      });
      checks.push({ id: 'safe-action', label: 'proposed action is safe', passed: true });
    }
    for (const action of actions) {
      const supported = isSupportedAction(action) && (allowed === undefined || allowed.includes(action));
      checks.push({
        id: 'supported-action',
        label: 'proposed action is supported',
        passed: supported,
        detail: supported ? undefined : action,
      });
      const safe =
        allowed === undefined ? !isUnsafeAction(action) : allowed.includes(action);
      checks.push({
        id: 'safe-action',
        label: 'proposed action is safe',
        passed: safe,
        detail: safe ? undefined : action,
      });
    }

    const failed = checks.find((check) => !check.passed);
    return {
      ok: checks.every((check) => check.passed),
      checks,
      reason: failed === undefined ? undefined : `${failed.label}: ${failed.detail ?? 'failed'}`,
    };
  }

  private extractActions(data: unknown): string[] {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return [];
    const record = data as Record<string, unknown>;
    const actions: string[] = [];
    for (const key of ACTION_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') actions.push(value);
    }
    return actions;
  }
}
