import type { AgentResult } from '../types/agent.js';
import type { StepExecution, WorkflowExecution } from '../types/execution.js';
import type {
  StepStatus,
  WorkflowDefinition,
  WorkflowStatus,
  WorkflowStep,
} from '../types/workflow.js';
import { deterministicUuid, newId } from '../utils/ids.js';

export interface WorkflowExecutionCreateInput {
  definition: WorkflowDefinition;
  storeId: string;
  inputs: Record<string, unknown>;
  now?: () => Date;
}

/** Counts agent (leaf) steps in a definition, used for plan/expectation math. */
export function countAgentSteps(step: WorkflowStep): number {
  switch (step.kind) {
    case 'agent':
      return 1;
    case 'sequential':
    case 'parallel':
      return step.steps.reduce((sum, child) => sum + countAgentSteps(child), 0);
    case 'conditional':
      return (
        step.whenTrue.reduce((sum, child) => sum + countAgentSteps(child), 0) +
        step.whenFalse.reduce((sum, child) => sum + countAgentSteps(child), 0)
      );
  }
}

export interface StepExecutionCreateInput {
  step: WorkflowStep;
  now?: () => Date;
}

/** Pure model for {@link WorkflowExecution} lifecycle state machines. */
export class WorkflowExecutionModel {
  /** Stable execution id derived from the definition + store. */
  static idFor(definitionId: string, storeId: string): string {
    return deterministicUuid(`workflow:${storeId}`, definitionId);
  }

  static create(input: WorkflowExecutionCreateInput): WorkflowExecution {
    const now = input.now ?? (() => new Date());
    return {
      id: WorkflowExecutionModel.idFor(input.definition.id, input.storeId),
      definitionId: input.definition.id,
      definitionVersion: input.definition.version,
      name: input.definition.name,
      storeId: input.storeId,
      status: 'PENDING',
      inputs: input.inputs,
      outputs: {},
      steps: [],
      startedAt: now(),
      completedAt: null,
      error: null,
      cancelledAt: null,
      checkpointedAt: null,
    };
  }

  static createStep(input: StepExecutionCreateInput): StepExecution {
    return {
      id: newId(),
      stepId: input.step.id,
      kind: input.step.kind,
      status: 'PENDING',
      attempt: 0,
      error: null,
      startedAt: null,
      completedAt: null,
    };
  }

  static transition(
    execution: WorkflowExecution,
    status: WorkflowStatus,
    fields: Partial<Pick<WorkflowExecution, 'error' | 'completedAt' | 'cancelledAt'>> = {},
  ): WorkflowExecution {
    return { ...execution, status, ...fields };
  }

  static recordOutput(
    execution: WorkflowExecution,
    stepId: string,
    output: AgentResult,
  ): WorkflowExecution {
    return { ...execution, outputs: { ...execution.outputs, [stepId]: output } };
  }

  static markStep(
    execution: WorkflowExecution,
    stepId: string,
    status: StepStatus,
    fields: Partial<StepExecution> = {},
  ): WorkflowExecution {
    const steps = execution.steps.map((step) =>
      step.stepId === stepId ? { ...step, status, ...fields } : step,
    );
    return { ...execution, steps };
  }

  static checkpoint(execution: WorkflowExecution, now?: () => Date): WorkflowExecution {
    return { ...execution, checkpointedAt: (now ?? (() => new Date()))() };
  }
}
