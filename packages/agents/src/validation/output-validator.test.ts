import { ValidationError } from '@seogod/core';
import { describe, expect, it } from 'vitest';
import { makeResult, StubAgent } from '../test/helpers.js';
import type { AgentResult, RecommendationEvidence } from '../types/output.js';
import { OutputValidator } from './output-validator.js';

const agent = new StubAgent('metadata', () => makeResult('metadata', 'task-1'));

function result(overrides: Partial<AgentResult> = {}): AgentResult {
  return makeResult('metadata', 'task-1', overrides);
}

describe('OutputValidator', () => {
  it('accepts a contract-conformant result', () => {
    const validator = new OutputValidator();
    expect(validator.isValid(result(), agent)).toBe(true);
    expect(() => validator.assertValid(result(), agent)).not.toThrow();
  });

  it('rejects a mismatched agent id', () => {
    const failures = new OutputValidator().validate(result({ agentId: 'other' }), agent);
    expect(failures).toContainEqual({
      code: 'structure',
      path: '$.agentId',
      message: 'expected "metadata", got "other"',
    });
  });

  it('rejects an empty task id', () => {
    const failures = new OutputValidator().validate(result({ taskId: '' }), agent);
    expect(failures).toContainEqual({
      code: 'structure',
      path: '$.taskId',
      message: 'must be a non-empty string',
    });
  });

  it('rejects unknown status and out-of-bounds numbers', () => {
    const failures = new OutputValidator().validate(
      result({
        status: 'BOGUS' as never,
        confidence: 1.5,
        estimatedImpact: -2,
        risk: 'EXTREME' as never,
      }),
      agent,
    );
    const codes = failures.map((failure) => failure.code);
    expect(codes).toContain('structure');
    expect(codes).toContain('bound');
  });

  it('rejects non-array collection fields', () => {
    const failures = new OutputValidator().validate(
      result({ recommendations: null as unknown as [] }),
      agent,
    );
    expect(failures).toContainEqual({
      code: 'structure',
      path: '$.recommendations',
      message: 'must be an array',
    });
  });

  it('rejects non-array actions', () => {
    const failures = new OutputValidator().validate(result({ actions: null as unknown as [] }), agent);
    expect(failures).toContainEqual({
      code: 'structure',
      path: '$.actions',
      message: 'must be an array',
    });
  });

  it('rejects NaN numbers', () => {
    const failures = new OutputValidator().validate(result({ confidence: Number.NaN }), agent);
    expect(failures).toContainEqual({
      code: 'structure',
      path: '$.confidence',
      message: 'must be a number',
    });
  });

  it('rejects malformed evidence entries', () => {
    const failures = new OutputValidator().validate(
      result({ evidence: [{ url: 1 } as unknown as RecommendationEvidence] }),
      agent,
    );
    expect(failures).toContainEqual({
      code: 'structure',
      path: '$.evidence',
      message: 'invalid evidence entry',
    });
  });

  it('validates each recommendation field', () => {
    const failures = new OutputValidator().validate(
      result({
        recommendations: [
          {
            rule: '',
            title: '',
            summary: '',
            reason: '',
            expectedExecutionTime: '',
            severity: 'HORRIBLE' as never,
            risk: 'LOW',
            implementationDifficulty: 'LOW',
            confidence: 1.2,
            estimatedImpact: -1,
            rollbackPossible: 'yes' as unknown as boolean,
            approvalRequired: false,
            affectedUrls: [1 as unknown as string],
            evidence: [{ url: 1, field: 'f' } as unknown as RecommendationEvidence],
          },
        ],
      }),
      agent,
    );
    const paths = failures.map((failure) => failure.path);
    expect(paths).toContain('$.recommendations[0].rule');
    expect(paths).toContain('$.recommendations[0].severity');
    expect(paths).toContain('$.recommendations[0].confidence');
    expect(paths).toContain('$.recommendations[0].rollbackPossible');
    expect(paths).toContain('$.recommendations[0].affectedUrls');
    expect(paths).toContain('$.recommendations[0].evidence[0]');
  });

  it('rejects unsupported and hallucinated action types', () => {
    const failures = new OutputValidator().validate(
      result({
        actions: [
          {
            actionType: 'teleport_page' as never,
            resourceType: 'page',
            resourceId: 'p1',
            resourceRef: 'r',
            payload: {},
            priority: 1,
            estimatedSeconds: 1,
            rationale: 'x',
          },
          {
            actionType: 'update_alt_text',
            resourceType: 'page',
            resourceId: 'p1',
            resourceRef: 'r',
            payload: {},
            priority: 1,
            estimatedSeconds: 1,
            rationale: 'x',
          },
        ],
      }),
      agent,
    );
    expect(failures).toContainEqual(
      expect.objectContaining({ code: 'unsupported-operation', path: '$.actions[0].actionType' }),
    );
    expect(failures).toContainEqual(
      expect.objectContaining({ code: 'hallucinated-action', path: '$.actions[1].actionType' }),
    );
  });

  it('rejects unknown resource types and malformed action fields', () => {
    const failures = new OutputValidator().validate(
      result({
        actions: [
          {
            actionType: 'update_title',
            resourceType: 'video' as never,
            resourceId: '',
            resourceRef: '',
            payload: [] as unknown as Record<string, unknown>,
            priority: 150,
            estimatedSeconds: -1,
            rationale: '',
          },
        ],
      }),
      agent,
    );
    expect(failures).toContainEqual(
      expect.objectContaining({ code: 'unsupported-operation', path: '$.actions[0].resourceType' }),
    );
    expect(failures).toContainEqual(expect.objectContaining({ path: '$.actions[0].payload' }));
    expect(failures).toContainEqual(expect.objectContaining({ path: '$.actions[0].priority' }));
    expect(failures).toContainEqual(expect.objectContaining({ path: '$.actions[0].estimatedSeconds' }));
  });

  it('assertValid throws a ValidationError with failure context', () => {
    let thrown: unknown;
    try {
      new OutputValidator().assertValid(result({ agentId: 'other' }), agent);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
  });

  it('surfaces schema violations from the output schema', () => {
    const failures = new OutputValidator().validate(
      result({ executionHints: ['ok', 1 as never] }),
      agent,
    );
    expect(failures.some((failure) => failure.code === 'schema')).toBe(true);
  });
});
