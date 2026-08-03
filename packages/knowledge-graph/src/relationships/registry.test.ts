import { describe, expect, it } from 'vitest';
import {
  assertAllowedPair,
  isAllowedPair,
  nodeTypeDefinition,
  nodeTypeRegistry,
  relationshipDefinition,
  relationshipRegistry,
} from './registry.js';

describe('relationship registry', () => {
  it('defines every edge type', () => {
    const types = relationshipRegistry().map((r) => r.type);
    expect(types).toHaveLength(13);
    expect(types).toContain('owns');
    expect(types).toContain('links_to');
    expect(types).toContain('targets');
    expect(types).toContain('generated');
  });

  it('enforces the sprint relationship examples', () => {
    expect(isAllowedPair('owns', 'store', 'collection')).toBe(true);
    expect(isAllowedPair('contains', 'collection', 'product')).toBe(true);
    expect(isAllowedPair('targets', 'product', 'keyword')).toBe(true);
    expect(isAllowedPair('links_to', 'page', 'page')).toBe(true);
    expect(isAllowedPair('contains', 'page', 'entity')).toBe(true);
    expect(isAllowedPair('belongs_to', 'article', 'topic-cluster')).toBe(true);
    expect(isAllowedPair('fixes', 'seo-recommendation', 'seo-issue')).toBe(true);
    expect(isAllowedPair('affects', 'seo-issue', 'page')).toBe(true);
    expect(isAllowedPair('describes', 'schema', 'product')).toBe(true);
    expect(isAllowedPair('belongs_to', 'keyword', 'search-intent')).toBe(true);
    expect(isAllowedPair('references', 'page', 'image')).toBe(true);
    expect(isAllowedPair('generated', 'agent-run', 'seo-recommendation')).toBe(true);
  });

  it('rejects invalid pairs', () => {
    expect(isAllowedPair('owns', 'product', 'keyword')).toBe(false);
    expect(isAllowedPair('targets', 'keyword', 'product')).toBe(false);
    expect(isAllowedPair('links_to', 'keyword', 'page')).toBe(false);
    expect(isAllowedPair('describes', 'page', 'schema')).toBe(false);
    expect(isAllowedPair('crawled', 'page', 'crawl')).toBe(false);
    expect(() => assertAllowedPair('owns', 'page', 'keyword')).toThrow(/cannot connect/);
  });

  it('exposes definitions and defaults', () => {
    const definition = relationshipDefinition('links_to');
    expect(definition.label).toBe('links to');
    expect(definition.defaultWeight).toBe(0.8);
    expect(definition.evidenceHint.length).toBeGreaterThan(0);
    expect(nodeTypeDefinition('product').label).toBe('Product');
    expect(nodeTypeRegistry()).toHaveLength(22);
  });
});
