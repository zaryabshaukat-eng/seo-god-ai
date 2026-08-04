import { describe, expect, it } from 'vitest';
import { MetadataAgent } from './metadata-agent.js';
import { makeEntity, makeInput } from '../test/helpers.js';

function page(data: Record<string, unknown>, overrides: Partial<{ id: string; ref: string }> = {}): ReturnType<typeof makeEntity> {
  return makeEntity({ id: overrides.id ?? 'p1', ref: overrides.ref ?? 'https://acme.example/p/1', data });
}

function run(data: Array<Record<string, unknown>>) {
  return new MetadataAgent().analyze(makeInput({ entities: data.map((entry, index) => page(entry, { id: `p${index}`, ref: `https://acme.example/p/${index}` })) }));
}

function rulesOf(result: ReturnType<MetadataAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('MetadataAgent', () => {
  it('flags a missing meta title and proposes an action from the title', () => {
    const out = run([{ title: 'Acme Widget' }]);
    expect(rulesOf(out)).toContain('metadata.missing-meta-title');
    expect(out.actions[0]?.actionType).toBe('update_title');
    expect((out.actions[0]?.payload as { title: string }).title).toBe('Acme Widget');
  });

  it('flags a missing meta title without proposing an action when no title exists', () => {
    const out = run([{}]);
    expect(rulesOf(out)).toContain('metadata.missing-meta-title');
    expect(out.actions).toHaveLength(0);
  });

  it('flags meta titles that are too long', () => {
    const out = run([{ title: 'T', metaTitle: 'x'.repeat(70) }]);
    expect(rulesOf(out)).toContain('metadata.meta-title-too-long');
    expect(out.actions[0]?.actionType).toBe('update_title');
  });

  it('flags meta titles that are too short', () => {
    const out = run([{ title: 'Acme Widget', metaTitle: 'short' }]);
    expect(rulesOf(out)).toContain('metadata.meta-title-too-short');
    expect(out.actions[0]?.actionType).toBe('update_title');
  });

  it('flags a missing meta description and derives a draft from the description', () => {
    const out = run([{ description: 'A long enough description' }]);
    expect(rulesOf(out)).toContain('metadata.missing-meta-description');
    expect(out.actions[0]?.actionType).toBe('update_meta_description');
  });

  it('flags a meta description that is too long', () => {
    const out = run([{ metaDescription: 'x'.repeat(200) }]);
    expect(rulesOf(out)).toContain('metadata.meta-description-too-long');
    expect(out.actions[0]?.actionType).toBe('update_meta_description');
  });

  it('flags duplicate titles across entities', () => {
    const out = run([{ title: 'Same Title' }, { title: 'Same Title' }]);
    expect(rulesOf(out)).toContain('metadata.duplicate-title');
  });

  it('leaves well-formed entities alone', () => {
    const out = run([
      {
        title: 'Acme Widget',
        metaTitle: 'Acme Widget | Buy Online',
        metaDescription: 'A well-formed meta description for the widget page.',
      },
    ]);
    expect(out.recommendations).toHaveLength(0);
    expect(out.actions).toHaveLength(0);
  });

  it('maps store entities to the store resource type', () => {
    const out = new MetadataAgent().analyze(
      makeInput({
        entities: [
          makeEntity({ type: 'store', ref: 'https://acme.example', data: { title: 'Acme' } }),
        ],
      }),
    );
    expect(out.actions[0]?.resourceType).toBe('store');
  });
});
