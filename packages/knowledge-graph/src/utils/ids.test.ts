import { describe, expect, it } from 'vitest';
import { deterministicUuid, edgeId, isUuid, newId, nodeId } from './ids.js';

describe('ids', () => {
  it('produces v5-style deterministic UUIDs from names', () => {
    const a = deterministicUuid('node:page', 'https://acme.example/p/1');
    const b = deterministicUuid('node:page', 'https://acme.example/p/1');
    const c = deterministicUuid('node:page', 'https://acme.example/p/2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(isUuid(a)).toBe(true);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('derives distinct node and edge ids', () => {
    const fromId = nodeId('product', 'https://acme.example/p/1');
    const toId = nodeId('page', 'https://acme.example/p/2');
    expect(nodeId('product', 'https://acme.example/p/1')).toBe(fromId);
    const edge = edgeId('links_to', fromId, toId);
    expect(edgeId('links_to', toId, fromId)).not.toBe(edge);
    expect(isUuid(edge)).toBe(true);
  });

  it('creates random ids and rejects non-UUIDs', () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(isUuid(a)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('keeps ids stable across object shapes', () => {
    expect(nodeId('keyword', 'acme-widget')).toBe(nodeId('keyword', 'acme-widget'));
  });
});
