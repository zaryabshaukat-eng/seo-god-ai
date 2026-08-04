import { ConflictError, NotFoundError, ValidationError } from '@seogod/core';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from './agent-registry.js';
import { StubAgent } from '../test/helpers.js';

describe('AgentRegistry', () => {
  it('registers an agent and returns its definition', () => {
    const registry = new AgentRegistry();
    const agent = new StubAgent('metadata', () => ({}) as never);
    const definition = registry.register(agent);
    expect(definition.id).toBe('metadata');
    expect(registry.has('metadata')).toBe(true);
  });

  it('rejects agents with empty ids', () => {
    const registry = new AgentRegistry();
    const agent = new StubAgent('metadata', () => ({}) as never);
    Object.defineProperty(agent, 'id', { value: '' });
    expect(() => registry.register(agent)).toThrow(ValidationError);
  });

  it('rejects duplicate registration', () => {
    const registry = new AgentRegistry();
    registry.register(new StubAgent('metadata', () => ({}) as never));
    expect(() => registry.register(new StubAgent('metadata', () => ({}) as never))).toThrow(ConflictError);
  });

  it('gets, lists and finds agents by capability', () => {
    const registry = new AgentRegistry();
    const a = new StubAgent('a', () => ({}) as never);
    const b = new StubAgent('b', () => ({}) as never);
    Object.defineProperty(a, 'capabilities', { value: ['alpha'] });
    Object.defineProperty(b, 'capabilities', { value: ['beta'] });
    registry.register(a);
    registry.register(b);
    expect(registry.get('a').id).toBe('a');
    expect(registry.list()).toHaveLength(2);
    expect(registry.listDefinitions().map((definition) => definition.id)).toEqual(['a', 'b']);
    expect(registry.findByCapability('beta').map((agent) => agent.id)).toEqual(['b']);
  });

  it('throws NotFoundError on missing agents and unregister', () => {
    const registry = new AgentRegistry();
    expect(() => registry.get('missing')).toThrow(NotFoundError);
    expect(() => registry.unregister('missing')).toThrow(NotFoundError);
  });

  it('unregisters an existing agent', () => {
    const registry = new AgentRegistry();
    registry.register(new StubAgent('a', () => ({}) as never));
    registry.unregister('a');
    expect(registry.has('a')).toBe(false);
  });
});
