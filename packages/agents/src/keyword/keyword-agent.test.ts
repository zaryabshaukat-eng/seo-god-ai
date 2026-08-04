import { describe, expect, it } from 'vitest';
import { KeywordAgent } from './keyword-agent.js';
import { makeEntity, makeInput } from '../test/helpers.js';

function page(data: Record<string, unknown>): ReturnType<typeof makeEntity> {
  return makeEntity({ data });
}

function run(data: Array<Record<string, unknown>>) {
  return new KeywordAgent().analyze(makeInput({ entities: data.map(page) }));
}

function rulesOf(result: ReturnType<KeywordAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('KeywordAgent', () => {
  it('flags entities without a declared focus keyword', () => {
    const out = run([{}]);
    expect(rulesOf(out)).toContain('keyword.missing-focus-keyword');
  });

  it('reads the primary keyword as a fallback', () => {
    const out = run([{ primaryKeyword: 'shoes', title: 'shoes for running' }]);
    expect(rulesOf(out)).not.toContain('keyword.missing-focus-keyword');
  });

  it('reads the first keyword from a list', () => {
    const out = run([{ keywords: ['boots', 'hiking'], title: 'boots' }]);
    expect(rulesOf(out)).not.toContain('keyword.missing-focus-keyword');
  });

  it('proposes a title action when the keyword is missing from the title', () => {
    const out = run([{ focusKeyword: 'widget', title: 'Everything about things' }]);
    expect(rulesOf(out)).toContain('keyword.keyword-not-in-title');
    expect(out.actions[0]?.actionType).toBe('update_title');
    expect((out.actions[0]?.payload as { title: string }).title).toMatch(/^widget/i);
  });

  it('adds execution hints when the keyword is missing from body and slug', () => {
    const out = run([{ focusKeyword: 'widget', body: 'no mention here' }]);
    expect(rulesOf(out)).toContain('keyword.keyword-not-in-body');
    expect(rulesOf(out)).toContain('keyword.keyword-not-in-slug');
    expect(out.executionHints.length).toBeGreaterThan(0);
  });

  it('passes healthy keyword usage', () => {
    const out = run([
      { focusKeyword: 'widget', title: 'widget guide', body: 'all about widget', url: '/widget' },
    ]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('reads the keyword-bearing meta title', () => {
    const out = run([{ focusKeyword: 'widget', metaTitle: 'widget guide', body: 'widget', url: '/widget' }]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('ignores whitespace-only titles', () => {
    const out = run([{ focusKeyword: 'widget', metaTitle: '  ', body: 'widget', url: '/widget' }]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('falls back to content copy when the body is missing', () => {
    const out = run([
      { focusKeyword: 'widget', title: 'widget guide', body: '  ', content: 'about widget', url: '/widget' },
    ]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('falls back to the slug for url text', () => {
    const out = run([{ focusKeyword: 'widget', title: 'widget guide', body: 'widget', slug: 'widget' }]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('falls back to the entity ref for url text', () => {
    const out = run([
      { focusKeyword: 'widget', title: 'widget guide', body: 'widget', url: '  ', slug: '  ' },
    ]);
    expect(rulesOf(out)).toContain('keyword.keyword-not-in-slug');
  });
});
