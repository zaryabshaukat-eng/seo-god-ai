import { describe, expect, it } from 'vitest';
import { ExecutionTimeoutError } from '../utils/errors.js';
import { withTimeout } from './timeout.js';

describe('withTimeout', () => {
  it('resolves when the promise settles first', async () => {
    const result = await withTimeout(Promise.resolve(42), 100, 'op');
    expect(result).toBe(42);
  });

  it('rejects with ExecutionTimeoutError when the timer wins', async () => {
    const slow = new Promise<number>((resolve) => {
      setTimeout(() => resolve(1), 200);
    });
    await expect(withTimeout(slow, 10, 'slow-op')).rejects.toThrow(ExecutionTimeoutError);
  });

  it('propagates the underlying rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 100, 'op')).rejects.toThrow('boom');
  });

  it('runs without a timer for non-positive or non-finite timeouts', async () => {
    await expect(withTimeout(Promise.resolve(1), 0, 'op')).resolves.toBe(1);
    await expect(withTimeout(Promise.resolve(1), -5, 'op')).resolves.toBe(1);
    await expect(withTimeout(Promise.resolve(1), Number.NaN, 'op')).resolves.toBe(1);
    await expect(withTimeout(Promise.resolve(1), Number.POSITIVE_INFINITY, 'op')).resolves.toBe(1);
  });
});
