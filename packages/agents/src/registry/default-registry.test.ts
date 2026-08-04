import { describe, expect, it } from 'vitest';
import { buildDefaultRegistry, DEFAULT_AGENTS } from './default-registry.js';

describe('default registry', () => {
  it('ships thirteen distinct agents', () => {
    expect(DEFAULT_AGENTS).toHaveLength(13);
    const ids = DEFAULT_AGENTS.map((agent) => agent.id);
    expect(new Set(ids).size).toBe(13);
  });

  it('builds a registry pre-loaded with every default agent', () => {
    const registry = buildDefaultRegistry();
    for (const agent of DEFAULT_AGENTS) {
      expect(registry.has(agent.id)).toBe(true);
    }
    expect(registry.list()).toHaveLength(13);
  });

  it('every default agent exposes valid metadata and schemas', () => {
    for (const agent of DEFAULT_AGENTS) {
      expect(agent.id.length).toBeGreaterThan(0);
      expect(agent.version).toBe('1.0.0');
      expect(agent.inputSchema.type).toBe('object');
      expect(agent.outputSchema.type).toBe('object');
      expect(Array.isArray(agent.supportedActionTypes)).toBe(true);
    }
  });
});
