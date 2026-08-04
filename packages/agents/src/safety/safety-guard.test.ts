import { describe, expect, it } from 'vitest';
import { SafetyViolationError } from '../utils/errors.js';
import { makeInput } from '../test/helpers.js';
import type { AgentAction, AgentResult } from '../types/output.js';
import { DefaultSafetyGuard } from './safety-guard.js';

function action(overrides: Partial<AgentAction> = {}): AgentAction {
  return {
    actionType: 'update_title',
    resourceType: 'page',
    resourceId: 'entity-1',
    resourceRef: 'https://acme.example/p/1',
    payload: { title: 'New title' },
    priority: 50,
    estimatedSeconds: 600,
    rationale: 'Draft title',
    ...overrides,
  };
}

function result(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agentId: 'metadata',
    taskId: 'task-1',
    status: 'SUCCESS',
    recommendations: [],
    actions: [],
    confidence: 0.9,
    risk: 'LOW',
    evidence: [],
    estimatedImpact: 0,
    dependencies: [],
    warnings: [],
    executionHints: [],
    ...overrides,
  };
}

const input = makeInput({
  entities: [{ id: 'entity-1', type: 'page', ref: 'https://acme.example/p/1', data: {} }],
});

describe('DefaultSafetyGuard', () => {
  const guard = new DefaultSafetyGuard();

  it('passes safe results through unchanged when no sensitive fields', () => {
    const out = guard.assertSafeResult(result(), input);
    expect(out).toEqual(result());
  });

  it('throws on rejected action types', () => {
    expect(() => guard.assertSafeResult(result({ actions: [action({ actionType: 'delete_page' })] }), input)).toThrow(SafetyViolationError);
    expect(() => guard.assertSafeResult(result({ actions: [action({ actionType: 'create_page' })] }), input)).toThrow(SafetyViolationError);
  });

  it('throws when an action targets a resource outside the input', () => {
    expect(() =>
      guard.assertSafeResult(result({ actions: [action({ resourceId: 'ghost' })] }), input),
    ).toThrow(/not present in the input/);
  });

  it('throws on invalid payload shapes', () => {
    expect(() =>
      guard.assertSafeResult(result({ actions: [action({ payload: null as never })] }), input),
    ).toThrow(/invalid payload/);
  });

  it('forces approval on HIGH/CRITICAL recommendations with affected urls', () => {
    const out = guard.assertSafeResult(
      result({
        recommendations: [
          {
            rule: 'metadata.x',
            title: 't',
            summary: 's',
            reason: 'r',
            evidence: [],
            severity: 'HIGH',
            confidence: 0.8,
            estimatedImpact: 70,
            risk: 'LOW',
            implementationDifficulty: 'LOW',
            expectedExecutionTime: '1 hour',
            rollbackPossible: true,
            approvalRequired: false,
            affectedUrls: ['https://acme.example/p/1'],
          },
        ],
      }),
      input,
    );
    expect(out.recommendations[0]?.approvalRequired).toBe(true);
  });

  it('does not force approval on low-severity or url-less recommendations', () => {
    const out = guard.assertSafeResult(
      result({
        recommendations: [
          {
            rule: 'metadata.x',
            title: 't',
            summary: 's',
            reason: 'r',
            evidence: [],
            severity: 'LOW',
            confidence: 0.8,
            estimatedImpact: 20,
            risk: 'LOW',
            implementationDifficulty: 'LOW',
            expectedExecutionTime: '1 hour',
            rollbackPossible: true,
            approvalRequired: false,
            affectedUrls: [],
          },
        ],
      }),
      input,
    );
    expect(out.recommendations[0]?.approvalRequired).toBe(false);
  });

  it('marks sensitive action rationales with an approval prefix', () => {
    const out = guard.assertSafeResult(
      result({ actions: [action({ actionType: 'update_robots' })] }),
      input,
    );
    expect(out.actions[0]?.rationale).toMatch(/^\[approval required\]/);
  });
});
