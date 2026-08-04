import { describe, expect, it } from 'vitest';
import { TechnicalSeoAgent } from './technical-seo-agent.js';
import { makeEntity, makeInput } from '../test/helpers.js';

function page(data: Record<string, unknown>, id: string): ReturnType<typeof makeEntity> {
  return makeEntity({ id, ref: `https://acme.example/p/${id}`, data });
}

function run(data: Array<Record<string, unknown>>) {
  return new TechnicalSeoAgent().analyze(
    makeInput({ entities: data.map((entry, index) => page(entry, `p${index}`)) }),
  );
}

function rulesOf(result: ReturnType<TechnicalSeoAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('TechnicalSeoAgent', () => {
  it('flags a missing canonical and proposes a self-referencing fix', () => {
    const out = run([{ url: 'https://acme.example/p/0' }]);
    expect(rulesOf(out)).toContain('technical-seo.missing-canonical');
    expect(out.actions[0]?.actionType).toBe('update_canonical');
  });

  it('flags a conflicting canonical', () => {
    const out = run([{ url: 'https://acme.example/p/0', canonical: 'https://other.example/x' }]);
    expect(rulesOf(out)).toContain('technical-seo.conflicting-canonical');
  });

  it('flags a page blocked by noindex while in the sitemap', () => {
    const out = run([{ robots: 'noindex, nofollow', sitemapIncluded: true }]);
    expect(rulesOf(out)).toContain('technical-seo.robots-blocked');
    expect(out.actions.some((action) => action.actionType === 'update_robots')).toBe(true);
  });

  it('does not flag sitemap-excluded noindex pages', () => {
    const out = run([{ robots: 'noindex', sitemapIncluded: false }]);
    expect(rulesOf(out)).not.toContain('technical-seo.robots-blocked');
  });

  it('flags a redirect chain', () => {
    const out = run([
      { url: 'https://acme.example/p/0', redirectTo: 'https://acme.example/p/1' },
      { url: 'https://acme.example/p/1', redirectTo: 'https://acme.example/p/2' },
    ]);
    expect(rulesOf(out)).toContain('technical-seo.redirect-chain');
  });

  it('flags broken pages', () => {
    const out = run([{ statusCode: 404 }]);
    expect(rulesOf(out)).toContain('technical-seo.broken-page');
  });

  it('does not flag redirects to final pages without further redirects', () => {
    const out = run([
      { url: 'https://acme.example/p/0', redirectTo: 'https://acme.example/p/p1' },
      {},
    ]);
    expect(rulesOf(out)).not.toContain('technical-seo.redirect-chain');
  });

  it('ignores empty redirect targets', () => {
    const out = run([{ redirectTo: '  ' }]);
    expect(rulesOf(out)).not.toContain('technical-seo.redirect-chain');
  });

  it('maps store entities to the store resource type', () => {
    const input = makeInput({
      entities: [makeEntity({ type: 'store', ref: 'https://acme.example', data: {} })],
    });
    const out = new TechnicalSeoAgent().analyze(input);
    expect(out.actions[0]?.resourceType).toBe('store');
  });

  it('ignores healthy entities', () => {
    const out = run([
      { url: 'https://acme.example/p/0', canonical: 'https://acme.example/p/0', statusCode: 200, sitemapIncluded: true },
    ]);
    expect(out.recommendations).toHaveLength(0);
    expect(out.actions).toHaveLength(0);
  });
});
