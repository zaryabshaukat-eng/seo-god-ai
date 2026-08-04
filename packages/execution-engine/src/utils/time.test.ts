import { describe, expect, it } from 'vitest';
import { availableAt, backoffDelay } from './time.js';

describe('time helpers', () => {
  it('backoffDelay doubles each attempt and caps at maxMs', () => {
    expect(backoffDelay(1, 250, 30_000)).toBe(250);
    expect(backoffDelay(2, 250, 30_000)).toBe(500);
    expect(backoffDelay(3, 250, 30_000)).toBe(1000);
    expect(backoffDelay(10, 250, 30_000)).toBe(30_000);
  });

  it('backoffDelay clamps bad base values and low attempts', () => {
    expect(backoffDelay(0, 250, 1000)).toBe(250);
    expect(backoffDelay(1, 0, 1000)).toBe(1);
    expect(backoffDelay(1, -5, 1000)).toBe(1);
    expect(backoffDelay(1, 9999, 500)).toBe(500);
  });

  it('availableAt clamps negative delays to zero', () => {
    expect(availableAt(100, 1_000)).toBe(1_100);
    expect(availableAt(0, 1_000)).toBe(1_000);
    expect(availableAt(-50, 1_000)).toBe(1_000);
  });
});
