import type {
  ExecutionBatch,
  ExecutionPlan,
  ExecutionTask,
} from '@seogod/decision-engine';
import type { AgentDefinition, AgentResult, AgentTask } from '../types/agent.js';
import type { PromptContext } from '../types/context.js';
import type { ProviderResponse } from '../types/provider.js';
import type { WorkflowDefinition } from '../types/workflow.js';

/** Deterministic, advancing clock so ordering assertions stay stable. */
export function fixedClock(): () => Date {
  const base = new Date('2026-01-01T00:00:00.000Z');
  let counter = 0;
  return () => new Date(base.getTime() + counter++);
}

export function agentDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'title-writer',
    name: 'Title Writer',
    version: '1.0.0',
    description: 'Writes SEO titles',
    capabilities: ['writing', 'title'],
    supportedTasks: ['update_title'],
    maxConcurrency: 4,
    priority: 10,
    health: { status: 'ok', lastCheckedAt: new Date('2026-01-01T00:00:00.000Z') },
    provider: 'openai',
    model: 'gpt-4o-mini',
    ...overrides,
  };
}

export function promptContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    taskId: 'task-1',
    agentId: 'title-writer',
    storeId: 'store-1',
    sections: [
      { id: 'task-section', kind: 'task', content: { name: 'x' }, size: 2, truncated: false },
    ],
    tokenEstimate: 2,
    ...overrides,
  };
}

export function agentTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
    workflowId: 'workflow-1',
    stepId: 'step-a',
    agentId: 'title-writer',
    name: 'update_title',
    description: 'Write a new title for /p/1',
    input: {},
    context: promptContext(),
    provider: 'openai',
    model: 'gpt-4o-mini',
    expectedSchema: {
      type: 'object',
      required: ['action', 'resourceId'],
      properties: {
        action: { type: 'string', enum: ['update_title'] },
        resourceId: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    allowedActions: ['update_title'],
    ...overrides,
  };
}

export function agentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    taskId: 'task-1',
    stepId: 'step-a',
    agentId: 'title-writer',
    workflowId: 'workflow-1',
    text: '{"action":"update_title","resourceId":"/p/1","title":"New"}',
    data: { action: 'update_title', resourceId: '/p/1', title: 'New' },
    tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    costEstimate: 0.0001,
    latencyMs: 25,
    provider: 'openai',
    model: 'gpt-4o-mini',
    completedAt: new Date('2026-01-01T00:00:00.100Z'),
    ...overrides,
  };
}

export function providerResponse(overrides: Partial<ProviderResponse> = {}): ProviderResponse {
  return {
    text: '{"action":"update_title","resourceId":"/p/1"}',
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    model: 'gpt-4o-mini',
    ...overrides,
  };
}

export function workflowDefinition(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    id: 'workflow-def',
    name: 'plan-workflow',
    description: 'test',
    version: 1,
    steps: [],
    timeoutMs: 0,
    defaultMaxAttempts: 1,
    ...overrides,
  };
}

export function executionTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    id: 't-1',
    storeId: 'store-1',
    decisionId: 'decision-1',
    planId: 'plan-1',
    recommendationId: 'rec-1',
    rule: 'missing-title',
    actionType: 'update_title',
    resourceType: 'page',
    resourceId: '/p/1',
    resourceRef: '/p/1',
    payload: { title: 'New' },
    priority: 50,
    status: 'PENDING',
    dependsOn: [],
    isMutating: false,
    risk: 'LOW',
    estimatedSeconds: 1,
    rollback: null,
    result: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function executionBatch(overrides: Partial<ExecutionBatch> = {}): ExecutionBatch {
  return {
    id: 'batch-1',
    storeId: 'store-1',
    planId: 'plan-1',
    resourceType: 'page',
    actionType: 'update_title',
    taskIds: ['t-1'],
    order: 1,
    status: 'PENDING',
    estimatedSeconds: 1,
    apiCalls: 1,
    ...overrides,
  };
}

export function executionPlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  const tasks = [executionTask()];
  return {
    id: 'plan-1',
    storeId: 'store-1',
    decisionId: 'decision-1',
    status: 'APPROVED',
    version: 1,
    tasks,
    batches: [executionBatch({ taskIds: tasks.map((task) => task.id) })],
    orderedTaskIds: tasks.map((task) => task.id),
    dependencies: [],
    approvalRequestId: 'approval-1',
    estimatedDurationMinutes: 1,
    totalEffortHours: 0.5,
    totalImpact: 10,
    risk: 'LOW',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}
