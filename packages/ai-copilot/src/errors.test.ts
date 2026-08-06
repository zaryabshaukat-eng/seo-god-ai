import { describe, expect, it } from 'vitest';
import {
  CopilotAuthorizationError,
  CopilotError,
  CopilotIsolationError,
  CopilotNotFoundError,
  CopilotProviderError,
  CopilotToolError,
  CopilotValidationError,
} from './errors.js';

describe('copilot errors', () => {
  it('base CopilotError carries the module and cause', () => {
    const error = new CopilotError('boom', { cause: new Error('root') });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('boom');
    expect(error.module).toBe('ai-copilot');
    expect(error.cause).toEqual(new Error('root'));
    expect(error.retryable).toBe(false);
  });

  it('subclasses expose canonical codes', () => {
    expect(new CopilotValidationError('v').code).toBe('validation.error');
    expect(new CopilotNotFoundError('n').code).toBe('not_found');
    expect(new CopilotAuthorizationError('a').code).toBe('authorization.denied');
    expect(new CopilotIsolationError('i').code).toBe('authorization.denied');
    expect(new CopilotProviderError('p').code).toBe('integration.error');
  });

  it('CopilotToolError passes options through to the base', () => {
    const error = new CopilotToolError('t', { context: { name: 'x' }, operation: 'tool.run' });
    expect(error.code).toBe('ai.error');
    expect(error.module).toBe('ai-copilot');
    expect(error.operation).toBe('tool.run');
    expect(error.context).toEqual({ name: 'x' });
  });
});
