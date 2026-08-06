/**
 * Source collection and integration adapters. `collectSourceData` gathers
 * rows from the structural consumer sources (observability store, learning
 * reader, decision reader, Google clients) and normalizes them into the
 * report-ready `ReportSourceData` bundle. Google responses map through the
 * pure `fromSearchAnalyticsResponse` / `fromGa4Report` functions.
 *
 * All four upstream packages are development-only dependencies; at runtime
 * reports only ever sees these structural shapes.
 */

import type {
  DecisionReaderLike,
  ExecutionPlanLike,
  Ga4RunReportResponseLike,
  RecommendationLike,
  ReportRecommendation,
  ReportSourceData,
  ReportSources,
  SearchAnalyticsResponseLike,
  SearchSeriesRow,
  TrafficSeriesRow,
} from './types.js';
import type { ReportPeriod } from './utils.js';

export interface CollectOptions {
  storeId?: string;
  previousPeriod?: ReportPeriod;
}

/** Maps a Search Analytics API response to daily search rows. */
export function fromSearchAnalyticsResponse(response: SearchAnalyticsResponseLike): SearchSeriesRow[] {
  return response.rows.map((row) => {
    const date = row.keys[0] ?? '';
    return {
      date,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    };
  });
}

/** Maps a GA4 run-report response to daily traffic rows (sessions/users/pageviews). */
export function fromGa4Report(response: Ga4RunReportResponseLike): TrafficSeriesRow[] {
  const indexOf = (name: string): number => response.metricHeaders.indexOf(name);
  const sessionsIndex = indexOf('sessions');
  const usersIndex = indexOf('totalUsers');
  const pageviewsIndex = indexOf('screenPageViews');
  return response.rows.map((row) => {
    const date = row.dimensionValues[0] ?? '';
    const valueAt = (index: number): number => {
      if (index < 0) return 0;
      const raw = row.metricValues[index];
      if (raw === undefined) return 0;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
      date,
      sessions: valueAt(sessionsIndex),
      users: valueAt(usersIndex),
      pageviews: valueAt(pageviewsIndex),
    };
  });
}

function toReportRecommendation(rec: RecommendationLike): ReportRecommendation {
  return {
    id: rec.id,
    rule: rec.rule,
    title: rec.title,
    category: rec.category,
    priority: rec.priority,
    score: rec.score,
    impact: rec.impact,
    effort: rec.effort,
    confidence: rec.confidence,
    affectedUrls: rec.affectedUrls.slice(),
    pageCount: rec.pageCount,
  };
}

function toPlanSummaryRow(plan: ExecutionPlanLike): {
  planId: string;
  status: string;
  risk: string;
  taskCount: number;
  totalImpact: number;
  createdAt: string;
  updatedAt: string;
} {
  return {
    planId: plan.id,
    status: plan.status,
    risk: plan.risk,
    taskCount: plan.tasks.length,
    totalImpact: plan.totalImpact,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

async function collectDecision(
  reader: DecisionReaderLike,
  storeId: string,
): Promise<{ recommendations: ReportRecommendation[]; plans: Array<ReturnType<typeof toPlanSummaryRow>> }> {
  const plans = await reader.listPlans(storeId);
  const decisionIds = [...new Set(plans.map((plan) => plan.decisionId))];
  const recommendations: ReportRecommendation[] = [];
  for (const decisionId of decisionIds) {
    const decision = await reader.getDecision(decisionId);
    if (decision === null) continue;
    for (const rec of decision.recommendations) {
      recommendations.push(toReportRecommendation(rec));
    }
  }
  const deduped: ReportRecommendation[] = [];
  const seen = new Set<string>();
  for (const recommendation of recommendations.sort((a, b) => b.score - a.score || a.rule.localeCompare(b.rule))) {
    if (seen.has(recommendation.id)) continue;
    seen.add(recommendation.id);
    deduped.push(recommendation);
  }
  return {
    recommendations: deduped,
    plans: plans.map(toPlanSummaryRow),
  };
}

/**
 * Gathers all report data for a period. Google data is fetched for a combined
 * range spanning the previous period (when given) so KPI deltas stay accurate.
 */
export async function collectSourceData(
  sources: ReportSources,
  period: ReportPeriod,
  options: CollectOptions = {},
): Promise<ReportSourceData> {
  const storeId = options.storeId;

  const executions = sources.observability === undefined ? [] : await sources.observability.listExecutions({ storeId });
  const snapshots = sources.observability === undefined ? [] : await sources.observability.listSnapshots({ storeId });
  const alerts = sources.observability === undefined ? [] : await sources.observability.listAlerts({ storeId });
  const changes = sources.observability === undefined ? [] : await sources.observability.listChanges({ storeId });

  let analysis: ReportSourceData['analysis'] = null;
  let feedback: ReportSourceData['feedback'] = null;
  let historicalOutcomes: ReportSourceData['historicalOutcomes'] = [];
  if (sources.learning !== undefined) {
    const filter = { storeId: storeId as string | undefined };
    analysis = await sources.learning.analyzeOutcomes(filter);
    feedback = await sources.learning.summarizeFeedback(filter);
    historicalOutcomes = await sources.learning.getHistoricalOutcomes(filter);
  }

  let recommendations: ReportRecommendation[] = [];
  let plans: ReportSourceData['plans'] = [];
  if (sources.decision !== undefined) {
    const collected = await collectDecision(sources.decision, storeId ?? '');
    recommendations = collected.recommendations;
    plans = collected.plans;
  }

  const search: SearchSeriesRow[] = [];
  const traffic: TrafficSeriesRow[] = [];
  const google = sources.google;
  if (google !== undefined) {
    const startDate = options.previousPeriod?.startDate ?? period.startDate;
    const endDate = period.endDate;
    const accessToken = google.tokenProvider === undefined ? '' : await google.tokenProvider.getAccessToken();
    if (google.searchConsole !== undefined && google.siteUrl !== undefined) {
      const response = await google.searchConsole.searchAnalytics(accessToken, google.siteUrl, {
        startDate,
        endDate,
        dimensions: ['date'],
        searchType: google.searchType ?? 'web',
      });
      search.push(...fromSearchAnalyticsResponse(response));
    }
    if (google.analytics !== undefined && google.propertyId !== undefined) {
      const response = await google.analytics.runReport(accessToken, google.propertyId, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }],
      });
      traffic.push(...fromGa4Report(response));
    }
  }

  return {
    period,
    executions,
    snapshots,
    alerts,
    changes,
    analysis,
    feedback,
    historicalOutcomes,
    recommendations,
    plans,
    search,
    traffic,
  };
}
