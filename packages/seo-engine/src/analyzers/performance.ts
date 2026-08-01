import type { PagePerformance } from '@seogod/crawler';
import type { ResolvedConfig } from '../config.js';
import { evidenceItem } from '../evidence.js';
import { computeConfidence } from '../scoring.js';
import { metaForRule } from '../rules.js';
import type { EngineInput, EnginePageInput, RecommendationCandidate } from '../types.js';

type PerfSignal = 'slow-ttfb' | 'large-html' | 'too-many-scripts';

interface Signal {
  rule: PerfSignal;
  field: string;
  value: number;
}

/**
 * Derives performance recommendations from measured page-performance fields
 * the crawler reports (TTFB, HTML size, script count). Each signal is an
 * objective measurement, so confidence is high and thresholds are configurable.
 */
export function analyzePerformance(input: EngineInput, config: ResolvedConfig): RecommendationCandidate[] {
  const signals = new Map<PerfSignal, Array<{ page: EnginePageInput; value: number }>>();
  for (const page of input.pages) {
    if (page.extraction === null) continue;
    const { performance } = page.extraction;
    const pageSignals = detectSignals(performance, config);
    for (const signal of pageSignals) {
      const list = signals.get(signal.rule) ?? [];
      list.push({ page, value: signal.value });
      signals.set(signal.rule, list);
    }
  }

  const candidates: RecommendationCandidate[] = [];
  for (const [rule, occurrences] of signals) {
    candidates.push(buildCandidate(rule, occurrences));
  }
  return candidates;
}

function detectSignals(performance: PagePerformance, config: ResolvedConfig): Signal[] {
  const signals: Signal[] = [];
  if (performance.ttfbMs > config.thresholds.slowTtfbMs) {
    signals.push({ rule: 'slow-ttfb', field: 'ttfbMs', value: performance.ttfbMs });
  }
  if (performance.htmlSizeBytes > config.thresholds.largeHtmlBytes) {
    signals.push({ rule: 'large-html', field: 'htmlSizeBytes', value: performance.htmlSizeBytes });
  }
  if (performance.scriptCount > config.thresholds.maxScripts) {
    signals.push({ rule: 'too-many-scripts', field: 'scriptCount', value: performance.scriptCount });
  }
  return signals;
}

function buildCandidate(
  rule: PerfSignal,
  occurrences: Array<{ page: EnginePageInput; value: number }>,
): RecommendationCandidate {
  const meta = metaForRule(rule);
  const affectedUrls = [...new Set(occurrences.map((o) => o.page.url))].sort();
  const evidence = occurrences.map((o) => evidenceItem(o.page.url, fieldFor(rule), o.value));
  const confidence = computeConfidence(true, affectedUrls.length, true);
  const pageCount = affectedUrls.length;
  const title = pageCount > 1 ? `${meta.title} (${pageCount} pages)` : meta.title;
  const rationale =
    `Rule "${rule}" fired ${occurrences.length} time(s) across ${pageCount} page(s); ` +
    `values ${occurrences.map((o) => o.value).join(', ')}; ` +
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

function fieldFor(rule: PerfSignal): string {
  if (rule === 'slow-ttfb') return 'ttfbMs';
  if (rule === 'large-html') return 'htmlSizeBytes';
  return 'scriptCount';
}
