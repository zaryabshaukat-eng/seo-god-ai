import { describe, expect, it } from 'vitest';
import { BaseAgent } from './base-agent.js';
import { AGENT_INPUT_SCHEMA, AGENT_OUTPUT_SCHEMA } from './agent-schemas.js';
import type { AgentEntityInput, AgentInput } from '../types/input.js';
import type { AgentActionType, AgentResourceType, AgentResult } from '../types/output.js';
import { makeInput, makeEntity } from '../test/helpers.js';

class TestAgent extends BaseAgent {
  readonly id = 'test-agent';
  readonly name = 'Test Agent';
  readonly version = '1.0.0';
  readonly description = 'test';
  readonly capabilities = ['cap-a'];
  readonly supportedTasks = ['task-a'];
  readonly supportedEntities: AgentResourceType[] = ['page'];
  readonly supportedActionTypes: AgentActionType[] = ['update_title'];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'metadata';

  analyze(input: AgentInput): AgentResult {
    const entity = this.entityOfType(input, 'page');
    const recommendations = entity
      ? [
          this.buildRecommendation({
            rule: this.rule('missing'),
            title: 't',
            summary: 's',
            reason: 'r',
            severity: 'HIGH',
            confidence: 0.9,
            risk: 'MEDIUM',
            evidence: [this.evidenceFor(entity, 'field', this.stringValue(entity.data, 'title') ?? '')],
          }),
        ]
      : [];
    const actions = entity
      ? [
          this.buildAction({
            actionType: 'update_title',
            resourceType: 'page',
            resourceId: entity.id,
            resourceRef: entity.ref,
            payload: { title: this.stringValue(entity.data, 'title') ?? '' },
          }),
        ]
      : [];
    return this.result({ input, recommendations, actions });
  }

  /** Public probe exercising every explicit builder override. */
  buildFull(): AgentResult {
    const input = makeInput({ entities: [makeEntity({ data: { title: 'Hi' } })] });
    const entity = this.entityOfType(input, 'page');
    if (!entity) {
      throw new Error('missing entity');
    }
    const evidence = this.evidenceFor(entity, 'field', 'v');
    const recommendation = this.buildRecommendation({
      rule: this.rule('full'),
      title: 't',
      summary: 's',
      reason: 'r',
      severity: 'INFO',
      confidence: 0.5,
      estimatedImpact: 10,
      risk: 'HIGH',
      implementationDifficulty: 'HIGH',
      expectedExecutionTime: 'x',
      rollbackPossible: false,
      approvalRequired: true,
      evidence: [evidence],
      affectedUrls: ['/u'],
    });
    const fallbackRecommendation = this.buildRecommendation({
      rule: this.rule('full'),
      title: 't2',
      summary: 's2',
      reason: 'r2',
    });
    const action = this.buildAction({
      actionType: 'update_title',
      resourceType: 'page',
      resourceId: entity.id,
      resourceRef: entity.ref,
      payload: { title: 'x' },
      priority: 5,
      estimatedSeconds: 3,
      rationale: 'because',
    });
    return this.result({
      input,
      status: 'PARTIAL',
      recommendations: [recommendation, fallbackRecommendation],
      actions: [action],
      confidence: 0.4,
      risk: 'MEDIUM',
      estimatedImpact: 5,
      evidence: [this.evidenceFor(entity, 'other', 1)],
      dependencies: ['d'],
      warnings: ['w'],
      executionHints: ['h'],
    });
  }

  /** Public probe over the protected accessors for test assertions. */
  probe(input: AgentInput): {
    pages: AgentEntityInput[];
    string: string | undefined;
    number: number | undefined;
    boolean: boolean | undefined;
    list: unknown[];
    rule: string;
  } {
    const first = this.entityOfType(input, 'page');
    return {
      pages: this.entitiesOfType(input, 'page'),
      string: first ? this.stringValue(first.data, 'title') : undefined,
      number: first ? this.numberValue(first.data, 'count') : undefined,
      boolean: first ? this.booleanValue(first.data, 'ok') : undefined,
      list: first ? this.listValue(first.data, 'tags') : [],
      rule: this.rule('x'),
    };
  }
}

describe('BaseAgent', () => {
  it('definition snapshots metadata and health', () => {
    const agent = new TestAgent();
    const definition = agent.definition();
    expect(definition.id).toBe('test-agent');
    expect(definition.capabilities).toEqual(['cap-a']);
    expect(definition.health.status).toBe('ok');
    expect(definition.health.lastCheckedAt).toBeInstanceOf(Date);
  });

  it('rule produces stable namespaced ids', () => {
    expect(new TestAgent().probe(makeInput()).rule).toBe('test-agent.x');
  });

  it('buildRecommendation applies overrides and evidence', () => {
    const agent = new TestAgent();
    const recommendation = agent.analyze(
      makeInput({ entities: [makeEntity({ data: { title: 'Hi' } })] }),
    ).recommendations[0];
    expect(recommendation?.severity).toBe('HIGH');
    expect(recommendation?.confidence).toBe(0.9);
    expect(recommendation?.evidence).toHaveLength(1);
    expect(recommendation?.affectedUrls).toEqual([]);
  });

  it('result derives confidence, risk and impact defaults', () => {
    const agent = new TestAgent();
    const out = agent.analyze(makeInput({ entities: [makeEntity({ data: { title: 'Hi' } })] }));
    expect(out.agentId).toBe('test-agent');
    expect(out.taskId).toBe('task-1');
    expect(out.status).toBe('SUCCESS');
    expect(out.confidence).toBe(0.9);
    expect(out.risk).toBe('MEDIUM');
    expect(out.actions[0]?.priority).toBe(50);
    expect(out.actions[0]?.estimatedSeconds).toBe(600);
    expect(out.actions[0]?.rationale).toBe('');
  });

  it('result handles empty inputs with sensible defaults', () => {
    const agent = new TestAgent();
    const out = agent.analyze(makeInput());
    expect(out.recommendations).toEqual([]);
    expect(out.actions).toEqual([]);
    expect(out.confidence).toBe(0.9);
    expect(out.risk).toBe('LOW');
    expect(out.estimatedImpact).toBe(0);
  });

  it('builders honour every explicit override', () => {
    const agent = new TestAgent();
    const out = agent.buildFull();
    expect(out.status).toBe('PARTIAL');
    expect(out.confidence).toBe(0.4);
    expect(out.risk).toBe('MEDIUM');
    expect(out.estimatedImpact).toBe(5);
    expect(out.dependencies).toEqual(['d']);
    expect(out.warnings).toEqual(['w']);
    expect(out.executionHints).toEqual(['h']);
    const rec = out.recommendations[0];
    expect(rec?.severity).toBe('INFO');
    expect(rec?.confidence).toBe(0.5);
    expect(rec?.estimatedImpact).toBe(10);
    expect(rec?.risk).toBe('HIGH');
    expect(rec?.implementationDifficulty).toBe('HIGH');
    expect(rec?.expectedExecutionTime).toBe('x');
    expect(rec?.rollbackPossible).toBe(false);
    expect(rec?.approvalRequired).toBe(true);
    expect(rec?.evidence).toHaveLength(1);
    expect(rec?.affectedUrls).toEqual(['/u']);
    const action = out.actions[0];
    expect(action?.priority).toBe(5);
    expect(action?.estimatedSeconds).toBe(3);
    expect(action?.rationale).toBe('because');
  });

  it('accessors filter entities and read typed values', () => {
    const agent = new TestAgent();
    const input = makeInput({
      entities: [
        makeEntity({ id: 'p1', data: { title: 'Hello', count: 3, ok: true, tags: ['a'] } }),
        makeEntity({ id: 'p2', type: 'product', data: {} }),
      ],
    });
    const probe = agent.probe(input);
    expect(probe.pages).toHaveLength(1);
    expect(probe.string).toBe('Hello');
    expect(probe.number).toBe(3);
    expect(probe.boolean).toBe(true);
    expect(probe.list).toEqual(['a']);
  });

  it('accessors return safe defaults for missing/mistyped values', () => {
    const agent = new TestAgent();
    const input = makeInput({
      entities: [makeEntity({ id: 'p1', data: { title: 42, count: 'x', ok: 'nope', tags: 'nope' } })],
    });
    const probe = agent.probe(input);
    expect(probe.string).toBeUndefined();
    expect(probe.number).toBeUndefined();
    expect(probe.boolean).toBeUndefined();
    expect(probe.list).toEqual([]);
  });
});
