import { AGENT_INPUT_SCHEMA, AGENT_OUTPUT_SCHEMA } from '../base/agent-schemas.js';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentInput } from '../types/input.js';
import type {
  AgentActionType,
  AgentRecommendation,
  AgentResourceType,
  AgentResult,
} from '../types/output.js';

const LOW_CTR = 0.02;
const LOW_IMPRESSIONS = 100;
const POOR_POSITION = 10;

interface MetricRecord {
  url: string;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  position?: number;
  sessions?: number;
}

function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function metricsOf(context: Record<string, unknown> | undefined): MetricRecord[] {
  const source = context?.['outcomes'] ?? context?.['analytics'];
  const list: unknown[] = Array.isArray(source)
    ? source
    : typeof source === 'object' && source !== null && Array.isArray((source as { outcomes?: unknown }).outcomes)
      ? (source as { outcomes: unknown[] }).outcomes
      : [];
  const metrics: MetricRecord[] = [];
  for (const item of list) {
    if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>;
      const url = typeof record['url'] === 'string' ? record['url'] : '';
      if (url.length === 0) continue;
      metrics.push({
        url,
        impressions: numberOr(record['impressions']),
        clicks: numberOr(record['clicks']),
        ctr: numberOr(record['ctr']),
        position: numberOr(record['position']),
        sessions: numberOr(record['sessions']),
      });
    }
  }
  return metrics;
}

/**
 * Analyzes measured performance data and identifies underperforming pages as
 * opportunities. Never proposes actions.
 */
export class AnalyticsAgent extends BaseAgent {
  readonly id = 'analytics';
  readonly name = 'Analytics Agent';
  readonly version = '1.0.0';
  readonly description = 'Analyzes measured outcomes (impressions, clicks, CTR, positions) for opportunities.';
  readonly capabilities = ['performance-analysis', 'opportunity-detection'];
  readonly supportedTasks = ['analyze-outcomes', 'find-opportunities'];
  readonly supportedEntities: AgentResourceType[] = [];
  readonly supportedActionTypes: AgentActionType[] = [];
  readonly inputSchema = AGENT_INPUT_SCHEMA;
  readonly outputSchema = AGENT_OUTPUT_SCHEMA;
  readonly promptId = 'analytics';

  analyze(input: AgentInput): AgentResult {
    const recommendations: AgentRecommendation[] = [];
    const metrics = metricsOf(input.context);

    for (const metric of metrics) {
      this.analyzeMetric(metric, recommendations);
    }

    return this.result({
      input,
      recommendations,
      dependencies: ['reporting'],
      warnings: metrics.length === 0 ? ['No outcome data was provided.'] : [],
    });
  }

  private analyzeMetric(
    metric: MetricRecord,
    recommendations: AgentRecommendation[],
  ): void {
    const ctr = metric.ctr ?? (metric.impressions !== undefined && metric.impressions > 0 && metric.clicks !== undefined ? metric.clicks / metric.impressions : undefined);
    if (ctr !== undefined && ctr < LOW_CTR) {
      this.pushRecommendation(
        recommendations,
        metric,
        'low-ctr',
        'Low click-through rate',
        `Page CTR is ${formatRate(ctr)}; the title and meta description are underperforming.`,
        ctr,
      );
    }
    if (metric.impressions !== undefined && metric.impressions < LOW_IMPRESSIONS) {
      this.pushRecommendation(
        recommendations,
        metric,
        'low-visibility',
        'Low search visibility',
        `Page has only ${metric.impressions} impressions; improve content and targeting.`,
        metric.impressions,
      );
    }
    if (metric.position !== undefined && metric.position > POOR_POSITION) {
      this.pushRecommendation(
        recommendations,
        metric,
        'poor-ranking',
        'Page ranks below the fold',
        `Page ranks at position ${metric.position}; prioritize it for optimization.`,
        metric.position,
      );
    }
  }

  private pushRecommendation(
    recommendations: AgentRecommendation[],
    metric: MetricRecord,
    rule: string,
    title: string,
    reason: string,
    value: string | number | boolean | null,
  ): void {
    recommendations.push(
      this.buildRecommendation({
        rule: this.rule(rule),
        title,
        summary: reason,
        reason,
        severity: 'MEDIUM',
        confidence: 0.65,
        estimatedImpact: rule === 'low-ctr' ? 55 : 40,
        risk: 'LOW',
        implementationDifficulty: 'MEDIUM',
        expectedExecutionTime: '1 hour',
        rollbackPossible: true,
        evidence: [
          {
            url: metric.url,
            field: 'current.analytics',
            value,
          },
        ],
        affectedUrls: [metric.url],
      }),
    );
  }
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
