import { describe, expect, it } from 'vitest';
import { SchemaAgent } from './schema-agent.js';
import { makeEntity, makeInput } from '../test/helpers.js';

function page(data: Record<string, unknown>): ReturnType<typeof makeEntity> {
  return makeEntity({ type: 'product', ref: 'https://acme.example/products/1', data });
}

function run(data: Array<Record<string, unknown>>) {
  return new SchemaAgent().analyze(makeInput({ entities: data.map(page) }));
}

function rulesOf(result: ReturnType<SchemaAgent['analyze']>): string[] {
  return result.recommendations.map((recommendation) => recommendation.rule);
}

describe('SchemaAgent', () => {
  it('proposes additive structured data when nothing exists', () => {
    const out = run([{ name: 'Widget', url: 'https://acme.example/products/1' }]);
    expect(rulesOf(out)).toContain('schema.missing-structured-data');
    expect(out.actions[0]?.actionType).toBe('add_structured_data');
    expect((out.actions[0]?.payload as { type: string }).type).toBe('Product');
  });

  it('reads jsonLd as an alternative source', () => {
    const out = run([{ jsonLd: [{ '@type': 'Product' }] }]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('flags invalid blocks and proposes removal', () => {
    const out = run([{ structuredData: [{}] }]);
    expect(rulesOf(out)).toContain('schema.invalid-structured-data');
    expect(out.actions[0]?.actionType).toBe('remove_structured_data');
  });

  it('flags a missing expected type among valid blocks', () => {
    const out = run([{ structuredData: [{ '@type': 'Article' }] }]);
    expect(rulesOf(out)).toContain('schema.missing-key-type');
    expect(out.actions[0]?.actionType).toBe('add_structured_data');
  });

  it('maps unknown entity types to WebPage', () => {
    const input = makeInput({
      entities: [makeEntity({ type: 'custom', ref: 'https://acme.example/x', data: {} })],
    });
    const out = new SchemaAgent().analyze(input);
    const action = out.actions[0];
    expect((action?.payload as { type: string }).type).toBe('WebPage');
  });

  it('reads the type key as an alternative to @type', () => {
    const out = run([{ structuredData: [{ type: 'Product' }] }]);
    expect(out.recommendations).toHaveLength(0);
  });

  it('flags blocks with an empty type string as invalid', () => {
    const out = run([{ structuredData: [{ '@type': '' }] }]);
    expect(rulesOf(out)).toContain('schema.invalid-structured-data');
  });

  it('maps store entities to the store resource type', () => {
    const input = makeInput({
      entities: [makeEntity({ type: 'store', ref: 'https://acme.example', data: {} })],
    });
    const out = new SchemaAgent().analyze(input);
    expect(out.actions[0]?.resourceType).toBe('store');
    expect((out.actions[0]?.payload as { type: string }).type).toBe('Organization');
  });

  it('flags non-object structured data entries as invalid', () => {
    const out = run([{ structuredData: ['Product', null] }]);
    expect(rulesOf(out)).toContain('schema.invalid-structured-data');
  });
});
