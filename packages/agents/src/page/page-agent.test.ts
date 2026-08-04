import { describe, expect, it } from 'vitest';
import { PageAgent } from './page-agent.js';
import { makeEntity, makeInput } from '../test/helpers.js';

function page(data: Record<string, unknown>, ref = 'https://acme.example/about'): ReturnType<typeof makeEntity> {
  return makeEntity({ type: 'page', ref, data });
}

function run(data: Array<ReturnType<typeof makeEntity>>) {
  return new PageAgent().analyze(makeInput({ entities: data }));
}

function rulesOf(result: ReturnType<PageAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('PageAgent', () => {
  it('flags broken pages with execution hints', () => {
    const out = run([page({ statusCode: 500 })]);
    expect(rulesOf(out)).toContain('page.broken-page');
    expect(out.executionHints.length).toBeGreaterThan(0);
  });

  it('flags thin content', () => {
    const out = run([page({ title: 'About' })]);
    expect(rulesOf(out)).toContain('page.thin-content');
  });

  it('flags missing titles', () => {
    const out = run([page({ body: 'x'.repeat(2000), wordCount: 400 })]);
    expect(rulesOf(out)).toContain('page.missing-title');
  });

  it('flags a missing homepage when pages exist', () => {
    const out = run([page({ title: 'About', body: 'x'.repeat(2000), wordCount: 400 })]);
    expect(rulesOf(out)).toContain('page.missing-homepage');
  });

  it('detects a homepage by url path', () => {
    const out = run([page({ url: 'https://acme.example/' }, 'https://acme.example/')]);
    expect(rulesOf(out)).not.toContain('page.missing-homepage');
  });

  it('detects a homepage by ref', () => {
    const out = run([page({ title: 'Home' }, '/')]);
    expect(rulesOf(out)).not.toContain('page.missing-homepage');
  });

  it('ignores non-page entities', () => {
    const out = new PageAgent().analyze(
      makeInput({ entities: [makeEntity({ type: 'product', data: {} })] }),
    );
    expect(out.recommendations).toHaveLength(0);
  });

  it('falls back to content copy when the body is missing', () => {
    const out = run([
      page(
        {
          body: '  ',
          content: 'x'.repeat(2000),
          wordCount: 400,
          title: 'About',
          url: 'https://acme.example/',
        },
        'https://acme.example/',
      ),
    ]);
    expect(out.recommendations).toHaveLength(0);
  });
});
