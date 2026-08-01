import { describe, expect, it } from 'vitest';
import { analyzeStructuredData } from './structured-data.js';
import { resolveConfig } from '../config.js';
import { engineInput, extraction, page } from '../test/fixtures.js';

const jsonLd = (valid: boolean) => ({ format: 'jsonld' as const, schemaType: 'Product', valid, raw: {} });

describe('analyzeStructuredData', () => {
  it('recommends missing structured data only when enough high-value pages qualify', () => {
    const input = engineInput({
      pages: [
        page({ url: 'https://a.com', type: 'product' }),
        page({ url: 'https://b.com', type: 'collection' }),
        page({ url: 'https://c.com', type: 'homepage' }),
      ],
    });
    const [candidate] = analyzeStructuredData(input, resolveConfig());
    expect(candidate!.rule).toBe('missing-structured-data');
    expect(candidate!.affectedUrls).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    expect(candidate!.pageCount).toBe(3);
    expect(candidate!.title).toContain('(3 pages)');
  });

  it('does not recommend structured data below the minimum page count', () => {
    const input = engineInput({
      pages: [page({ type: 'product' }), page({ type: 'product' })],
    });
    expect(analyzeStructuredData(input, resolveConfig())).toEqual([]);
  });

  it('respects the configured minimum', () => {
    const config = resolveConfig({ thresholds: { missingStructuredDataMinPages: 2 } });
    const input = engineInput({
      pages: [page({ type: 'product' }), page({ type: 'product' })],
    });
    const [candidate] = analyzeStructuredData(input, config);
    expect(candidate!.rule).toBe('missing-structured-data');
  });

  it('ignores non-high-value page types for the missing check', () => {
    const input = engineInput({
      pages: [page({ type: 'blog' }), page({ type: 'article' }), page({ type: 'page' })],
    });
    expect(analyzeStructuredData(input, resolveConfig())).toEqual([]);
  });

  it('flags invalid structured-data blocks', () => {
    const input = engineInput({
      pages: [
        page({
          url: 'https://a.com',
          extraction: extraction({ url: 'https://a.com', structuredData: [jsonLd(true), jsonLd(false)] }),
        }),
        page({
          url: 'https://b.com',
          extraction: extraction({ url: 'https://b.com', structuredData: [jsonLd(false)] }),
        }),
      ],
    });
    const [candidate] = analyzeStructuredData(input, resolveConfig());
    expect(candidate!.rule).toBe('invalid-structured-data');
    expect(candidate!.affectedUrls).toEqual(['https://a.com', 'https://b.com']);
    expect(candidate!.occurrenceCount).toBe(2);
  });

  it('emits both rules when both conditions hold', () => {
    const input = engineInput({
      pages: [
        page({ url: 'https://a.com', type: 'product' }),
        page({ url: 'https://b.com', type: 'collection' }),
        page({ url: 'https://d.com', type: 'product' }),
        page({
          url: 'https://c.com',
          type: 'homepage',
          extraction: extraction({ url: 'https://c.com', structuredData: [jsonLd(false)] }),
        }),
      ],
    });
    const rules = analyzeStructuredData(input, resolveConfig()).map((c) => c.rule).sort();
    expect(rules).toEqual(['invalid-structured-data', 'missing-structured-data']);
  });

  it('skips pages without extractions', () => {
    const input = engineInput({ pages: [page({ type: 'product', extraction: null })] });
    expect(analyzeStructuredData(input, resolveConfig())).toEqual([]);
  });
});
