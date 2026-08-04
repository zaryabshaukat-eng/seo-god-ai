import { describe, expect, it } from 'vitest';
import { ContentAgent } from './content-agent.js';
import { makeEntity, makeInput } from '../test/helpers.js';

function page(data: Record<string, unknown>): ReturnType<typeof makeEntity> {
  return makeEntity({ data });
}

function run(data: Array<Record<string, unknown>>) {
  return new ContentAgent().analyze(makeInput({ entities: data.map(page) }));
}

function rulesOf(result: ReturnType<ContentAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('ContentAgent', () => {
  it('flags thin content', () => {
    const out = run([{ body: 'just a few words' }]);
    expect(rulesOf(out)).toContain('content.thin-content');
  });

  it('flags missing H1 when body exists', () => {
    const out = run([{ body: 'x'.repeat(500) }]);
    expect(rulesOf(out)).toContain('content.missing-h1');
  });

  it('flags multiple H1 headings', () => {
    const out = run([{ headings: [{ tag: 'h1' }, { tag: 'h1' }] }]);
    expect(rulesOf(out)).toContain('content.multiple-h1');
  });

  it('treats string headings as non-h1', () => {
    const out = run([{ headings: ['h1', 'h2'] }]);
    expect(rulesOf(out)).not.toContain('content.multiple-h1');
  });

  it('flags duplicate body copy', () => {
    const body = 'This is the exact same body copy across both pages. '.repeat(30);
    const out = run([{ body }, { body }]);
    expect(rulesOf(out)).toContain('content.duplicate-content');
  });

  it('produces no recommendations for healthy content', () => {
    const out = run([
      {
        body: 'x'.repeat(2000),
        wordCount: 400,
        headings: [{ tag: 'h1' }],
      },
    ]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('falls back to content copy when the body is missing', () => {
    const out = run([
      { body: '  ', content: 'x'.repeat(2000), wordCount: 400, headings: [{ tag: 'h1' }] },
    ]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('ignores non-h1 heading objects', () => {
    const out = run([{ headings: [{ tag: 'h2' }, { tag: 'h1' }] }]);
    expect(rulesOf(out)).not.toContain('content.multiple-h1');
    expect(rulesOf(out)).not.toContain('content.missing-h1');
  });
});
