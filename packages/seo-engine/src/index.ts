export { ENGINE_VERSION, SeoEngine, mergeByRule, recommendationId } from './engine.js';

export {
  DEFAULT_SCORING,
  DEFAULT_THRESHOLDS,
  defaultEnabledRules,
  resolveConfig,
} from './config.js';
export type {
  EngineConfig,
  ResolvedConfig,
  ResolvedRuleConfig,
  RuleOverride,
  RuleThresholds,
  ScoringConfig,
} from './config.js';

export {
  FALLBACK_RULE_META,
  constraintsFor,
  metaForRule,
  ruleRegistry,
} from './rules.js';
export type { RuleMeta } from './rules.js';

export {
  EFFORT_ORDER,
  EFFORT_SCORE,
  IMPACT_ORDER,
  IMPACT_SCORE,
  PRIORITY_ORDER,
  bumpImpact,
  clamp,
  compareRecommendations,
  computeConfidence,
  computeScore,
  priorityFromScore,
} from './scoring.js';

export { analyzeIssues } from './analyzers/issue.js';
export { analyzePerformance } from './analyzers/performance.js';
export { analyzeStructuredData } from './analyzers/structured-data.js';

export { evidenceFromIssue, evidenceItem, pickEvidenceValue } from './evidence.js';

export type {
  AiActionContext,
  EffortLevel,
  EngineInput,
  EnginePageInput,
  EngineReport,
  EngineSummary,
  EvidenceItem,
  ImpactLevel,
  PriorityLevel,
  Recommendation,
  RecommendationCandidate,
  RecommendationCategory,
} from './types.js';
