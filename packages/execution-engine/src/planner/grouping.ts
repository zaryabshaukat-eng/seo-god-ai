import type { ExecutionBatch, ExecutionStep } from '../types/execution.js';
import { buildBatch } from '../models/execution.js';

/** Groups steps into batches by resource+action, capped at maxBatchSize. */
export function groupStepsIntoBatches(
  executionId: string,
  storeId: string,
  steps: ExecutionStep[],
  maxBatchSize: number,
): ExecutionBatch[] {
  const batches: ExecutionBatch[] = [];
  const capacity = maxBatchSize > 0 ? maxBatchSize : Number.POSITIVE_INFINITY;

  const byAction = new Map<string, ExecutionStep[]>();
  for (const step of steps) {
    const key = `${step.resourceType}.${step.actionType}`;
    const bucket = byAction.get(key) ?? [];
    bucket.push(step);
    byAction.set(key, bucket);
  }

  let order = 0;
  for (const bucket of byAction.values()) {
    for (let index = 0; index < bucket.length; index += capacity) {
      const chunk = bucket.slice(index, index + capacity);
      batches.push(
        buildBatch({
          executionId,
          storeId,
          resourceType: chunk[0]?.resourceType ?? 'unknown',
          actionType: chunk[0]?.actionType ?? 'unknown',
          stepIds: chunk.map((step) => step.id),
          order,
        }),
      );
      order += 1;
    }
  }
  return batches;
}
