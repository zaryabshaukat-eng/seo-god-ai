import { createHash } from 'node:crypto';
import type { EngineConfig, ResolvedConfig } from './config.js';
import { resolveConfig } from './config.js';
import { analyzeIssues } from './analyzers/issue.js';
import { analyzePerformance } from './analyzers/performance.js';
import { analyzeStructuredData } from './analyzers/structured-data.js';
import { constraintsFor } from './rules.js';
import { compareRecommendations, computeScore, priorityFromScore } from './scoring.js';
import type {
  AiActionContext,
  EngineInput,
  EngineReport,
  EngineSummary,
  PriorityLevel,
  Recommendation,
  RecommendationCandidate,
  RecommendationCategory,
} from './types.js';

export const ENGINE_VERSION = '1.0.0';

/**
 * Deterministic SEO intelligence engine. Transforms crawler output into
 * explainable, evidence-backed, prioritized recommendations using pure rules
 * — never an LLM. Same input always produces the same report, so the engine
 * is the single source of truth AI agents can act on.
 */
export class SeoEngine {
  private readonly config: ResolvedConfig;

  constructor(config: EngineConfig = {}) {
    this.config = resolveConfig(config);
  }

  analyze(input: EngineInput): EngineReport {
    const candidates = [
      ...analyzeIssues(input, this.config),
      ...analyzePerformance(input, this.config),
      ...analyzeStructuredData(input, this.config),
    ];
    const merged = mergeByRule(candidates);
    const recommendations = merged
      .map((candidate) => this.toRecommendation(candidate, input))
      .sort(compareRecommendations);
    const capped = applyCategoryCap(recommendations, this.config.maxRecommendationsPerCategory);

    return {
      crawlJobId: input.crawlJobId,
      storeId: input.storeId,
      engineVersion: ENGINE_VERSION,
      generatedAt: this.config.clock(),
      statistics: input.statistics,
      recommendations: capped,
      summary: summarize(capped),
    };
  }

  private toRecommendation(candidate: RecommendationCandidate, input: EngineInput): Recommendation {
    const score = computeScore(candidate.impact, candidate.confidence, candidate.effort, this.config.scoring);
    const priority = priorityFromScore(score);
    return {
      id: recommendationId(candidate.rule, candidate.affectedUrls),
      rule: candidate.rule,
      category: candidate.category,
      priority,
      score,
      impact: candidate.impact,
      effort: candidate.effort,
      confidence: candidate.confidence,
      title: candidate.title,
      description: candidate.description,
      rationale: candidate.rationale,
      recommendedAction: candidate.recommendedAction,
      evidence: candidate.evidence,
      affectedUrls: candidate.affectedUrls,
      pageCount: candidate.pageCount,
      occurrenceCount: candidate.occurrenceCount,
      crawlJobId: input.crawlJobId,
      storeId: input.storeId,
      aiContext: buildAiContext(candidate, priority, score),
    };
  }
}

/** Deterministic id: SHA-256 of rule + sorted affected URLs. */
export function recommendationId(rule: string, affectedUrls: string[]): string {
  const material = [rule, ...affectedUrls].join('\u0000');
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/**
 * Merges candidates sharing a rule (defensively; analyzers emit disjoint
 * rules). URLs and evidence are unioned, occurrence counts summed, impact
 * and confidence raised, and effort eased.
 */
export function mergeByRule(candidates: RecommendationCandidate[]): RecommendationCandidate[] {
  const groups = new Map<string, RecommendationCandidate[]>();
  for (const candidate of candidates) {
    const list = groups.get(candidate.rule) ?? [];
    list.push(candidate);
    groups.set(candidate.rule, list);
  }

  const merged: RecommendationCandidate[] = [];
  for (const [rule, list] of groups) {
    if (list.length === 1) {
      merged.push(list[0] as RecommendationCandidate);
      continue;
    }
    const affectedUrls = [...new Set(list.flatMap((c) => c.affectedUrls))].sort();
    merged.push({
      rule,
      category: list[0]!.category,
      impact: highestImpact(list.map((c) => c.impact)),
      effort: lowestEffort(list.map((c) => c.effort)),
      confidence: Math.max(...list.map((c) => c.confidence)),
      title: list[0]!.title,
      description: list[0]!.description,
      rationale: list[0]!.rationale,
      recommendedAction: list[0]!.recommendedAction,
      evidence: list.flatMap((c) => c.evidence),
      affectedUrls,
      pageCount: affectedUrls.length,
      occurrenceCount: list.reduce((total, c) => total + c.occurrenceCount, 0),
      moneyPageAffected: list.some((c) => c.moneyPageAffected),
    });
  }
  return merged;
}

function buildAiContext(
  candidate: RecommendationCandidate,
  priority: PriorityLevel,
  score: number,
): AiActionContext {
  return {
    rule: candidate.rule,
    category: candidate.category,
    priority,
    score,
    impact: candidate.impact,
    effort: candidate.effort,
    summary: candidate.title,
    recommendedAction: candidate.recommendedAction,
    affectedUrls: candidate.affectedUrls,
    evidenceValues: candidate.evidence.map((item) => ({
      url: item.url,
      field: item.field,
      value: item.value,
    })),
    constraints: constraintsFor(candidate.category),
  };
}

/** Keeps the top-N per category (by the deterministic order), then re-sorts. */
function applyCategoryCap(
  recommendations: Recommendation[],
  cap: number | null,
): Recommendation[] {
  if (cap === null) return recommendations;
  const byCategory = new Map<RecommendationCategory, Recommendation[]>();
  for (const recommendation of recommendations) {
    const list = byCategory.get(recommendation.category) ?? [];
    list.push(recommendation);
    byCategory.set(recommendation.category, list);
  }
  const kept: Recommendation[] = [];
  for (const list of byCategory.values()) {
    kept.push(...list.slice(0, cap));
  }
  return kept.sort(compareRecommendations);
}

function summarize(recommendations: Recommendation[]): EngineSummary {
  const byPriority: Record<PriorityLevel, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };
  const byCategory: Record<RecommendationCategory, number> = {
    content: 0,
    links: 0,
    performance: 0,
    'structured-data': 0,
    indexing: 0,
    internationalization: 0,
    technical: 0,
  };
  for (const recommendation of recommendations) {
    byPriority[recommendation.priority] += 1;
    byCategory[recommendation.category] += 1;
  }
  return { total: recommendations.length, byPriority, byCategory };
}

function highestImpact(impacts: RecommendationCandidate['impact'][]): RecommendationCandidate['impact'] {
  const order = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  return impacts.slice(1).reduce(
    (best, current) => (order[current] > order[best] ? current : best),
    impacts[0]!,
  );
}

function lowestEffort(efforts: RecommendationCandidate['effort'][]): RecommendationCandidate['effort'] {
  const order = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  return efforts.slice(1).reduce(
    (best, current) => (order[current] < order[best] ? current : best),
    efforts[0]!,
  );
}
