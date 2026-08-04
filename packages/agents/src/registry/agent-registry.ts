import { ConflictError, NotFoundError, ValidationError } from '@seogod/core';
import type { Agent } from '../interfaces/agent.js';
import type { AgentDefinition } from '../types/agent.js';

/**
 * Holds the agents available for invocation. Registration validates the agent
 * contract so a broken agent can never reach the service.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();

  register(agent: Agent): AgentDefinition {
    if (agent.id.length === 0) {
      throw new ValidationError('Agent id must be a non-empty string', {
        module: 'agents',
        operation: 'registry.register',
      });
    }
    if (this.agents.has(agent.id)) {
      throw new ConflictError(`Agent "${agent.id}" is already registered`, {
        module: 'agents',
        operation: 'registry.register',
      });
    }
    this.agents.set(agent.id, agent);
    return agent.definition();
  }

  unregister(id: string): void {
    if (!this.agents.delete(id)) {
      throw new NotFoundError(`Agent "${id}" was not found`, {
        module: 'agents',
        operation: 'registry.unregister',
      });
    }
  }

  get(id: string): Agent {
    const agent = this.agents.get(id);
    if (agent === undefined) {
      throw new NotFoundError(`Agent "${id}" was not found`, {
        module: 'agents',
        operation: 'registry.get',
      });
    }
    return agent;
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }

  listDefinitions(): AgentDefinition[] {
    return this.list().map((agent) => agent.definition());
  }

  findByCapability(capability: string): Agent[] {
    return this.list().filter((agent) => agent.capabilities.includes(capability));
  }
}
