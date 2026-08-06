/**
 * Platform data sources and pure aggregators.
 *
 * The copilot never imports the platform runtime packages. Instead it reads
 * through narrow structural interfaces (`CopilotSources`) that a host
 * application wires to the real services. Thin adapters are provided for the
 * observability, learning-engine, reports and decision-engine services, and
 * every aggregation the tools rely on is a pure function over those sources.
 */

// ---------------------------------------------------------------------------
// Recommendation data
// ---------------------------------------------------------------------------

export interface CopilotRecommendation {
  id: string;
  rule: string;
  title: string;
  description: string;
  rationale: string;
  recommendedAction: string;
  priority: string;
  score: number;
  impact: string;
  effort: string;
  confidence: number;
  affectedUrls: string[];
  pageCount: number;
}

export interface RecommendationFilter {
  storeId?: string;
  rule?: string;
  limit?: number;
}

export interface RecommendationsSource {
  listRecommendations(filter?: RecommendationFilter): Promise<CopilotRecommendation[]>;
}

// ---------------------------------------------------------------------------
// Observability data
// ---------------------------------------------------------------------------

export interface CrawlSummary {
  storeId?: string;
  latestScore: number | null;
  previousScore: number | null;
  delta: number | null;
  pagesCrawled: number | null;
  totalIssues: number | null;
  brokenLinks: number | null;
  snapshots: number;
}

export interface ExecutionSummary {
  storeId?: string;
  totalExecutions: number;
  queued: number;
  executing: number;
  completed: number;
  failed: number;
  cancelled: number;
  rolledBack: number;
  successRate: number;
  failureRate: number;
  rollbackRate: number;
  averageExecutionTimeMs: number;
  p95ExecutionTimeMs: number;
  validationFailures: number;
  safetyViolations: number;
  totalRollbacks: number;
  crawlSuccessRate: number;
  simulated: number;
}

export interface AlertSummaryItem {
  alertId: string;
  type: string;
  severity: string;
  message: string;
  triggeredAt: string;
}

export interface AlertsSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  items: AlertSummaryItem[];
}

export interface ObservabilitySource {
  overview(storeId?: string): Promise<ObservabilityOverviewLike>;
  crawlSummary(storeId?: string): Promise<CrawlSummary>;
  executionSummary(storeId?: string): Promise<ExecutionSummary>;
  alerts(storeId?: string, limit?: number): Promise<AlertsSummary>;
}

export interface ObservabilityOverviewLike {
  storeCount: number;
  executionCount: number;
  activeExecutionCount: number;
  completedCount: number;
  failedCount: number;
  rolledBackCount: number;
  alertCount: number;
  openAlertCount: number;
  latestSeoScore: number | null;
  latestExecutionAt: string | null;
  successRate: number;
}

// ---------------------------------------------------------------------------
// Learning data
// ---------------------------------------------------------------------------

export interface RulePerformanceLike {
  rule: string;
  attempts: number;
  successes: number;
  failures: number;
  rolledBack: number;
  successRate: number;
  averageImpact: number;
}

export interface OutcomeAnalysisLike {
  rules: RulePerformanceLike[];
  summary: {
    totalOutcomes: number;
    rulesAnalyzed: number;
    overallSuccessRate: number;
    overallAverageImpact: number;
  };
}

export interface FeedbackSummaryLike {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  netScore: number;
}

export interface LearningSource {
  analyzeOutcomes(storeId?: string): Promise<OutcomeAnalysisLike>;
  summarizeFeedback(storeId?: string): Promise<FeedbackSummaryLike>;
}

// ---------------------------------------------------------------------------
// Reporting and planning data
// ---------------------------------------------------------------------------

export interface ReportLike {
  id: string;
  name: string;
  kind: string;
  period: { startDate: string; endDate: string };
  generatedAt: string;
  sections: Array<{
    kind: string;
    title: string;
    metrics?: Array<{ label: string; value: string | number; delta?: number | null }>;
    rows?: Array<Array<string | number>>;
    points?: Array<{ date: string; value: number }>;
    body?: string[];
  }>;
  kpis: Array<{
    key: string;
    label: string;
    value: number | null;
    previousValue: number | null;
    changePercent: number | null;
    status: string;
  }>;
  alerts: AlertsSummary | null;
}

export interface ReportRequest {
  kind?: string;
  storeId?: string;
  days?: number;
  compare?: boolean;
}

export interface ReportSource {
  generateReport(request: ReportRequest): Promise<ReportLike>;
}

export interface PlanLike {
  id: string;
  status: string;
  risk: string;
  taskCount: number;
  totalImpact: number;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionSource {
  listPlans(storeId?: string): Promise<PlanLike[]>;
}

/** Everything a tool can reach. Every source is optional; tools degrade
 * gracefully (reporting unavailability) when a source is not wired. */
export interface CopilotSources {
  recommendations?: RecommendationsSource;
  observability?: ObservabilitySource;
  learning?: LearningSource;
  reports?: ReportSource;
  decision?: DecisionSource;
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

export interface ObservabilityServiceLike {
  getOverview(storeId?: string): Promise<ObservabilityOverviewLike>;
  getExecutionMetrics(storeId?: string): Promise<ExecutionSummary>;
  getAlerts(storeId?: string, limit?: number): Promise<Array<AlertSummaryItem>>;
  getHistory(options?: { limit?: number }): Promise<{
    snapshots: Array<{
      overallScore: number;
      pagesCrawled?: number;
      totalIssues?: number;
      brokenLinks?: number;
      capturedAt: string;
    }>;
  }>;
}

/** Adapts the observability service into the copilot's observability source. */
export function fromObservability(service: ObservabilityServiceLike): ObservabilitySource {
  return {
    async overview(storeId) {
      return service.getOverview(storeId);
    },
    async executionSummary(storeId) {
      return service.getExecutionMetrics(storeId);
    },
    async alerts(storeId, limit) {
      const items = await service.getAlerts(storeId, limit);
      let critical = 0;
      let warning = 0;
      let info = 0;
      for (const item of items) {
        if (item.severity === 'critical') critical += 1;
        else if (item.severity === 'warning') warning += 1;
        else info += 1;
      }
      return { total: items.length, critical, warning, info, items };
    },
    async crawlSummary(storeId) {
      const history = await service.getHistory({ limit: 100 });
      const ordered = [...history.snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
      const latest = ordered[ordered.length - 1];
      const previous = ordered[ordered.length - 2];
      return {
        storeId,
        latestScore: latest?.overallScore ?? null,
        previousScore: previous?.overallScore ?? null,
        delta:
          latest !== undefined && previous !== undefined
            ? round(latest.overallScore - previous.overallScore)
            : null,
        pagesCrawled: latest?.pagesCrawled ?? null,
        totalIssues: latest?.totalIssues ?? null,
        brokenLinks: latest?.brokenLinks ?? null,
        snapshots: ordered.length,
      };
    },
  };
}

export interface LearningEngineServiceLike {
  analyzeOutcomes(filter?: { storeId?: string }): Promise<OutcomeAnalysisLike>;
  summarizeFeedback(filter?: { storeId?: string }): Promise<FeedbackSummaryLike>;
}

/** Adapts the learning-engine service into the copilot's learning source. */
export function fromLearningEngine(service: LearningEngineServiceLike): LearningSource {
  return {
    analyzeOutcomes: (storeId) => service.analyzeOutcomes(storeId === undefined ? undefined : { storeId }),
    summarizeFeedback: (storeId) => service.summarizeFeedback(storeId === undefined ? undefined : { storeId }),
  };
}

const REPORT_KINDS = {
  'executive-dashboard': 'executive-dashboard',
  seo: 'seo',
  kpi: 'kpi',
  trends: 'trends',
  alerts: 'alerts',
} as const;

export interface ReportEngineLike {
  generate(request: {
    kind?: string;
    storeId?: string;
    periodOptions?: { days?: number };
    compare?: boolean;
  }): Promise<ReportLike>;
}

/** Adapts a report engine into the copilot's report source. */
export function fromReportEngine(engine: ReportEngineLike): ReportSource {
  return {
    async generateReport(request) {
      const kind =
        request.kind !== undefined &&
        Object.prototype.hasOwnProperty.call(REPORT_KINDS, request.kind)
          ? (request.kind as keyof typeof REPORT_KINDS)
          : 'executive-dashboard';
      return engine.generate({
        kind: REPORT_KINDS[kind],
        storeId: request.storeId,
        periodOptions: request.days === undefined ? undefined : { days: request.days },
        compare: request.compare,
      });
    },
  };
}

export interface DecisionEngineLike {
  listPlans(storeId?: string): Promise<PlanLike[]>;
}

/** Adapts a decision engine into the copilot's decision source. */
export function fromDecisionEngine(engine: DecisionEngineLike): DecisionSource {
  return {
    listPlans: (storeId) => engine.listPlans(storeId),
  };
}

// ---------------------------------------------------------------------------
// Aggregators (pure, deterministic)
// ---------------------------------------------------------------------------

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Fetches and trims recommendations through the optional source. */
export async function gatherRecommendations(
  sources: CopilotSources,
  filter: RecommendationFilter = {},
): Promise<CopilotRecommendation[]> {
  if (sources.recommendations === undefined) {
    throw new Error('Recommendations source is not available.');
  }
  const items = await sources.recommendations.listRecommendations(filter);
  const limit = filter.limit === undefined ? items.length : Math.max(filter.limit, 0);
  return items.slice(0, limit);
}

export interface MetricsOverview {
  overview: ObservabilityOverviewLike | null;
  execution: ExecutionSummary | null;
  crawl: CrawlSummary | null;
  alerts: AlertsSummary | null;
  kpis: ReportLike['kpis'] | null;
}

/** Builds a combined health overview from whatever sources are wired. */
export async function buildMetricsOverview(sources: CopilotSources, storeId?: string): Promise<MetricsOverview> {
  const observability = sources.observability;
  const reports = sources.reports;
  const [overview, execution, crawl, alerts, kpis] = await Promise.all([
    observability === undefined ? Promise.resolve(null) : observability.overview(storeId),
    observability === undefined ? Promise.resolve(null) : observability.executionSummary(storeId),
    observability === undefined ? Promise.resolve(null) : observability.crawlSummary(storeId),
    observability === undefined ? Promise.resolve(null) : observability.alerts(storeId, 20),
    reports === undefined
      ? Promise.resolve(null)
      : reports.generateReport({ kind: 'kpi', storeId, days: 30, compare: true }).then((report) => report.kpis),
  ]);
  return { overview, execution, crawl, alerts, kpis };
}

/** Derives the risk posture of a recommendation from its scoring fields. */
export function riskOf(recommendation: CopilotRecommendation): 'LOW' | 'MEDIUM' | 'HIGH' {
  const highPriority = recommendation.priority === 'high' || recommendation.priority === 'critical';
  const high = highPriority && recommendation.effort === 'high';
  const medium = highPriority || recommendation.effort === 'high';
  if (high) return 'HIGH';
  if (medium) return 'MEDIUM';
  return 'LOW';
}

/** High-risk or high-effort changes need human approval before execution. */
export function approvalRequired(recommendation: CopilotRecommendation): boolean {
  if (riskOf(recommendation) === 'HIGH') return true;
  return recommendation.impact === 'high' && recommendation.effort !== 'low';
}

/** A change is safe to auto-apply when its risk is not HIGH. */
export function isSafeAction(recommendation: CopilotRecommendation): boolean {
  return riskOf(recommendation) !== 'HIGH';
}

export interface OptimizationPlanItem {
  recommendation: CopilotRecommendation;
  rank: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  approvalRequired: boolean;
  safe: boolean;
}

export interface OptimizationPlan {
  storeId?: string;
  createdAt: string;
  summary: {
    count: number;
    totalImpact: number;
    criticalCount: number;
    highCount: number;
    safeCount: number;
    approvalRequiredCount: number;
  };
  items: OptimizationPlanItem[];
}

/** Builds a ranked optimization plan from a recommendation set. */
export function buildOptimizationPlan(
  recommendations: readonly CopilotRecommendation[],
  options: { storeId?: string; createdAt?: string } = {},
): OptimizationPlan {
  const ranked = [...recommendations].sort((a, b) => b.score - a.score);
  const items: OptimizationPlanItem[] = ranked.map((recommendation, index) => ({
    recommendation,
    rank: index + 1,
    risk: riskOf(recommendation),
    approvalRequired: approvalRequired(recommendation),
    safe: isSafeAction(recommendation),
  }));
  const critical = items.filter((item) => item.recommendation.priority === 'critical').length;
  const high = items.filter((item) => item.recommendation.priority === 'high').length;
  const safeCount = items.filter((item) => item.safe).length;
  const approvalRequiredCount = items.filter((item) => item.approvalRequired).length;
  const totalImpact = round(items.reduce((sum, item) => sum + item.recommendation.score, 0));
  return {
    storeId: options.storeId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    summary: {
      count: items.length,
      totalImpact,
      criticalCount: critical,
      highCount: high,
      safeCount,
      approvalRequiredCount,
    },
    items,
  };
}

export interface SafeActionSuggestion {
  recommendation: CopilotRecommendation;
  suggestedAction: string;
  approvalRequired: boolean;
  reason: string;
}

/** Lists actions a merchant could take now, flagged by approval needs. */
export function suggestSafeActions(
  recommendations: readonly CopilotRecommendation[],
  options: { limit?: number } = {},
): SafeActionSuggestion[] {
  const eligible = [...recommendations]
    .filter((recommendation) => !approvalRequired(recommendation))
    .sort((a, b) => b.score - a.score);
  const limit = options.limit === undefined ? eligible.length : Math.max(options.limit, 0);
  return eligible.slice(0, limit).map((recommendation) => ({
    recommendation,
    suggestedAction: recommendation.recommendedAction,
    approvalRequired: false,
    reason:
      recommendation.effort === 'low'
        ? 'Low-effort change with direct impact.'
        : 'Low-to-medium risk change within safe thresholds.',
  }));
}
