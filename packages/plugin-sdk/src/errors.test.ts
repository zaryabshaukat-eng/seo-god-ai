import { describe, expect, it } from 'vitest';
import { asPluginError, isPluginError, PluginError, PluginErrorCode } from '../src/errors.js';

describe('PluginError', () => {
  it('carries code, message and frozen context', () => {
    const error = new PluginError(PluginErrorCode.notFound, 'Gone.', { context: { id: 'x' } });
    expect(error.code).toBe('plugin.not_found');
    expect(error.message).toBe('Gone.');
    expect(error.context).toEqual({ id: 'x' });
    expect(Object.isFrozen(error.context)).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PluginError');
  });

  it('defaults context to an empty object', () => {
    const error = new PluginError(PluginErrorCode.conflict, 'Nope.');
    expect(error.context).toEqual({});
  });

  it('wires an optional cause', () => {
    const cause = new Error('root');
    const error = new PluginError(PluginErrorCode.sandboxEval, 'Failed.', { cause });
    expect(error.cause).toBe(cause);
  });

  it('omits cause when not provided', () => {
    const error = new PluginError(PluginErrorCode.sandboxEval, 'Failed.');
    expect(error.cause).toBeUndefined();
  });

  it('serializes safely', () => {
    const error = new PluginError(PluginErrorCode.sandboxTimeout, 'Slow.', { context: { ms: 50 } });
    expect(error.toJSON()).toEqual({
      name: 'PluginError',
      code: 'plugin.sandbox.timeout',
      message: 'Slow.',
      context: { ms: 50 },
    });
  });
});

describe('PluginErrorCode', () => {
  it('exposes stable machine-readable codes', () => {
    expect(PluginErrorCode.invalidManifest).toBe('plugin.manifest.invalid');
    expect(PluginErrorCode.invalidVersion).toBe('plugin.version.invalid');
    expect(PluginErrorCode.invalidCode).toBe('plugin.code.invalid');
    expect(PluginErrorCode.sandboxTimeout).toBe('plugin.sandbox.timeout');
    expect(PluginErrorCode.sandboxEval).toBe('plugin.sandbox.eval_failed');
    expect(PluginErrorCode.permissionNotGranted).toBe('plugin.permission.not_granted');
    expect(PluginErrorCode.permissionNotDeclared).toBe('plugin.permission.not_declared');
    expect(PluginErrorCode.notFound).toBe('plugin.not_found');
    expect(PluginErrorCode.conflict).toBe('plugin.conflict');
    expect(PluginErrorCode.stateConflict).toBe('plugin.state.invalid');
    expect(PluginErrorCode.dependencyUnsatisfied).toBe('plugin.dependency.unsatisfied');
    expect(PluginErrorCode.engineUnsatisfied).toBe('plugin.engine.unsatisfied');
    expect(PluginErrorCode.missingImplementation).toBe('plugin.contribution.missing_impl');
    expect(PluginErrorCode.invalidOutput).toBe('plugin.contribution.invalid_output');
  });
});

describe('isPluginError / asPluginError', () => {
  it('guards and extracts', () => {
    const pluginError = new PluginError(PluginErrorCode.notFound, 'x');
    expect(isPluginError(pluginError)).toBe(true);
    expect(isPluginError(new Error('x'))).toBe(false);
    expect(isPluginError('string')).toBe(false);
    expect(asPluginError(pluginError)).toBe(pluginError);
    expect(asPluginError(new Error('x'))).toBeNull();
    expect(asPluginError(undefined)).toBeNull();
  });
});
