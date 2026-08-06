import { createApiFunctions } from './api-helpers.js';
import { badgeEl, cardEl, tableEl } from '../ui/primitives.js';
import { gridEl, pageHeaderEl, stackEl } from '../ui/layout.js';
import { className, h } from '../vdom.js';
import type { ApiClient } from '../api/client.js';
import type { BadgeTone, ScoreBreakdown, SeoRecommendation, Severity, VNode } from '../types.js';

export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** Numeric rank of a severity (higher = more severe). */
export function severityRank(severity: Severity): number {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

export interface RecommendationFilters {
  severity?: Severity;
  status?: SeoRecommendation['status'];
  rule?: string;
}

/** Filters recommendations by severity, status and rule. */
export function filterRecommendations(items: readonly SeoRecommendation[], filters: RecommendationFilters): SeoRecommendation[] {
  return items.filter((item) => {
    if (filters.severity && item.severity !== filters.severity) {
      return false;
    }
    if (filters.status && item.status !== filters.status) {
      return false;
    }
    if (filters.rule && !item.rule.toLowerCase().includes(filters.rule.toLowerCase())) {
      return false;
    }
    return true;
  });
}

export type SortKey = 'score' | 'severity' | 'created';

/** Sorts recommendations by a key (score ascending by default). */
export function sortRecommendations(items: readonly SeoRecommendation[], by: SortKey = 'score'): SeoRecommendation[] {
  const sorted = [...items];
  switch (by) {
    case 'severity':
      sorted.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
      break;
    case 'created':
      sorted.sort((a, b) => a.createdAt - b.createdAt);
      break;
    case 'score':
    default:
      sorted.sort((a, b) => a.score - b.score);
      break;
  }
  return sorted;
}

/** Human label for a 0-100 score. */
export function scoreLabel(score: number): string {
  if (score >= 80) {
    return 'Good';
  }
  if (score >= 50) {
    return 'Needs work';
  }
  return 'Poor';
}

/** Badge tone for a severity. */
export function recommendationTone(severity: Severity): BadgeTone {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    case 'low':
      return 'info';
    default:
      return 'neutral';
  }
}

export interface RecommendationExplanation {
  title: string;
  summary: string;
  suggestedAction: string;
  impact: string;
}

/** Explains a recommendation in human terms. */
export function explainRecommendation(item: SeoRecommendation): RecommendationExplanation {
  return {
    title: item.title,
    summary: item.description,
    suggestedAction: `Plan an execution to fix "${item.rule}" on ${item.url}.`,
    impact: `This affects ${item.impact} and is scored ${scoreLabel(item.score)} (${item.score}/100).`,
  };
}

/** Builds the SEO score breakdown KPIs. */
export function breakdownCards(breakdown: ScoreBreakdown): Array<{ id: string; label: string; value: string; tone: BadgeTone }> {
  const tone = (value: number): BadgeTone => (value >= 70 ? 'success' : value >= 50 ? 'warning' : 'danger');
  return [
    { id: 'crawl', label: 'Crawl', value: String(breakdown.crawl), tone: tone(breakdown.crawl) },
    { id: 'content', label: 'Content', value: String(breakdown.content), tone: tone(breakdown.content) },
    { id: 'performance', label: 'Performance', value: String(breakdown.performance), tone: tone(breakdown.performance) },
    { id: 'links', label: 'Links', value: String(breakdown.links), tone: tone(breakdown.links) },
    { id: 'technical', label: 'Technical', value: String(breakdown.technical), tone: tone(breakdown.technical) },
  ];
}

/** Renders the SEO analysis page. */
export function renderSeoPage(model: {
  recommendations: SeoRecommendation[];
  breakdown: ScoreBreakdown;
  filters: RecommendationFilters;
  canWrite: boolean;
}): VNode {
  const filtered = filterRecommendations(model.recommendations, model.filters);
  const sorted = sortRecommendations(filtered, 'severity');

  const rows = sorted.map((item) => ({
    title: h('span', { class: 'seo-row' }, h('strong', {}, item.title), h('span', { class: 'muted' }, item.url)),
    rule: item.rule,
    severity: badgeEl({ label: item.severity, tone: recommendationTone(item.severity) }),
    score: String(item.score),
    status: item.status,
    actions: model.canWrite
      ? h(
          'div',
          { class: 'row-actions' },
          h('a', { class: className('btn', 'btn--secondary'), href: '#', 'data-action': `seo:plan:${item.id}` }, 'Plan'),
          h('a', { class: className('btn', 'btn--ghost'), href: '#', 'data-action': `seo:resolve:${item.id}` }, 'Resolve'),
        )
      : '—',
  }));

  const table = tableEl({
    id: 'seo-table',
    caption: 'SEO recommendations',
    columns: [
      { key: 'title', label: 'Recommendation' },
      { key: 'rule', label: 'Rule' },
      { key: 'severity', label: 'Severity' },
      { key: 'score', label: 'Score', align: 'right' },
      { key: 'status', label: 'Status' },
      { key: 'actions', label: 'Actions' },
    ],
    rows,
    emptyText: 'No recommendations match the current filters.',
  });

  const breakdown = cardEl({
    title: 'Score breakdown',
    children: [stackEl(breakdownCards(model.breakdown).map((card) => h('div', {}, `${card.label}: ${card.value}`)), 'sm')],
  });

  return h(
    'main',
    { id: 'main', class: 'page' },
    pageHeaderEl({ title: 'SEO analysis', subtitle: 'AI recommendations prioritized by impact' }),
    gridEl([breakdown]),
    cardEl({ title: 'Recommendations', children: [table] }),
  );
}

/** REST wrappers for SEO endpoints. */
export function createSeoApi(api: ApiClient) {
  const call = createApiFunctions(api);
  return {
    list() {
      return call.get<SeoRecommendation[]>('seoRecommendations');
    },
    breakdown() {
      return call.get<ScoreBreakdown>('seoBreakdown');
    },
    update(id: string, patch: Partial<Pick<SeoRecommendation, 'status'>>) {
      return call.patch<SeoRecommendation>('seoRecommendationUpdate', patch, { id });
    },
  };
}
