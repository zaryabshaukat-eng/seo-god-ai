import type { SeoIssue } from '@seogod/crawler';
import type { ResolvedConfig, ResolvedRuleConfig } from '../config.js';
import { evidenceFromIssue } from '../evidence.js';
import { bumpImpact, computeConfidence } from '../scoring.js';
import { metaForRule } from '../rules.js';
import type {
  EngineInput,
  EnginePageInput,
  ImpactLevel,
  RecommendationCandidate,
} from '../types.js';

const SEVERITY_IMPACT: Record<SeoIssue['severity'], ImpactLevel> = {
  CRITICAL: 'HIGH',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
};

const MONEY_PAGE_TYPES = new Set(['product', 'collection', 'homepage']);

interface Occurrence {
  page: EnginePageInput;
  issue: SeoIssue;
}

/**
 * Turns the crawler's detected issues into recommendation candidates, grouped
 * by rule across pages. Impact reflects observed severity plus the money-page
 * boost; confidence reflects how objective and complete the evidence is.
 */
export function analyzeIssues(input: EngineInput, config: ResolvedConfig): RecommendationCandidate[] {
  const groups = new Map<string, Occurrence[]>();
  for (const page of input.pages) {
    for (const issue of page.issues) {
      const override = config.rules.get(issue.rule);
      if (override?.enabled === false) continue;
      const occurrences = groups.get(issue.rule) ?? [];
      occurrences.push({ page, issue });
      groups.set(issue.rule, occurrences);
    }
  }

  const candidates: RecommendationCandidate[] = [];
  for (const [rule, occurrences] of groups) {
    const meta = metaForRule(rule);
    const override = config.rules.get(rule);
    const candidate = buildCandidate(rule, occurrences, meta, override);
    if (candidate !== null) candidates.push(candidate);
  }
  return candidates;
}

function buildCandidate(
  rule: string,
  occurrences: Occurrence[],
  meta: ReturnType<typeof metaForRule>,
  override: ResolvedRuleConfig | undefined,
): RecommendationCandidate | null {
  const affectedUrls = [...new Set(occurrences.map((o) => o.page.url))].sort();
  const moneyPageAffected = occurrences.some((o) => MONEY_PAGE_TYPES.has(o.page.type));

  let impact = maxSeverityImpact(occurrences);
  impact = maxImpact(impact, override?.impact ?? meta.impact);
  if (meta.moneyPages && moneyPageAffected) impact = bumpImpact(impact);

  const effort = override?.effort ?? meta.effort;
  const evidence = occurrences.map((o) => evidenceFromIssue(o.page.url, o.issue));
  const hasValues = evidence.every((item) => item.value !== null);
  const confidence = computeConfidence(meta.objective, affectedUrls.length, hasValues);

  const pageCount = affectedUrls.length;
  const title = pageCount > 1 ? `${meta.title} (${pageCount} pages)` : meta.title;
  const worstSeverity = maxSeverityLabel(occurrences);
  const rationale =
    `Rule "${rule}" fired ${occurrences.length} time(s) across ${pageCount} page(s); ` +
    `observed severity ${worstSeverity}; ` +
    `impact ${impact}, effort ${effort}, confidence ${confidence.toFixed(2)}.`;

  return {
    rule,
    category: meta.category,
    impact,
    effort,
    confidence,
    title,
    description: `${meta.title}. Affected pages: ${pageCount}.`,
    rationale,
    recommendedAction: meta.recommendedAction,
    evidence,
    affectedUrls,
    pageCount,
    occurrenceCount: occurrences.length,
    moneyPageAffected,
  };
}

function maxSeverityImpact(occurrences: Occurrence[]): ImpactLevel {
  let impact: ImpactLevel = 'LOW';
  for (const occurrence of occurrences) {
    impact = maxImpact(impact, SEVERITY_IMPACT[occurrence.issue.severity]);
  }
  return impact;
}

function maxSeverityLabel(occurrences: Occurrence[]): SeoIssue['severity'] {
  let severity: SeoIssue['severity'] = 'LOW';
  for (const occurrence of occurrences) {
    const order = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;
    if (order[occurrence.issue.severity] > order[severity]) {
      severity = occurrence.issue.severity;
    }
  }
  return severity;
}

function maxImpact(a: ImpactLevel, b: ImpactLevel): ImpactLevel {
  const order = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  return order[a] >= order[b] ? a : b;
}
