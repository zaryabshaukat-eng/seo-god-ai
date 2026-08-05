import { describe, expect, it } from 'vitest';
import { MemoryDistributedLock } from './lock.js';

describe('MemoryDistributedLock', () => {
  it('acquires a lock and reports expiry', async () => {
    const lock = new MemoryDistributedLock();
    const result = await lock.acquire('job:1', 'owner-a', 1000);
    expect(result.acquired).toBe(true);
    expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await lock.isHeld('job:1')).toBe(true);
  });

  it('refuses a second owner while the lock is held', async () => {
    const lock = new MemoryDistributedLock();
    await lock.acquire('job:1', 'owner-a', 1000);
    const second = await lock.acquire('job:1', 'owner-b', 1000);
    expect(second.acquired).toBe(false);
  });

  it('allows the same owner to re-acquire (renew)', async () => {
    const lock = new MemoryDistributedLock();
    await lock.acquire('job:1', 'owner-a', 1000);
    const again = await lock.acquire('job:1', 'owner-a', 5000);
    expect(again.acquired).toBe(true);
  });

  it('expires the lock after the ttl', async () => {
    const clock = new Date('2026-01-05T10:00:00.000Z');
    const lock = new MemoryDistributedLock(() => clock);
    await lock.acquire('job:1', 'owner-a', 1000);
    clock.setTime(clock.getTime() + 2000);
    const second = await lock.acquire('job:1', 'owner-b', 1000);
    expect(second.acquired).toBe(true);
  });

  it('takes over an expired lock held by another owner', async () => {
    const clock = new Date('2026-01-05T10:00:00.000Z');
    const lock = new MemoryDistributedLock(() => clock);
    await lock.acquire('job:1', 'owner-a', 1000);
    clock.setTime(clock.getTime() + 2000);
    const result = await lock.acquire('job:1', 'owner-b', 1000);
    expect(result.acquired).toBe(true);
    expect(result.expiresAt!.getTime()).toBe(clock.getTime() + 1000);
  });

  it('releases a lock for the owning instance only', async () => {
    const lock = new MemoryDistributedLock();
    await lock.acquire('job:1', 'owner-a', 1000);
    expect(await lock.release('job:1', 'owner-b')).toBe(false);
    expect(await lock.release('job:1', 'owner-a')).toBe(true);
    expect(await lock.isHeld('job:1')).toBe(false);
  });

  it('returns false when releasing a lock that does not exist', async () => {
    const lock = new MemoryDistributedLock();
    expect(await lock.release('job:1', 'owner-a')).toBe(false);
  });

  it('reports an expired lock as not held and cleans it up', async () => {
    const clock = new Date('2026-01-05T10:00:00.000Z');
    const lock = new MemoryDistributedLock(() => clock);
    await lock.acquire('job:1', 'owner-a', 1000);
    clock.setTime(clock.getTime() + 2000);
    expect(await lock.isHeld('job:1')).toBe(false);
    // A subsequent acquire is uncontended.
    const result = await lock.acquire('job:1', 'owner-b', 1000);
    expect(result.acquired).toBe(true);
  });
});
