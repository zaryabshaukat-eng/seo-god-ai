import { describe, expect, it } from 'vitest';
import { InvalidExecutionError, UnsupportedExecutionError } from '../utils/errors.js';
import { OperationRegistryImpl, operationKey } from './operation-registry.js';
import { buildOperation } from './operations.js';

describe('operation registry', () => {
  it('operationKey is stable', () => {
    expect(operationKey('update_title', 'product')).toBe('product.update_title');
  });

  it('registers and lists default operations', () => {
    const registry = new OperationRegistryImpl();
    expect(registry.list().length).toBeGreaterThan(0);
    expect(registry.has('update_title', 'product')).toBe(true);
  });

  it('rejects duplicate registration', () => {
    const registry = new OperationRegistryImpl([]);
    registry.register(buildOperation('update_title', 'product'));
    expect(() => registry.register(buildOperation('update_title', 'product'))).toThrow(InvalidExecutionError);
  });

  it('get throws for unknown operations and returns known ones', () => {
    const registry = new OperationRegistryImpl([]);
    expect(() => registry.get('nope', 'store')).toThrow(UnsupportedExecutionError);
    const operation = buildOperation('update_blog', 'blog');
    registry.register(operation);
    expect(registry.get('update_blog', 'blog')).toBe(operation);
  });
});
