import type { CrawlStatistics, PageExtraction, PageType, SeoIssue } from '@seogod/crawler';

export type PriorityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type EffortLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type RecommendationCategory =
  | 'content'
  | 'links'
  | 'performance'
  | 'structured-data'
  | 'indexing'
  | 'internationalization'
  | 'technical';

/** One crawled page fed to the engine: its extraction plus detected issues. */
export interface EnginePageInput {
  url: string;
  type: PageType;
  depth: number;
  extraction: PageExtraction | null;
  issues: SeoIssue[];
}

/** The full crawler output a single `SeoEngine.analyze` run consumes. */
export interface EngineInput {
  crawlJobId: string;
  storeId: string;
  pages: EnginePageInput[];
  statistics: CrawlStatistics;
}

/** A single measured fact backing a recommendation. */
export interface EvidenceItem {
  /** Page the evidence was observed on. */
  url: string;
  /** Extraction field or issue rule the value came from. */
  field: string;
  /** Measured value. */
  value: string | number | boolean | null;
  /** Optional short quote or URL fragment. */
  snippet?: string;
}

/**
 * An un-scored recommendation produced by an analyzer. The engine scores,
 * prioritizes, and enriches these into a {@link Recommendation}.
 */
export interface RecommendationCandidate {
  rule: string;
  category: RecommendationCategory;
  impact: ImpactLevel;
  effort: EffortLevel;
  confidence: number;
  title: string;
  description: string;
  rationale: string;
  recommendedAction: string;
  evidence: EvidenceItem[];
  affectedUrls: string[];
  pageCount: number;
  occurrenceCount: number;
  /** True when any affected page is a money page (product/collection/home). */
  moneyPageAffected: boolean;
}

/** Normalized, machine-readable context an AI agent can act on directly. */
export interface AiActionContext {
  rule: string;
  category: RecommendationCategory;
  priority: PriorityLevel;
  /** Composite 0..100 score (impact, confidence, effort). */
  score: number;
  impact: ImpactLevel;
  effort: EffortLevel;
  summary: string;
  recommendedAction: string;
  affectedUrls: string[];
  evidenceValues: Array<{
    url: string;
    field: string;
    value: string | number | boolean | null;
  }>;
  constraints: string[];
}

/**
 * A prioritized, evidence-backed recommendation. This is the canonical
 * contract every consumer (agents, dashboard, reports) should rely on; it is
 * fully derived by deterministic rules and never by an LLM.
 */
export interface Recommendation {
  /** Deterministic: SHA-256 of rule + affected URLs. */
  id: string;
  /** Stable machine key, e.g. `missing-title`. */
  rule: string;
  category: RecommendationCategory;
  /** Derived from `score`. */
  priority: PriorityLevel;
  /** 0..100 composite score (impact, confidence, effort). */
  score: number;
  impact: ImpactLevel;
  effort: EffortLevel;
  /** 0..1 confidence in the evidence. */
  confidence: number;
  title: string;
  description: string;
  rationale: string;
  recommendedAction: string;
  evidence: EvidenceItem[];
  /** Deduplicated, sorted affected URLs. */
  affectedUrls: string[];
  /** Number of unique affected pages. */
  pageCount: number;
  /** Total occurrences of the underlying rule, including duplicates. */
  occurrenceCount: number;
  crawlJobId: string;
  storeId: string;
  aiContext: AiActionContext;
}

export interface EngineSummary {
  total: number;
  byPriority: Record<PriorityLevel, number>;
  byCategory: Record<RecommendationCategory, number>;
}

export interface EngineReport {
  crawlJobId: string;
  storeId: string;
  engineVersion: string;
  generatedAt: Date;
  statistics: CrawlStatistics;
  recommendations: Recommendation[];
  summary: EngineSummary;
}
