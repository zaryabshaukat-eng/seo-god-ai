import { describe, expect, it } from 'vitest';
import { AgentRunModel } from './agent-run.js';
import type { BuildAgentRunOptions } from './agent-run.js';

function baseOptions(overrides: Partial<BuildAgentRunOptions> = {}): BuildAgentRunOptions {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    agentId: 'metadata',
    name: 'Metadata Agent',
    version: '1.0.0',
    taskId: 'task-1',
    workflowId: 'workflow-1',
    storeId: 'store-1',
    status: 'SUCCESS',
    startedAt: now,
    completedAt: now,
    durationMs: 10,
    tokenEstimate: 100,
    costEstimate: 0.0002,
    confidence: 0.9,
    risk: 'LOW',
    recommendationCount: 1,
    actionCount: 0,
    ...overrides,
  };
}

describe('AgentRunModel', () => {
  it('builds a run with a generated id', () => {
    const run = AgentRunModel.build(baseOptions());
    expect(run.id.length).toBeGreaterThan(0);
    expect(run.agentId).toBe('metadata');
    expect(run.taskId).toBe('task-1');
  });

  it('honors an explicit id and optional fields', () => {
    const run = AgentRunModel.build(
      baseOptions({ id: 'run-1', model: 'gpt-4', error: 'nope' }),
    );
    expect(run.id).toBe('run-1');
    expect(run.model).toBe('gpt-4');
    expect(run.error).toBe('nope');
  });

  it('omits model and error when not provided', () => {
    const run = AgentRunModel.build(baseOptions());
    expect('model' in run).toBe(false);
    expect('error' in run).toBe(false);
  });

  it('builds a failed run with risk HIGH', () => {
    const run = AgentRunModel.build(baseOptions({ status: 'FAILED', risk: 'HIGH' }));
    expect(run.status).toBe('FAILED');
    expect(run.risk).toBe('HIGH');
  });
});
