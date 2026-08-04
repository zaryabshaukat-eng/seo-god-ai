import type { Execution } from '../types/execution.js';

const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'PENDING',
  'VALIDATING',
  'QUEUED',
  'EXECUTING',
]);

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

/** Executions that are active for the same store and not this one. */
export function detectConflicts(candidate: Execution, active: Execution[]): Execution[] {
  return active.filter(
    (execution) =>
      execution.storeId === candidate.storeId &&
      execution.id !== candidate.id &&
      isActiveStatus(execution.status),
  );
}
