import { describe, expect, it } from 'vitest';
import { StoreLock } from './store-lock.js';

describe('store lock', () => {
  it('acquire is exclusive per store', () => {
    const lock = new StoreLock();
    expect(lock.acquire('s1', 'exec-1')).toBe(true);
    expect(lock.acquire('s1', 'exec-2')).toBe(false);
    expect(lock.acquire('s2', 'exec-2')).toBe(true);
    expect(lock.isLocked('s1')).toBe(true);
    expect(lock.owner('s1')).toBe('exec-1');
    expect(lock.activeStores()).toEqual(['s1', 's2']);
  });

  it('release frees the store for another owner', () => {
    const lock = new StoreLock();
    lock.acquire('s1', 'exec-1');
    expect(lock.release('s1')).toBe(true);
    expect(lock.acquire('s1', 'exec-2')).toBe(true);
    expect(lock.release('s1')).toBe(true);
    expect(lock.release('s1')).toBe(false);
  });

  it('releaseIfOwner only releases for the current owner', () => {
    const lock = new StoreLock();
    lock.acquire('s1', 'exec-1');
    expect(lock.releaseIfOwner('s1', 'exec-2')).toBe(false);
    expect(lock.isLocked('s1')).toBe(true);
    expect(lock.releaseIfOwner('s1', 'exec-1')).toBe(true);
    expect(lock.isLocked('s1')).toBe(false);
    expect(lock.releaseIfOwner('s1', 'exec-1')).toBe(false);
  });

  it('state exposes the lock map', () => {
    const lock = new StoreLock();
    lock.acquire('s1', 'exec-1');
    expect(lock.state()).toEqual({ locks: { s1: 'exec-1' } });
  });
});
