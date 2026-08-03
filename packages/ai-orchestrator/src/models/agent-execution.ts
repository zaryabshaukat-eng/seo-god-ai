import type { AgentExecution, AgentExecutionStatus } from '../types/execution.js';
import { newId } from '../utils/ids.js';

export interface AgentExecutionCreateInput {
  taskId: string;
  stepId: string;
  agentId: string;
  workflowId: string;
  storeId: string;
  provider: string;
  model: string;
  attempt: number;
  now?: () => Date;
}

/** Pure factory for {@link AgentExecution} records (one per attempt). */
export class AgentExecutionModel {
  static create(input: AgentExecutionCreateInput): AgentExecution {
    const now = input.now ?? (() => new Date());
    return {
      id: newId(),
      taskId: input.taskId,
      stepId: input.stepId,
      agentId: input.agentId,
      workflowId: input.workflowId,
      storeId: input.storeId,
      provider: input.provider,
      model: input.model,
      status: 'RUNNING',
      attempt: input.attempt,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costEstimate: 0,
      latencyMs: 0,
      error: null,
      startedAt: now(),
      completedAt: null,
    };
  }

  static complete(
    execution: AgentExecution,
    result: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costEstimate: number;
      latencyMs: number;
    },
    now?: () => Date,
  ): AgentExecution {
    return {
      ...execution,
      status: 'COMPLETED',
      ...result,
      completedAt: (now ?? (() => new Date()))(),
    };
  }

  static fail(
    execution: AgentExecution,
    error: string,
    now?: () => Date,
  ): AgentExecution {
    return {
      ...execution,
      status: 'FAILED',
      error,
      completedAt: (now ?? (() => new Date()))(),
    };
  }

  static setStatus(
    execution: AgentExecution,
    status: AgentExecutionStatus,
    now?: () => Date,
  ): AgentExecution {
    return {
      ...execution,
      status,
      completedAt: (now ?? (() => new Date()))(),
    };
  }
}
