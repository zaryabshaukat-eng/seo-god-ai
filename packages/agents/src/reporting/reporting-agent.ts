import { AGENT_INPUT_SCHEMA, AGENT_OUTPUT_SCHEMA } from '../base/agent-schemas.js';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentInput } from '../types/input.js';
import type {
  AgentActionType,
  AgentRecommendation,
  AgentResourceType,
  AgentResult,
  Severity,
} from '../types/output.js';

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

interface ReportSource {
  recommendations: AgentRecommendation[];
}

function isRecommendation(value: unknown): value is AgentRecommendation {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AgentRecommendation).rule === 'string'
  );
}

/** Normalizes the many shapes a report context can take into one list. */
function flattenRecommendations(context: Record<string, unknown> | undefined): AgentRecommendation[] {
  const report = context?.['report'];
  const result: AgentRecommendation[] = [];
  if (Array.isArray(report)) {
    for (const item of report) {
      if (isRecommendation(item)) {
        result.push(item);
      } else if (typeof item === 'object' && item !== null) {
        const source = item as Partial<ReportSource>;
        if (Array.isArray(source.recommendations)) {
          result.push(...source.recommendations);
        }
      }
    }
  } else if (typeof report === 'object' && report !== null) {
    const source = report as Partial<ReportSource>;
    if (Array.isArray(source.recommendations)) {
      result.push(...source.recommendations);
    }
  }
  return result;
}

/**
 * Consumes other agents' recommendations and produces a deterministic
 * aggregate summary. Never proposes actions.
 */
export class ReportingAgent extends BaseAgent {
  readonly id = 'reporting';
  readonly name = 'Reporting Agent';
  readonly version = '1.0.0';
  readonly description = "Consumes other agents' results and produces an aggregated summary.";
  readonly capabilities = ['aggregation', 'reporting'];
  readonly supportedTasks = ['aggregate-recommendations', 'build-report'];
  readonly supportedEntities: AgentResourceType[] = [];
  readonly supportedActionTypes: AgentActionType[] = [];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'reporting';

  analyze(input: AgentInput): AgentResult {
    const recommendations = flattenRecommendations(input.context);
    const bySeverity = new Map<Severity, number>();
    for (const severity of SEVERITY_ORDER) {
      bySeverity.set(severity, 0);
    }
    for (const recommendation of recommendations) {
      bySeverity.set(
        recommendation.severity,
        (bySeverity.get(recommendation.severity) ?? 0) + 1,
      );
    }
    const total = recommendations.length;
    const totalImpact = recommendations.reduce(
      (sum, recommendation) => sum + recommendation.estimatedImpact,
      0,
    );
    const confidence =
      recommendations.length === 0
        ? 0.9
        : recommendations.reduce((sum, r) => sum + r.confidence, 0) / recommendations.length;

    const outputs: AgentRecommendation[] = [];
    outputs.push(
      this.buildRecommendation({
        rule: this.rule('summary'),
        title: 'Aggregate recommendation summary',
        summary: `${total} recommendation(s) across ${new Set(recommendations.map((r) => r.rule.split('.')[0])).size} agent(s).`,
        reason: `Aggregate of ${total} recommendation(s) with combined estimated impact of ${totalImpact}.`,
        severity: 'INFO',
        confidence,
        estimatedImpact: totalImpact === 0 ? 0 : Math.min(100, totalImpact),
        risk: 'LOW',
        implementationDifficulty: 'TRIVIAL',
        expectedExecutionTime: '0 minutes',
        rollbackPossible: true,
        evidence: [...bySeverity.entries()].map(([severity, count]) => ({
          url: '',
          field: `severity.${severity.toLowerCase()}`,
          value: count,
        })),
      }),
    );

    const top = [...recommendations]
      .sort((a, b) => b.estimatedImpact - a.estimatedImpact)
      .slice(0, 5);
    if (top.length > 0) {
      outputs.push(
        this.buildRecommendation({
          rule: this.rule('top-opportunities'),
          title: 'Top opportunities',
          summary: top.map((r) => r.title).join('; '),
          reason: 'Highest-estimated-impact recommendations across all agents.',
          severity: 'INFO',
          confidence,
          estimatedImpact: top[0]?.estimatedImpact ?? 0,
          risk: 'LOW',
          implementationDifficulty: 'TRIVIAL',
          expectedExecutionTime: '0 minutes',
          rollbackPossible: true,
          evidence: top.map((r) => ({
            url: r.affectedUrls[0] ?? '',
            field: 'opportunity',
            value: r.estimatedImpact,
            snippet: r.title,
          })),
        }),
      );
    }

    return this.result({
      input,
      recommendations: outputs,
      confidence,
      risk: 'LOW',
      estimatedImpact: totalImpact === 0 ? 0 : Math.min(100, totalImpact),
      dependencies: ['metadata', 'technical-seo', 'content', 'keyword', 'schema'],
    });
  }
}
