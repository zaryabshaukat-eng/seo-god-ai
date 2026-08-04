import type { ValidationCheck, ValidationContext } from '../types/validation.js';
import { fail, ok } from './result.js';

const COMPLETE_STATUSES = new Set(['COMPLETED', 'SIMULATED']);

/** Ensures every dependency of a step is satisfied before it may run. */
export class DependencyValidator implements ValidationCheck {
  readonly id = 'dependency';

  check(ctx: ValidationContext) {
    const { step } = ctx;
    if (step.dependsOn.length === 0) return ok();

    const byId = new Map(ctx.execution.steps.map((candidate) => [candidate.id, candidate]));
    const missing: string[] = [];
    for (const dependency of step.dependsOn) {
      const dependencyStep = byId.get(dependency);
      if (dependencyStep === undefined) {
        missing.push(dependency);
        continue;
      }
      if (!COMPLETE_STATUSES.has(dependencyStep.status)) {
        return fail(
          'dependency',
          'dependency_incomplete',
          `step ${step.id} depends on ${dependency} which is ${dependencyStep.status}`,
          { stepId: step.id, dependency },
        );
      }
    }
    if (missing.length > 0) {
      return fail('dependency', 'dependency_missing', `unknown dependencies: ${missing.join(', ')}`, {
        stepId: step.id,
      });
    }
    const externalMissing = ctx.dependencies?.missing.filter((dep) => dep.includes(step.resourceId) || step.dependsOn.includes(dep)) ?? [];
    if (externalMissing.length > 0) {
      return fail('dependency', 'dependency_unsatisfied', `external dependencies unsatisfied: ${externalMissing.join(', ')}`, {
        stepId: step.id,
      });
    }
    return ok();
  }
}
