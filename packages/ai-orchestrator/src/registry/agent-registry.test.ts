import { ConflictError, NotFoundError, ValidationError } from '@seogod/core';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from './agent-registry.js';
import { agentDefinition } from '../test/fixtures.js';

describe('AgentRegistry', () => {
  it('registers, reads, and lists agents', () => {
    const registry = new AgentRegistry();
    const definition = agentDefinition();
    expect(registry.register(definition).id).toBe('title-writer');
    expect(registry.has('title-writer')).toBe(true);
    expect(registry.get('title-writer').name).toBe('Title Writer');
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects duplicate registration unless overwrite is allowed', () => {
    const strict = new AgentRegistry();
    strict.register(agentDefinition());
    expect(() => strict.register(agentDefinition())).toThrow(ConflictError);

    const loose = new AgentRegistry({ allowOverwrite: true });
    loose.register(agentDefinition());
    loose.register(agentDefinition({ description: 'v2' }));
    expect(loose.get('title-writer').description).toBe('v2');
  });

  it('unregisters agents and throws for unknown ones', () => {
    const registry = new AgentRegistry();
    registry.register(agentDefinition());
    registry.unregister('title-writer');
    expect(registry.has('title-writer')).toBe(false);
    expect(() => registry.unregister('title-writer')).toThrow(NotFoundError);
  });

  it('throws NotFoundError when reading a missing agent', () => {
    expect(() => new AgentRegistry().get('missing')).toThrow(NotFoundError);
  });

  it('resolves agents by task type with health, priority, then id', () => {
    const registry = new AgentRegistry();
    registry.register(agentDefinition({ id: 'writer-b', priority: 5, supportedTasks: ['update_title'] }));
    registry.register(agentDefinition({ id: 'writer-a', priority: 5, supportedTasks: ['update_title'] }));
    registry.register(
      agentDefinition({
        id: 'degraded-writer',
        priority: 1,
        supportedTasks: ['update_title'],
        health: { status: 'degraded' },
      }),
    );
    const resolved = registry.resolve('update_title');
    expect(resolved.id).toBe('writer-a');
  });

  it('throws when no agent supports the task type', () => {
    expect(() => new AgentRegistry().resolve('update_title')).toThrow(NotFoundError);
  });

  it('finds agents by capability sorted by id', () => {
    const registry = new AgentRegistry();
    registry.register(agentDefinition({ id: 'b-agent', capabilities: ['writing'] }));
    registry.register(agentDefinition({ id: 'a-agent', capabilities: ['writing'] }));
    expect(registry.findByCapability('writing').map((a) => a.id)).toEqual(['a-agent', 'b-agent']);
    expect(registry.findByCapability('nope')).toEqual([]);
  });

  it('updates agent health', () => {
    const registry = new AgentRegistry();
    registry.register(agentDefinition());
    const updated = registry.updateHealth('title-writer', {
      status: 'down',
      detail: 'outage',
      lastCheckedAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(updated.health.status).toBe('down');
    expect(updated.health.detail).toBe('outage');
  });

  it('validates agent definitions on register', () => {
    const registry = new AgentRegistry();
    expect(() => registry.register(agentDefinition({ id: '' }))).toThrow(ValidationError);
    expect(() => registry.register(agentDefinition({ name: '' }))).toThrow(ValidationError);
    expect(() => registry.register(agentDefinition({ version: '' }))).toThrow(ValidationError);
    expect(() => registry.register(agentDefinition({ provider: '' }))).toThrow(ValidationError);
    expect(() => registry.register(agentDefinition({ model: '' }))).toThrow(ValidationError);
    expect(() => registry.register(agentDefinition({ maxConcurrency: 0 }))).toThrow(ValidationError);
    expect(() => registry.register(agentDefinition({ priority: -1 }))).toThrow(ValidationError);
  });

  it('returns copies, not internal references', () => {
    const registry = new AgentRegistry();
    const stored = registry.register(agentDefinition());
    stored.name = 'Mutated';
    expect(registry.get('title-writer').name).toBe('Title Writer');
  });
});
