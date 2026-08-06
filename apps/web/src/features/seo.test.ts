import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import type { SeoRecommendation } from '../types.js';
import {
  breakdownCards,
  createSeoApi,
  explainRecommendation,
  filterRecommendations,
  recommendationTone,
  renderSeoPage,
  scoreLabel,
  severityRank,
  sortRecommendations,
} from './seo.js';

function rec(partial: Partial<SeoRecommendation>): SeoRecommendation {
  return {
    id: 'r1',
    storeId: 's1',
    title: 'Fix title tag',
    url: 'https://shop.example/p',
    rule: 'title-tag',
    description: 'The title tag is missing.',
    severity: 'high',
    status: 'open',
    score: 40,
    createdAt: 100,
    impact: 'traffic',
    ...partial,
  };
}

describe('severityRank', () => {
  it('orders critical above info', () => {
    expect(severityRank('critical')).toBe(0);
    expect(severityRank('info')).toBe(4);
    expect(severityRank('unknown' as never)).toBe(5);
  });
});

describe('filterRecommendations', () => {
  const items = [rec({ id: 'a', severity: 'high', status: 'open', rule: 'Title Tag' }), rec({ id: 'b', severity: 'low', status: 'resolved', rule: 'Meta' })];

  it('filters by severity, status and rule text', () => {
    expect(filterRecommendations(items, { severity: 'high' }).map((r) => r.id)).toEqual(['a']);
    expect(filterRecommendations(items, { status: 'resolved' }).map((r) => r.id)).toEqual(['b']);
    expect(filterRecommendations(items, { rule: 'meta' }).map((r) => r.id)).toEqual(['b']);
  });

  it('returns all when no filters are set', () => {
    expect(filterRecommendations(items, {})).toHaveLength(2);
  });
});

describe('sortRecommendations', () => {
  it('sorts by severity descending', () => {
    const sorted = sortRecommendations([rec({ id: 'low', severity: 'low' }), rec({ id: 'high', severity: 'high' })], 'severity');
    expect(sorted.map((r) => r.id)).toEqual(['high', 'low']);
  });

  it('sorts by score ascending', () => {
    const sorted = sortRecommendations([rec({ id: 'b', score: 90 }), rec({ id: 'a', score: 10 })]);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('sorts by created date', () => {
    const sorted = sortRecommendations([rec({ id: 'later', createdAt: 200 }), rec({ id: 'earlier', createdAt: 100 })], 'created');
    expect(sorted.map((r) => r.id)).toEqual(['earlier', 'later']);
  });
});

describe('scoreLabel', () => {
  it('labels score bands', () => {
    expect(scoreLabel(90)).toBe('Good');
    expect(scoreLabel(60)).toBe('Needs work');
    expect(scoreLabel(20)).toBe('Poor');
  });
});

describe('recommendationTone', () => {
  it('maps severities to tones', () => {
    expect(recommendationTone('critical')).toBe('danger');
    expect(recommendationTone('high')).toBe('danger');
    expect(recommendationTone('medium')).toBe('warning');
    expect(recommendationTone('low')).toBe('info');
    expect(recommendationTone('info')).toBe('neutral');
  });
});

describe('explainRecommendation', () => {
  it('builds a human explanation', () => {
    const explanation = explainRecommendation(rec({}));
    expect(explanation.title).toBe('Fix title tag');
    expect(explanation.suggestedAction).toContain('title-tag');
    expect(explanation.impact).toContain('Poor');
  });
});

describe('breakdownCards', () => {
  it('tones each score band', () => {
    const cards = breakdownCards({ crawl: 80, content: 60, performance: 30, links: 50, technical: 90 });
    expect(cards.find((c) => c.id === 'crawl')).toMatchObject({ tone: 'success' });
    expect(cards.find((c) => c.id === 'content')).toMatchObject({ tone: 'warning' });
    expect(cards.find((c) => c.id === 'performance')).toMatchObject({ tone: 'danger' });
    expect(cards.find((c) => c.id === 'links')).toMatchObject({ tone: 'warning' });
  });
});

describe('renderSeoPage', () => {
  it('renders the breakdown and filtered recommendations', () => {
    const html = renderToString(
      renderSeoPage({
        recommendations: [rec({})],
        breakdown: { crawl: 80, content: 80, performance: 80, links: 80, technical: 80 },
        filters: { severity: 'high' },
        canWrite: true,
      }),
    );
    expect(html).toContain('Score breakdown');
    expect(html).toContain('id="seo-table"');
    expect(html).toContain('seo:plan:r1');
    expect(html).toContain('seo:resolve:r1');
  });

  it('renders read-only rows and empty state', () => {
    const html = renderToString(
      renderSeoPage({ recommendations: [], breakdown: { crawl: 0, content: 0, performance: 0, links: 0, technical: 0 }, filters: {}, canWrite: false }),
    );
    expect(html).toContain('No recommendations match the current filters.');
    expect(html).not.toContain('seo:plan:');
  });

  it('renders dashes for read-only recommendation rows', () => {
    const html = renderToString(
      renderSeoPage({ recommendations: [rec({})], breakdown: { crawl: 0, content: 0, performance: 0, links: 0, technical: 0 }, filters: {}, canWrite: false }),
    );
    expect(html).toContain('>—</td>');
    expect(html).not.toContain('seo:plan:');
  });
});

describe('createSeoApi', () => {
  it('wraps SEO endpoints onto the client', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const api = {
      request: async <T>(method: string, url: string, body: unknown): Promise<T> => {
        calls.push({ method, url, body });
        return { ok: true } as T;
      },
    } as never;
    const seoApi = createSeoApi(api);
    await seoApi.list();
    await seoApi.breakdown();
    await seoApi.update('r1', { status: 'resolved' });
    expect(calls).toEqual([
      { method: 'GET', url: '/api/v1/seo/recommendations', body: undefined },
      { method: 'GET', url: '/api/v1/seo/breakdown', body: undefined },
      { method: 'PATCH', url: '/api/v1/seo/recommendations/r1', body: { status: 'resolved' } },
    ]);
  });
});
