import { describe, expect, it } from 'vitest';
import { ReportingAgent } from './reporting-agent.js';
import { makeInput } from '../test/helpers.js';
import type { AgentRecommendation } from '../types/output.js';

function recommendation(rule: string, severity: AgentRecommendation['severity'], impact: number): AgentRecommendation {
  return {
    rule,
    title: rule,
    summary: 's',
    reason: 'r',
    evidence: [],
    severity,
    confidence: 0.8,
    estimatedImpact: impact,
    risk: 'LOW',
    implementationDifficulty: 'LOW',
    expectedExecutionTime: '1 hour',
    rollbackPossible: true,
    approvalRequired: false,
    affectedUrls: ['https://acme.example/p/1'],
  };
}

describe('ReportingAgent', () => {
  it('aggregates recommendations from a report array', () => {
    const out = new ReportingAgent().analyze(
      makeInput({
        context: {
          report: [
            recommendation('metadata.title', 'HIGH', 80),
            recommendation('technical-seo.canonical', 'MEDIUM', 50),
          ],
        },
      }),
    );
    const summary = out.recommendations.find((entry) => entry.rule === 'reporting.summary');
    expect(summary?.summary).toContain('2 recommendation(s)');
    expect(out.recommendations.some((entry) => entry.rule === 'reporting.top-opportunities')).toBe(true);
    expect(out.dependencies).toContain('metadata');
  });

  it('flattens nested source recommendations', () => {
    const out = new ReportingAgent().analyze(
      makeInput({
        context: {
          report: [{ recommendations: [recommendation('metadata.title', 'HIGH', 80)] }],
        },
      }),
    );
    expect(out.recommendations.find((entry) => entry.rule === 'reporting.summary')?.summary).toContain('1 recommendation(s)');
  });

  it('flattens a report object with recommendations', () => {
    const out = new ReportingAgent().analyze(
      makeInput({
        context: {
          report: { recommendations: [recommendation('metadata.title', 'HIGH', 80)] },
        },
      }),
    );
    expect(out.recommendations.find((entry) => entry.rule === 'reporting.summary')).toBeDefined();
  });

  it('handles an empty context gracefully', () => {
    const out = new ReportingAgent().analyze(makeInput({}));
    expect(out.recommendations).toHaveLength(1);
    expect(out.recommendations[0]?.estimatedImpact).toBe(0);
    expect(out.confidence).toBe(0.9);
  });

  it('caps estimated impact at 100', () => {
    const out = new ReportingAgent().analyze(
      makeInput({
        context: { report: [recommendation('a.x', 'CRITICAL', 90), recommendation('b.x', 'CRITICAL', 90)] },
      }),
    );
    expect(out.estimatedImpact).toBe(100);
  });

  it('handles recommendations without affected urls', () => {
    const rec: AgentRecommendation = {
      ...recommendation('metadata.title', 'HIGH', 80),
      affectedUrls: [],
    };
    const out = new ReportingAgent().analyze(makeInput({ context: { report: [rec] } }));
    const top = out.recommendations.find((entry) => entry.rule === 'reporting.top-opportunities');
    expect(top?.evidence[0]?.url).toBe('');
  });

  it('ignores empty or malformed report entries', () => {
    const out = new ReportingAgent().analyze(
      makeInput({ context: { report: [{}, { recommendations: [] }, 'nope'] } }),
    );
    expect(out.recommendations).toHaveLength(1);
    expect(out.recommendations[0]?.rule).toBe('reporting.summary');
  });
});
