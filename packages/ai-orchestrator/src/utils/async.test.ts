import { describe, expect, it, vi } from 'vitest';
import { CancelledError, TimeoutError } from '../errors.js';
import { isAborted, withTimeout } from './async.js';

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100)).resolves.toBe('ok');
  });

  it('rejects with TimeoutError when the deadline passes', async () => {
    await expect(
      withTimeout(new Promise((resolve) => setTimeout(resolve, 20)), 1),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('does not apply a timeout when ms is 0 or negative', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 0)).resolves.toBe('ok');
    await expect(withTimeout(Promise.resolve('ok'), -1)).resolves.toBe('ok');
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withTimeout(new Promise(() => undefined), 1000, controller.signal),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it('rejects with CancelledError when the signal aborts mid-flight', async () => {
    const controller = new AbortController();
    const pending = new Promise<string>(() => undefined);
    const promise = withTimeout(pending, 1000, controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(promise).rejects.toBeInstanceOf(CancelledError);
  });

  it('propagates the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 100)).rejects.toThrow('boom');
  });

  it('clears the timer when the signal aborts (no later timeout)', async () => {
    const controller = new AbortController();
    const pending = new Promise<string>(() => undefined);
    const promise = withTimeout(pending, 10, controller.signal);
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(CancelledError);
    await new Promise((resolve) => setTimeout(resolve, 20));
    vi.clearAllTimers();
  });
});

describe('isAborted', () => {
  it('returns the aborted state and false for undefined', () => {
    expect(isAborted(undefined)).toBe(false);
    const controller = new AbortController();
    expect(isAborted(controller.signal)).toBe(false);
    controller.abort();
    expect(isAborted(controller.signal)).toBe(true);
  });
});
