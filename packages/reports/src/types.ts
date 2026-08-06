/**
 * Reporting domain types. Every consumer interface is structural so the
 * package can accept data straight from `@seogod/observability`,
 * `@seogod/learning-engine`, `@seogod/decision-engine` and
 * `@seogod/google-integrations` without importing them at runtime (they are
 * development-only dependencies exercised by the adapter tests).
 */

import type { ReportPeriod } from './utils.js';

// ---------------------------------------------------------------------------
// Report model
// ---------------------------------------------------------------------------

export type ReportKind = 'executive-dashboard' | 'seo' | 'kpi' | 'trends' | 'alerts';

export type ReportFormat = 'json' | 'pdf' | 'csv';

export type ReportSectionKind =
  | 'summary'
  | 'seo'
  | 'kpis'
  | 'trends'
  | 'alerts'
  | 'opportunities'
  | 'execution'
  | 'learning';

export interface ReportSection {
  kind: ReportSectionKind;
  title: string;
  description?: string;
  /** Unit used when `points` are rendered (e.g. `%` or `/100`). */
  unit?: string;
  metrics?: Array<{ label: string; value: string | number; delta?: number | null }>;
  header?: string[];
  rows?: Array<Array<string | number>>;
  body?: string[];
  points?: TrendPoint[];
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface TrendSeries {
  key: string;
  label: string;
  unit?: string;
  period: ReportPeriod;
  points: TrendPoint[];
}

export type KpiStatus = 'improved' | 'declined' | 'neutral' | 'no-data';

export interface KpiSnapshot {
  key: string;
  label: string;
  unit?: string;
  value: number | null;
  previousValue: number | null;
  change: number | null;
  changePercent: number | null;
  higherIsBetter: boolean;
  status: KpiStatus;
}

export interface AlertSummaryItem {
  alertId: string;
  type: string;
  severity: string;
  message: string;
  triggeredAt: string;
  storeId?: string;
}

export interface AlertSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  byType: Record<string, number>;
  items: AlertSummaryItem[];
}

export interface SeoSummary {
  latestScore: number | null;
  previousScore: number | null;
  delta: number | null;
  totalIssues: number | null;
  pagesCrawled: number | null;
  brokenLinks: number | null;
  snapshots: number;
}

export interface ExecutionSummary {
  totalExecutions: number;
  completed: number;
  failed: number;
  cancelled: number;
  rolledBack: number;
  byStatus: Record<string, number>;
  successRate: number | null;
  averageDurationMs: number | null;
  p95DurationMs: number | null;
  changesApplied: number;
  changesReverted: number;
}

export interface RulePerformanceRow {
  rule: string;
  attempts: number;
  successes: number;
  failures: number;
  skipped: number;
  rolledBack: number;
  successRate: number | null;
  averageImpact: number | null;
}

export interface HistoricalOutcomeRow {
  rule: string;
  attempts: number;
  successes: number;
  averageImpact: number;
}

export interface FeedbackSummaryRow {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  netScore: number;
}

export interface LearningSummary {
  outcomes: number;
  rules: number;
  overallSuccessRate: number | null;
  overallAverageImpact: number | null;
  feedback: FeedbackSummaryRow;
  topRules: RulePerformanceRow[];
  historicalOutcomes: HistoricalOutcomeRow[];
}

export interface ReportRecommendation {
  id: string;
  rule: string;
  title: string;
  category: string;
  priority: string;
  score: number;
  impact: string;
  effort: string;
  confidence: number;
  affectedUrls: string[];
  pageCount: number;
}

export interface PlanSummaryRow {
  planId: string;
  status: string;
  risk: string;
  taskCount: number;
  totalImpact: number;
  createdAt: string;
  updatedAt: string;
}

export interface Report {
  id: string;
  templateId: string;
  name: string;
  kind: ReportKind;
  storeId?: string;
  period: ReportPeriod;
  previousPeriod?: ReportPeriod;
  generatedAt: string;
  sections: ReportSection[];
  kpis: KpiSnapshot[];
  trends: TrendSeries[];
  alerts: AlertSummary | null;
  /** Populated after `render()` runs: `{ json?, pdf?, csv? }` bytes/strings. */
  rendered?: Partial<Record<ReportFormat, unknown>>;
}

// ---------------------------------------------------------------------------
// KPI definitions
// ---------------------------------------------------------------------------

export type KpiSource = 'seo' | 'search' | 'traffic' | 'execution' | 'learning';

export interface KpiDefinition {
  key: string;
  label: string;
  unit?: string;
  source: KpiSource;
  higherIsBetter: boolean;
}

// ---------------------------------------------------------------------------
// Structural consumers (mirror upstream packages, never imported at runtime)
// ---------------------------------------------------------------------------

export type ExecutionStatusLike =
  | 'QUEUED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ROLLED_BACK';

export interface ExecutionRecordLike {
  executionId: string;
  storeId: string;
  status: ExecutionStatusLike;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  operation?: string;
  simulation?: boolean;
}

export interface SeoSnapshotLike {
  snapshotId: string;
  storeId: string;
  capturedAt: string;
  reference?: string;
  overallScore: number;
  scores?: Record<string, number>;
  totalIssues?: number;
  pagesCrawled?: number;
  brokenLinks?: number;
}

export interface AlertRecordLike {
  alertId: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  triggeredAt: string;
  storeId?: string;
  context: Record<string, unknown>;
}

export interface ChangeRecordLike {
  changeId: string;
  kind: 'apply' | 'revert';
  executionId: string;
  storeId: string;
  entityId: string;
  appliedAt: string;
  operation?: string;
  changedFields: string[];
}

/** `@seogod/observability` `LearningSignal` (execution-derived per-rule). */
export interface ObservabilitySignalLike {
  rule: string;
  actionType?: string;
  storeId?: string;
  attempts: number;
  successes: number;
  averageImpact: number;
  successRate: number;
  rollbackRate: number;
  averageDurationMs: number;
  lastExecutedAt?: string;
}

export interface ObservabilityFilterLike {
  storeId?: string;
  since?: string;
  limit?: number;
  status?: string;
}

/** Structural subset of `@seogod/observability` `ObservabilityStore`. */
export interface ObservabilityStoreLike {
  listExecutions(filter?: ObservabilityFilterLike): Promise<ExecutionRecordLike[]>;
  listSnapshots(filter?: ObservabilityFilterLike): Promise<SeoSnapshotLike[]>;
  listAlerts(filter?: ObservabilityFilterLike): Promise<AlertRecordLike[]>;
  listChanges(filter?: ObservabilityFilterLike): Promise<ChangeRecordLike[]>;
}

export interface RulePerformanceLike {
  rule: string;
  attempts: number;
  successes: number;
  failures: number;
  skipped: number;
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

export interface HistoricalOutcomeResultLike {
  rule: string;
  attempts: number;
  successes: number;
  averageImpact: number;
}

export interface FeedbackSummaryLike {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  netScore: number;
}

/** `@seogod/learning-engine` `LearnedSignal`. */
export interface LearnedSignalLike {
  id: string;
  storeId?: string;
  rule: string;
  kind: 'positive' | 'negative' | 'neutral';
  reward: number;
  confidence: number;
  source: string;
  timestamp: string;
}

export interface LearningFilterLike {
  storeId?: string;
  rule?: string;
  since?: string;
  limit?: number;
}

/** Structural subset of `@seogod/learning-engine` `LearningEngineService` reads. */
export interface LearningReaderLike {
  analyzeOutcomes(filter?: LearningFilterLike): Promise<OutcomeAnalysisLike>;
  getHistoricalOutcomes(
    filter?: LearningFilterLike,
    existing?: HistoricalOutcomeResultLike[],
  ): Promise<HistoricalOutcomeResultLike[]>;
  summarizeFeedback(filter?: LearningFilterLike): Promise<FeedbackSummaryLike>;
  getSignals(filter?: LearningFilterLike): Promise<LearnedSignalLike[]>;
}

/** `@seogod/seo-engine` `Recommendation` subset stored on decisions. */
export interface RecommendationLike {
  id: string;
  rule: string;
  category: string;
  priority: string;
  score: number;
  impact: string;
  effort: string;
  confidence: number;
  title: string;
  affectedUrls: string[];
  pageCount: number;
}

export interface DecisionLike {
  id: string;
  storeId: string;
  status: string;
  score: number;
  recommendations: RecommendationLike[];
  createdAt: Date;
}

export interface ExecutionPlanLike {
  id: string;
  storeId: string;
  decisionId: string;
  status: string;
  risk: string;
  totalImpact: number;
  tasks: Array<{ id: string; status: string; risk: string }>;
  createdAt: Date;
  updatedAt: Date;
}

/** Structural subset of `@seogod/decision-engine` reads. */
export interface DecisionReaderLike {
  listPlans(storeId: string): Promise<ExecutionPlanLike[]>;
  getDecision(id: string): Promise<DecisionLike | null>;
}

export interface SearchAnalyticsRowLike {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsResponseLike {
  rows: SearchAnalyticsRowLike[];
  totalClicks: number;
  totalImpressions: number;
  totalCtr: number;
  totalPosition: number;
}

export interface SearchAnalyticsQueryLike {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  searchType?: string;
  rowLimit?: number;
  startRow?: number;
}

export interface Ga4RowLike {
  dimensionValues: string[];
  metricValues: string[];
}

export interface Ga4RunReportResponseLike {
  dimensionHeaders: string[];
  metricHeaders: string[];
  rows: Ga4RowLike[];
  rowCount: number;
}

export interface Ga4QueryLike {
  dateRanges: Array<{ startDate: string; endDate: string }>;
  metrics: Array<{ name: string }>;
  dimensions?: Array<{ name: string }>;
  limit?: number;
  offset?: number;
}

/** Structural subset of `@seogod/google-integrations` `SearchConsoleClient`. */
export interface SearchConsoleClientLike {
  searchAnalytics(
    accessToken: string,
    siteUrl: string,
    query: SearchAnalyticsQueryLike,
  ): Promise<SearchAnalyticsResponseLike>;
}

/** Structural subset of `@seogod/google-integrations` `AnalyticsClient`. */
export interface AnalyticsClientLike {
  runReport(
    accessToken: string,
    propertyId: string,
    query: Ga4QueryLike,
  ): Promise<Ga4RunReportResponseLike>;
}

export interface TokenProviderLike {
  getAccessToken(): Promise<string>;
}

export interface GoogleSourceConfig {
  searchConsole?: SearchConsoleClientLike;
  analytics?: AnalyticsClientLike;
  tokenProvider?: TokenProviderLike;
  siteUrl?: string;
  propertyId?: string;
  searchType?: string;
}

// ---------------------------------------------------------------------------
// Aggregated data consumed by the engine
// ---------------------------------------------------------------------------

export interface SearchSeriesRow {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface TrafficSeriesRow {
  date: string;
  sessions: number;
  users: number;
  pageviews: number;
}

export interface ReportSourceData {
  period: ReportPeriod;
  executions: ExecutionRecordLike[];
  snapshots: SeoSnapshotLike[];
  alerts: AlertRecordLike[];
  changes: ChangeRecordLike[];
  analysis: OutcomeAnalysisLike | null;
  feedback: FeedbackSummaryLike | null;
  historicalOutcomes: HistoricalOutcomeResultLike[];
  recommendations: ReportRecommendation[];
  plans: PlanSummaryRow[];
  search: SearchSeriesRow[];
  traffic: TrafficSeriesRow[];
}

export interface ReportSources {
  observability?: ObservabilityStoreLike;
  learning?: LearningReaderLike;
  decision?: DecisionReaderLike;
  google?: GoogleSourceConfig;
}
