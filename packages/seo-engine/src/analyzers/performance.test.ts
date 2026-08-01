import { describe, expect, it } from 'vitest';
import { analyzePerformance } from './performance.js';
import { resolveConfig } from '../config.js';
import { engineInput, extraction, page, perf } from '../test/fixtures.js';

describe('analyzePerformance', () => {
  it('detects slow TTFB above the threshold', () => {
    const input = engineInput({
      pages: [
        page({
          url: 'https://a.com',
          extraction: extraction({ url: 'https://a.com', performance: perf({ ttfbMs: 2000 }) }),
        }),
      ],
    });
    const candidates = analyzePerformance(input, resolveConfig());
    expect(candidates.map((c) => c.rule)).toEqual(['slow-ttfb']);
    expect(candidates[0]!.affectedUrls).toEqual(['https://a.com']);
    expect(candidates[0]!.evidence[0]).toEqual({
      url: 'https://a.com',
      field: 'ttfbMs',
      value: 2000,
    });
  });

  it('detects oversized HTML and script counts', () => {
    const input = engineInput({
      pages: [
        page({
          url: 'https://a.com',
          extraction: extraction({
            url: 'https://a.com',
            performance: perf({ htmlSizeBytes: 600_000, scriptCount: 45 }),
          }),
        }),
      ],
    });
    const rules = analyzePerformance(input, resolveConfig()).map((c) => c.rule).sort();
    expect(rules).toEqual(['large-html', 'too-many-scripts']);
  });

  it('aggregates a signal across pages and dedupes URLs', () => {
    const input = engineInput({
      pages: [
        page({
          url: 'https://a.com',
          extraction: extraction({ url: 'https://a.com', performance: perf({ ttfbMs: 3000 }) }),
        }),
        page({
          url: 'https://b.com',
          extraction: extraction({ url: 'https://b.com', performance: perf({ ttfbMs: 4000 }) }),
        }),
      ],
    });
    const [candidate] = analyzePerformance(input, resolveConfig());
    expect(candidate!.affectedUrls).toEqual(['https://a.com', 'https://b.com']);
    expect(candidate!.pageCount).toBe(2);
    expect(candidate!.occurrenceCount).toBe(2);
    expect(candidate!.title).toContain('(2 pages)');
    expect(candidate!.evidence).toHaveLength(2);
  });

  it('respects raised thresholds', () => {
    const config = resolveConfig({ thresholds: { slowTtfbMs: 5000 } });
    const input = engineInput({
      pages: [
        page({
          url: 'https://a.com',
          extraction: extraction({ url: 'https://a.com', performance: perf({ ttfbMs: 3000 }) }),
        }),
      ],
    });
    expect(analyzePerformance(input, config)).toEqual([]);
  });

  it('skips pages without extractions', () => {
    const input = engineInput({ pages: [page({ extraction: null })] });
    expect(analyzePerformance(input, resolveConfig())).toEqual([]);
  });

  it('emits no candidate when nothing crosses a threshold', () => {
    expect(analyzePerformance(engineInput(), resolveConfig())).toEqual([]);
  });

  it('reports objective confidence for every signal', () => {
    const input = engineInput({
      pages: [
        page({
          url: 'https://a.com',
          extraction: extraction({ url: 'https://a.com', performance: perf({ ttfbMs: 9000 }) }),
        }),
      ],
    });
    const [candidate] = analyzePerformance(input, resolveConfig());
    expect(candidate!.confidence).toBe(0.85);
    expect(candidate!.category).toBe('performance');
    expect(candidate!.recommendedAction.length).toBeGreaterThan(0);
  });
});
