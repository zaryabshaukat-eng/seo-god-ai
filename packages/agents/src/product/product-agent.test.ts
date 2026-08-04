import { describe, expect, it } from 'vitest';
import { ProductAgent } from './product-agent.js';
import { makeEntity, makeInput } from '../test/helpers.js';

function product(data: Record<string, unknown>): ReturnType<typeof makeEntity> {
  return makeEntity({ type: 'product', ref: `https://acme.example/products/${data.id ?? 'x'}`, data });
}

function run(data: Array<Record<string, unknown>>) {
  return new ProductAgent().analyze(makeInput({ entities: data.map(product) }));
}

function rulesOf(result: ReturnType<ProductAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('ProductAgent', () => {
  it('flags missing descriptions with execution hints', () => {
    const out = run([{ title: 'Widget' }]);
    expect(rulesOf(out)).toContain('product.missing-description');
    expect(out.executionHints.length).toBeGreaterThan(0);
  });

  it('flags thin descriptions', () => {
    const out = run([{ description: 'only a few words here' }]);
    expect(rulesOf(out)).toContain('product.thin-description');
  });

  it('flags missing images', () => {
    const out = run([{ description: 'x'.repeat(1000) }]);
    expect(rulesOf(out)).toContain('product.missing-images');
  });

  it('proposes a meta title action when none exists', () => {
    const out = run([{ title: 'Acme Widget', description: 'x'.repeat(1000), images: ['/a.jpg'] }]);
    expect(rulesOf(out)).toContain('product.missing-title');
    expect(out.actions[0]?.actionType).toBe('update_title');
  });

  it('flags duplicate product titles', () => {
    const out = run([
      { title: 'Same', description: 'x'.repeat(1000) },
      { title: 'Same', description: 'x'.repeat(1000) },
    ]);
    expect(rulesOf(out)).toContain('product.duplicate-title');
  });

  it('ignores non-product entities', () => {
    const out = new ProductAgent().analyze(
      makeInput({ entities: [makeEntity({ type: 'page', data: { title: 'x' } })] }),
    );
    expect(out.recommendations).toHaveLength(0);
  });

  it('falls back to body copy for the description', () => {
    const out = run([
      {
        description: '  ',
        body: 'x'.repeat(1000),
        wordCount: 200,
        title: 'T',
        metaTitle: 'M',
        images: ['/a.jpg'],
      },
    ]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('treats whitespace-only description and body as missing', () => {
    const out = run([
      { description: '  ', body: '  ', title: 'T', metaTitle: 'M', images: ['/a.jpg'] },
    ]);
    expect(rulesOf(out)).toContain('product.missing-description');
  });
});
