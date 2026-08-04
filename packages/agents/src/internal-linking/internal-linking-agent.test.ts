import { describe, expect, it } from 'vitest';
import { InternalLinkingAgent } from './internal-linking-agent.js';
import { makeEntity, makeInput } from '../test/helpers.js';

function page(data: Record<string, unknown>): ReturnType<typeof makeEntity> {
  return makeEntity({ data });
}

function run(data: Array<Record<string, unknown>>) {
  return new InternalLinkingAgent().analyze(makeInput({ entities: data.map(page) }));
}

function rulesOf(result: ReturnType<InternalLinkingAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('InternalLinkingAgent', () => {
  it('flags broken links and adds execution hints', () => {
    const out = run([{ brokenLinks: ['/dead', '/gone'] }]);
    expect(rulesOf(out)).toContain('internal-linking.broken-link');
    expect(out.executionHints.length).toBeGreaterThan(0);
  });

  it('reads hrefs from object-shaped link entries', () => {
    const out = run([{ brokenLinks: [{ href: '/dead' }, { url: '/also-dead' }] }]);
    expect(rulesOf(out)).toContain('internal-linking.broken-link');
  });

  it('proposes an action for orphan pages', () => {
    const out = run([{ orphan: true, title: 'Orphan page' }]);
    expect(rulesOf(out)).toContain('internal-linking.orphan-page');
    expect(out.actions[0]?.actionType).toBe('add_internal_links');
  });

  it('flags pages with no inbound links', () => {
    const out = run([{ inLinks: [] }]);
    expect(rulesOf(out)).toContain('internal-linking.no-inbound-links');
  });

  it('flags pages with too few inbound links', () => {
    const out = run([{ inLinks: ['/one'] }]);
    expect(rulesOf(out)).toContain('internal-linking.insufficient-inbound-links');
  });

  it('flags pages with no outbound links when they have inbounds', () => {
    const out = run([{ inLinks: ['/a', '/b'], outLinks: [] }]);
    expect(rulesOf(out)).toContain('internal-linking.no-outbound-links');
  });

  it('passes healthy linking profiles', () => {
    const out = run([{ inLinks: ['/a', '/b'], outLinks: ['/c'] }]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('falls back to the ref as the link anchor without a title', () => {
    const out = run([{ orphan: true }]);
    const action = out.actions[0];
    expect((action?.payload as { links: Array<{ anchor: string }> }).links[0]?.anchor).toBe(
      'https://acme.example/p/1',
    );
  });
});
