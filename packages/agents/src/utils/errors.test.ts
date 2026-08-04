import { describe, expect, it } from 'vitest';
import { AgentError, SafetyViolationError } from './errors.js';

describe('agent errors', () => {
  it('AgentError defaults code and module', () => {
    const error = new AgentError('boom');
    expect(error.message).toBe('boom');
    expect(error.code).toBe('agents.error');
    expect(error.module).toBe('agents');
  });

  it('AgentError preserves custom options', () => {
    const error = new AgentError('boom', { code: 'agents.custom', operation: 'op' });
    expect(error.code).toBe('agents.custom');
    expect(error.operation).toBe('op');
  });

  it('SafetyViolationError uses its own code and is an AgentError', () => {
    const error = new SafetyViolationError('unsafe');
    expect(error).toBeInstanceOf(AgentError);
    expect(error.code).toBe('agents.safety_violation');
  });
});
