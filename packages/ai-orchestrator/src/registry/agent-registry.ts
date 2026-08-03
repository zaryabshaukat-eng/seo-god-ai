import { ConflictError, NotFoundError, ValidationError } from '@seogod/core';
import type { AgentDefinition, AgentHealth } from '../types/agent.js';

export interface AgentRegistryOptions {
  /** Allow re-registration to overwrite an existing definition (default false). */
  allowOverwrite?: boolean;
}

/**
 * Dynamic agent registry. Agents register at runtime; the planner resolves
 * an agent for each task type deterministically by capability and priority.
 */
export class AgentRegistry {
  private readonly definitions = new Map<string, AgentDefinition>();
  private readonly allowOverwrite: boolean;

  constructor(options: AgentRegistryOptions = {}) {
    this.allowOverwrite = options.allowOverwrite ?? false;
  }

  register(definition: AgentDefinition): AgentDefinition {
    this.validateDefinition(definition);
    const existing = this.definitions.get(definition.id);
    if (existing !== undefined && !this.allowOverwrite) {
      throw new ConflictError(`Agent "${definition.id}" is already registered`, {
        module: 'ai-orchestrator',
        operation: 'registry.register',
      });
    }
    const stored: AgentDefinition = { ...definition };
    this.definitions.set(definition.id, stored);
    return { ...stored };
  }

  unregister(id: string): void {
    if (!this.definitions.has(id)) {
      throw new NotFoundError(`Agent "${id}" is not registered`, {
        module: 'ai-orchestrator',
        operation: 'registry.unregister',
      });
    }
    this.definitions.delete(id);
  }

  get(id: string): AgentDefinition {
    const definition = this.definitions.get(id);
    if (definition === undefined) {
      throw new NotFoundError(`Agent "${id}" is not registered`, {
        module: 'ai-orchestrator',
        operation: 'registry.get',
      });
    }
    return definition;
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  list(): AgentDefinition[] {
    return [...this.definitions.values()];
  }

  /**
   * Resolves the best agent for a task type: agents supporting it are sorted
   * by health (ok first), then priority (low first), then id for stability.
   */
  resolve(taskType: string): AgentDefinition {
    const candidates = this.list()
      .filter((agent) => agent.supportedTasks.includes(taskType))
      .sort((a, b) => {
        const aOk = a.health.status === 'ok' ? 0 : 1;
        const bOk = b.health.status === 'ok' ? 0 : 1;
        if (aOk !== bOk) return aOk - bOk;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
    const best = candidates[0];
    if (best === undefined) {
      throw new NotFoundError(`No registered agent supports task type "${taskType}"`, {
        module: 'ai-orchestrator',
        operation: 'registry.resolve',
      });
    }
    return best;
  }

  /** Finds agents whose capabilities intersect the given set. */
  findByCapability(capability: string): AgentDefinition[] {
    return this.list()
      .filter((agent) => agent.capabilities.includes(capability))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  updateHealth(id: string, health: AgentHealth): AgentDefinition {
    const definition = this.get(id);
    const updated: AgentDefinition = { ...definition, health };
    this.definitions.set(id, updated);
    return updated;
  }

  private validateDefinition(definition: AgentDefinition): void {
    const problems: string[] = [];
    if (definition.id.trim() === '') problems.push('id is required');
    if (definition.name.trim() === '') problems.push('name is required');
    if (definition.version.trim() === '') problems.push('version is required');
    if (definition.provider.trim() === '') problems.push('provider is required');
    if (definition.model.trim() === '') problems.push('model is required');
    if (definition.maxConcurrency < 1) problems.push('maxConcurrency must be >= 1');
    if (definition.priority < 0) problems.push('priority must be >= 0');
    if (problems.length > 0) {
      throw new ValidationError(`Invalid agent definition: ${problems.join(', ')}`, {
        module: 'ai-orchestrator',
        operation: 'registry.register',
      });
    }
  }
}
