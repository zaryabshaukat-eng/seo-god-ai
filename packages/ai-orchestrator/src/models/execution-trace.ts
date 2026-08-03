import type { ExecutionTrace, TraceEvent } from '../types/execution.js';
import { deterministicUuid, newId } from '../utils/ids.js';

export interface TraceEventInput {
  executionId: string;
  type: string;
  stepId?: string;
  attempt?: number;
  data?: Record<string, unknown>;
}

/** Append-only trace of workflow lifecycle events. */
export class ExecutionTraceModel {
  static idFor(executionId: string): string {
    return deterministicUuid('trace', executionId);
  }

  static create(executionId: string): ExecutionTrace {
    return { id: ExecutionTraceModel.idFor(executionId), executionId, events: [] };
  }

  static append(trace: ExecutionTrace, input: TraceEventInput, now: () => Date = () => new Date()): ExecutionTrace {
    const event: TraceEvent = {
      id: newId(),
      executionId: input.executionId,
      type: input.type,
      stepId: input.stepId,
      attempt: input.attempt,
      data: input.data,
      at: now(),
    };
    return { ...trace, events: [...trace.events, event] };
  }
}
