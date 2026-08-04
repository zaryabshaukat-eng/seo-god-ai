import { describe, expect, it } from 'vitest';
import { CollectionAgent } from './collection-agent.js';
import { makeEntity, makeInput } from '../test/helpers.js';

function collection(data: Record<string, unknown>): ReturnType<typeof makeEntity> {
  return makeEntity({ type: 'collection', ref: `https://acme.example/collections/${data.id ?? 'x'}`, data });
}

function run(data: Array<Record<string, unknown>>) {
  return new CollectionAgent().analyze(makeInput({ entities: data.map(collection) }));
}

function rulesOf(result: ReturnType<CollectionAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('CollectionAgent', () => {
  it('flags missing descriptions', () => {
    const out = run([{ title: 'Summer' }]);
    expect(rulesOf(out)).toContain('collections.missing-description');
  });

  it('flags thin descriptions', () => {
    const out = run([{ description: 'few words' }]);
    expect(rulesOf(out)).toContain('collections.thin-description');
  });

  it('flags empty collections', () => {
    const out = run([{ description: 'x'.repeat(1000) }]);
    expect(rulesOf(out)).toContain('collections.empty-collection');
  });

  it('proposes a meta title action for collections without one', () => {
    const out = run([{ title: 'Summer Sale', description: 'x'.repeat(1000), productsCount: 5 }]);
    expect(rulesOf(out)).toContain('collections.missing-title');
    expect(out.actions[0]?.actionType).toBe('update_title');
  });

  it('passes healthy collections', () => {
    const out = run([
      {
        title: 'Summer Sale',
        metaTitle: 'Summer Sale | Acme',
        description: 'x'.repeat(1000),
        wordCount: 200,
        productsCount: 5,
      },
    ]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('falls back to body copy for the description', () => {
    const out = run([
      {
        description: '  ',
        body: 'x'.repeat(1000),
        wordCount: 200,
        title: 'Summer',
        metaTitle: 'M',
        productsCount: 5,
      },
    ]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('treats whitespace-only description and body as missing', () => {
    const out = run([{ description: '  ', body: '  ', title: 'Summer', productsCount: 5 }]);
    expect(rulesOf(out)).toContain('collections.missing-description');
  });
});
