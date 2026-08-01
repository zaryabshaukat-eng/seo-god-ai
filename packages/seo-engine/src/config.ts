import type { EffortLevel, ImpactLevel } from './types.js';

export interface RuleThresholds {
  /** Time-to-first-byte (ms) above which a page is slow. */
  slowTtfbMs: number;
  /** HTML bytes above which a page is oversized. */
  largeHtmlBytes: number;
  /** Script count above which a page is script-heavy. */
  maxScripts: number;
  /** Minimum words before content is not considered thin. */
  thinContentWords: number;
  /** Minimum product/collection pages before recommending structured data. */
  missingStructuredDataMinPages: number;
  /** Minimum duplicate occurrences before flagging duplicate content. */
  minDuplicatePages: number;
}

export interface RuleOverride {
  enabled?: boolean;
  impact?: ImpactLevel;
  effort?: EffortLevel;
}

export interface ScoringConfig {
  /** Weight of impact in the composite score. */
  impactWeight: number;
  /** Weight of confidence in the composite score. */
  confidenceWeight: number;
  /** Weight of effort (lower effort → higher score). */
  effortWeight: number;
}

export interface EngineConfig {
  /** Per-rule overrides keyed by rule id. */
  rules?: Record<string, RuleOverride>;
  thresholds?: Partial<RuleThresholds>;
  scoring?: Partial<ScoringConfig>;
  /** Cap recommendations emitted per category; null means unlimited. */
  maxRecommendationsPerCategory?: number;
  /** Clock for report timestamps (deterministic tests). */
  clock?: () => Date;
}

export interface ResolvedRuleConfig {
  enabled: boolean;
  impact?: ImpactLevel;
  effort?: EffortLevel;
}

export interface ResolvedConfig {
  rules: ReadonlyMap<string, ResolvedRuleConfig>;
  thresholds: RuleThresholds;
  scoring: ScoringConfig;
  maxRecommendationsPerCategory: number | null;
  clock: () => Date;
}

export const DEFAULT_THRESHOLDS: RuleThresholds = {
  slowTtfbMs: 1500,
  largeHtmlBytes: 512_000,
  maxScripts: 30,
  thinContentWords: 50,
  missingStructuredDataMinPages: 3,
  minDuplicatePages: 2,
};

export const DEFAULT_SCORING: ScoringConfig = {
  impactWeight: 0.5,
  confidenceWeight: 0.3,
  effortWeight: 0.2,
};

/** Resolves partial user config against the engine defaults. */
export function resolveConfig(config: EngineConfig = {}): ResolvedConfig {
  const rules = new Map<string, ResolvedRuleConfig>();
  for (const [rule, override] of Object.entries(config.rules ?? {})) {
    rules.set(rule, {
      enabled: override.enabled ?? true,
      impact: override.impact,
      effort: override.effort,
    });
  }
  return {
    rules,
    thresholds: { ...DEFAULT_THRESHOLDS, ...config.thresholds },
    scoring: {
      impactWeight: DEFAULT_SCORING.impactWeight,
      confidenceWeight: DEFAULT_SCORING.confidenceWeight,
      effortWeight: DEFAULT_SCORING.effortWeight,
      ...config.scoring,
    },
    maxRecommendationsPerCategory: config.maxRecommendationsPerCategory ?? null,
    clock: config.clock ?? (() => new Date()),
  };
}

/** The rule set that ships by default: every known rule enabled. */
export function defaultEnabledRules(): string[] {
  return [
    'missing-title',
    'title-too-long',
    'title-too-short',
    'duplicate-title',
    'missing-meta-description',
    'meta-description-too-long',
    'meta-description-too-short',
    'duplicate-meta-description',
    'missing-h1',
    'multiple-h1',
    'thin-content',
    'missing-alt-text',
    'missing-canonical',
    'conflicting-canonical',
    'robots-blocked',
    'missing-lang',
    'redirect-chain',
    'broken-link',
    'slow-ttfb',
    'large-html',
    'too-many-scripts',
    'missing-structured-data',
    'invalid-structured-data',
  ];
}
