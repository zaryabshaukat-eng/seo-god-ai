import type { ExecutionBatch, ExecutionTask } from '../types/plan.js';
import { deterministicUuid } from '../utils/ids.js';

export interface BatcherOptions {
  /** Maximum tasks per batch (defaults to 50). */
  maxBatchSize?: number;
}

export interface GroupTasksInput {
  planId: string;
  storeId: string;
  /** Topological execution position per task id, used to order batches. */
  orderOf: ReadonlyMap<string, number>;
  /** Batch size override per call (falls back to the option). */
  maxBatchSize?: number;
}

/**
 * Groups compatible tasks into execution batches. Compatibility = same
 * resource type and same action type, so one API call pattern serves the whole
 * batch (optimizing API usage). Batches are ordered by the earliest task in
 * the topological order; ties break deterministically.
 */
export class Batcher {
  private readonly maxBatchSize: number;

  constructor(options: BatcherOptions = {}) {
    this.maxBatchSize = options.maxBatchSize ?? 50;
  }

  group(tasks: ExecutionTask[], input: GroupTasksInput): ExecutionBatch[] {
    const maxBatchSize = input.maxBatchSize ?? this.maxBatchSize;
    const byKey = new Map<string, ExecutionTask[]>();
    for (const task of tasks) {
      const key = `${task.resourceType}:${task.actionType}`;
      const group = byKey.get(key) ?? [];
      group.push(task);
      byKey.set(key, group);
    }

    const batches: ExecutionBatch[] = [];
    for (const [key, group] of byKey) {
      const sorted = [...group].sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.id.localeCompare(b.id);
      });
      for (let start = 0; start < sorted.length; start += maxBatchSize) {
        const slice = sorted.slice(start, start + maxBatchSize);
        const [resourceType, actionType] = key.split(':');
        batches.push({
          id: deterministicUuid(
            'execution-batch',
            `${input.planId}\u0000${key}\u0000${Math.floor(start / maxBatchSize)}`,
          ),
          storeId: input.storeId,
          planId: input.planId,
          resourceType: resourceType as ExecutionBatch['resourceType'],
          actionType: actionType as ExecutionBatch['actionType'],
          taskIds: slice.map((task) => task.id),
          order: 0,
          status: 'PENDING',
          estimatedSeconds: slice.reduce((sum, task) => sum + task.estimatedSeconds, 0),
          apiCalls: slice.length,
        });
      }
    }

    for (const batch of batches) {
      const positions = batch.taskIds
        .map((id) => input.orderOf.get(id))
        .filter((position): position is number => position !== undefined);
      batch.order = positions.length === 0 ? 0 : Math.min(...positions);
    }
    batches.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      const byResource = a.resourceType.localeCompare(b.resourceType);
      if (byResource !== 0) return byResource;
      return a.actionType.localeCompare(b.actionType);
    });
    return batches;
  }
}
