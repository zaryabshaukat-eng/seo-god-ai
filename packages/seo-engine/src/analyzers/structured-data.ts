import type { ResolvedConfig } from '../config.js';
import { evidenceItem } from '../evidence.js';
import { computeConfidence } from '../scoring.js';
import { metaForRule } from '../rules.js';
import type { EngineInput, EnginePageInput, RecommendationCandidate } from '../types.js';

const HIGH_VALUE_TYPES = new Set(['product', 'collection', 'article', 'homepage']);

/**
 * Derives structured-data recommendations from crawler extractions:
 * missing schema on high-value pages and blocks that fail validation.
 */
export function analyzeStructuredData(input: EngineInput, config: ResolvedConfig): RecommendationCandidate[] {
  const missing: Array<{ page: EnginePageInput; value: number }> = [];
  const invalid: Array<{ page: EnginePageInput; value: number }> = [];

  for (const page of input.pages) {
    if (page.extraction === null) continue;
    if (HIGH_VALUE_TYPES.has(page.type) && page.extraction.structuredData.length === 0) {
      missing.push({ page, value: 0 });
    }
    const invalidBlocks = page.extraction.structuredData.filter((block) => block.valid === false);
    if (invalidBlocks.length > 0) {
      invalid.push({ page, value: invalidBlocks.length });
    }
  }

  const candidates: RecommendationCandidate[] = [];
  if (missing.length >= config.thresholds.missingStructuredDataMinPages) {
    candidates.push(buildCandidate('missing-structured-data', missing));
  }
  if (invalid.length > 0) {
    candidates.push(buildCandidate('invalid-structured-data', invalid));
  }
  return candidates;
}

function buildCandidate(
  rule: 'missing-structured-data' | 'invalid-structured-data',
  occurrences: Array<{ page: EnginePageInput; value: number }>,
): RecommendationCandidate {
  const meta = metaForRule(rule);
  const affectedUrls = [...new Set(occurrences.map((o) => o.page.url))].sort();
  const evidence = occurrences.map((o) => evidenceItem(o.page.url, 'structuredData', o.value));
  const confidence = computeConfidence(true, affectedUrls.length, true);
  const pageCount = affectedUrls.length;
  const title = pageCount > 1 ? `${meta.title} (${pageCount} pages)` : meta.title;
  const rationale =
    `Rule "${rule}" fired ${occurrences.length} time(s) across ${pageCount} page(s); ` +
    `affected page types: ${[...new Set(occurrences.map((o) => o.page.type))].join(', ')}; ` +
    `impact ${meta.impact}, effort ${meta.effort}, confidence ${confidence.toFixed(2)}.`;

  return {
    rule,
    category: meta.category,
    impact: meta.impact,
    effort: meta.effort,
    confidence,
    title,
    description: `${meta.title}. Affected pages: ${pageCount}.`,
    rationale,
    recommendedAction: meta.recommendedAction,
    evidence,
    affectedUrls,
    pageCount,
    occurrenceCount: occurrences.length,
    moneyPageAffected: false,
  };
}
