import type { EffortLevel, ImpactLevel, RecommendationCategory } from './types.js';

export interface RuleMeta {
  rule: string;
  category: RecommendationCategory;
  /** Business impact of fixing the rule. */
  impact: ImpactLevel;
  /** How much work fixing it typically takes. */
  effort: EffortLevel;
  /** Imperative human summary. */
  title: string;
  /** What to do to fix it. */
  recommendedAction: string;
  /** True when backed by a measured value, false when heuristic. */
  objective: boolean;
  /** True when the rule matters most on money pages (product/collection/home). */
  moneyPages: boolean;
}

const META: Record<string, RuleMeta> = {
  'missing-title': {
    rule: 'missing-title',
    category: 'content',
    impact: 'HIGH',
    effort: 'LOW',
    title: 'Add a unique page title',
    recommendedAction: 'Add a unique, descriptive <title> element to each affected page.',
    objective: false,
    moneyPages: true,
  },
  'title-too-long': {
    rule: 'title-too-long',
    category: 'content',
    impact: 'MEDIUM',
    effort: 'LOW',
    title: 'Shorten page titles',
    recommendedAction: 'Shorten each title to 60 characters or fewer.',
    objective: true,
    moneyPages: true,
  },
  'title-too-short': {
    rule: 'title-too-short',
    category: 'content',
    impact: 'LOW',
    effort: 'LOW',
    title: 'Expand thin page titles',
    recommendedAction: 'Expand each title to at least 30 characters.',
    objective: true,
    moneyPages: true,
  },
  'duplicate-title': {
    rule: 'duplicate-title',
    category: 'content',
    impact: 'HIGH',
    effort: 'MEDIUM',
    title: 'Make page titles unique',
    recommendedAction: 'Give each page a unique title that reflects its content.',
    objective: false,
    moneyPages: true,
  },
  'missing-meta-description': {
    rule: 'missing-meta-description',
    category: 'content',
    impact: 'MEDIUM',
    effort: 'LOW',
    title: 'Add a meta description',
    recommendedAction: 'Add a compelling meta description to each affected page.',
    objective: false,
    moneyPages: true,
  },
  'meta-description-too-long': {
    rule: 'meta-description-too-long',
    category: 'content',
    impact: 'MEDIUM',
    effort: 'LOW',
    title: 'Shorten meta descriptions',
    recommendedAction: 'Shorten each meta description to 160 characters or fewer.',
    objective: true,
    moneyPages: true,
  },
  'meta-description-too-short': {
    rule: 'meta-description-too-short',
    category: 'content',
    impact: 'LOW',
    effort: 'LOW',
    title: 'Expand thin meta descriptions',
    recommendedAction: 'Expand each meta description to at least 50 characters.',
    objective: true,
    moneyPages: true,
  },
  'duplicate-meta-description': {
    rule: 'duplicate-meta-description',
    category: 'content',
    impact: 'MEDIUM',
    effort: 'MEDIUM',
    title: 'Make meta descriptions unique',
    recommendedAction: 'Give each page a unique meta description.',
    objective: false,
    moneyPages: true,
  },
  'missing-h1': {
    rule: 'missing-h1',
    category: 'content',
    impact: 'MEDIUM',
    effort: 'LOW',
    title: 'Add an H1 heading',
    recommendedAction: 'Add exactly one H1 heading to each affected page.',
    objective: false,
    moneyPages: true,
  },
  'multiple-h1': {
    rule: 'multiple-h1',
    category: 'content',
    impact: 'LOW',
    effort: 'LOW',
    title: 'Use a single H1 heading',
    recommendedAction: 'Reduce each page to exactly one H1 heading.',
    objective: true,
    moneyPages: true,
  },
  'thin-content': {
    rule: 'thin-content',
    category: 'content',
    impact: 'MEDIUM',
    effort: 'HIGH',
    title: 'Expand thin content pages',
    recommendedAction: 'Add substantial, unique content to each affected page.',
    objective: true,
    moneyPages: true,
  },
  'missing-alt-text': {
    rule: 'missing-alt-text',
    category: 'content',
    impact: 'LOW',
    effort: 'MEDIUM',
    title: 'Add image alt text',
    recommendedAction: 'Add descriptive alt text to images missing it.',
    objective: false,
    moneyPages: false,
  },
  'missing-canonical': {
    rule: 'missing-canonical',
    category: 'indexing',
    impact: 'MEDIUM',
    effort: 'LOW',
    title: 'Add a canonical URL',
    recommendedAction: 'Add a self-referencing canonical URL to each affected page.',
    objective: false,
    moneyPages: false,
  },
  'conflicting-canonical': {
    rule: 'conflicting-canonical',
    category: 'indexing',
    impact: 'HIGH',
    effort: 'LOW',
    title: 'Fix conflicting canonical URLs',
    recommendedAction: 'Make each canonical URL point at the page itself.',
    objective: false,
    moneyPages: false,
  },
  'robots-blocked': {
    rule: 'robots-blocked',
    category: 'indexing',
    impact: 'HIGH',
    effort: 'MEDIUM',
    title: 'Unblock pages from crawling',
    recommendedAction: 'Allow the affected pages in robots.txt if they should be indexed.',
    objective: false,
    moneyPages: false,
  },
  'missing-lang': {
    rule: 'missing-lang',
    category: 'internationalization',
    impact: 'LOW',
    effort: 'LOW',
    title: 'Declare the page language',
    recommendedAction: 'Add a lang attribute to the <html> element of each affected page.',
    objective: false,
    moneyPages: false,
  },
  'redirect-chain': {
    rule: 'redirect-chain',
    category: 'links',
    impact: 'MEDIUM',
    effort: 'MEDIUM',
    title: 'Resolve redirect chains',
    recommendedAction: 'Replace multi-hop redirects with direct links to the final URL.',
    objective: true,
    moneyPages: false,
  },
  'broken-link': {
    rule: 'broken-link',
    category: 'links',
    impact: 'HIGH',
    effort: 'MEDIUM',
    title: 'Fix broken internal links',
    recommendedAction: 'Fix or remove each link that resolves to a 4xx/5xx status.',
    objective: true,
    moneyPages: false,
  },
  'slow-ttfb': {
    rule: 'slow-ttfb',
    category: 'performance',
    impact: 'MEDIUM',
    effort: 'HIGH',
    title: 'Improve server response time',
    recommendedAction: 'Investigate server-side latency (hosting, caching, app code) to cut time-to-first-byte.',
    objective: true,
    moneyPages: true,
  },
  'large-html': {
    rule: 'large-html',
    category: 'performance',
    impact: 'MEDIUM',
    effort: 'MEDIUM',
    title: 'Reduce HTML size',
    recommendedAction: 'Trim excessive markup and move heavy content into assets to reduce HTML payload.',
    objective: true,
    moneyPages: true,
  },
  'too-many-scripts': {
    rule: 'too-many-scripts',
    category: 'performance',
    impact: 'LOW',
    effort: 'MEDIUM',
    title: 'Reduce script count',
    recommendedAction: 'Consolidate or lazy-load scripts to reduce the number loaded per page.',
    objective: true,
    moneyPages: true,
  },
  'missing-structured-data': {
    rule: 'missing-structured-data',
    category: 'structured-data',
    impact: 'MEDIUM',
    effort: 'MEDIUM',
    title: 'Add structured data',
    recommendedAction: 'Add schema.org structured data (JSON-LD) to the affected pages.',
    objective: true,
    moneyPages: true,
  },
  'invalid-structured-data': {
    rule: 'invalid-structured-data',
    category: 'structured-data',
    impact: 'MEDIUM',
    effort: 'MEDIUM',
    title: 'Fix invalid structured data',
    recommendedAction: 'Repair structured-data blocks that fail validation.',
    objective: true,
    moneyPages: true,
  },
};

/** Fallback for rules not yet in the registry: deterministic but generic. */
export const FALLBACK_RULE_META: RuleMeta = {
  rule: '',
  category: 'technical',
  impact: 'MEDIUM',
  effort: 'MEDIUM',
  title: 'Fix detected issue',
  recommendedAction: 'Review and resolve the detected issue on the affected pages.',
  objective: false,
  moneyPages: false,
};

const CONSTRAINT_BY_CATEGORY: Record<RecommendationCategory, string> = {
  content: 'Do not duplicate content across pages; keep each page unique.',
  links: 'Confirm any replacement URL resolves with HTTP 200 before shipping.',
  performance: 'Verify the change improves the measured metric before shipping.',
  'structured-data': 'Use schema.org types and validate with the Rich Results Test.',
  indexing: 'Ensure changes respect robots.txt and canonical rules.',
  internationalization: 'Keep language codes in BCP 47 format.',
  technical: 'Verify changes against a staging environment first.',
};

/** Constraints agents must respect when acting on a category. */
export function constraintsFor(category: RecommendationCategory): string[] {
  return [
    'Only act on the pages listed in affectedUrls.',
    CONSTRAINT_BY_CATEGORY[category],
  ];
}

/** Returns registry metadata for a rule, falling back deterministically. */
export function metaForRule(rule: string): RuleMeta {
  const meta = META[rule];
  if (meta === undefined) {
    return { ...FALLBACK_RULE_META, rule };
  }
  return meta;
}

/** All rules the engine understands, keyed by rule id. */
export function ruleRegistry(): ReadonlyArray<RuleMeta> {
  return Object.values(META);
}
