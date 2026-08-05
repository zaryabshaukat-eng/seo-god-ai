/**
 * Distributed lock abstraction used to guarantee a job runs on exactly one
 * scheduler instance at a time.
 *
 * The interface stays small (acquire / release / isHeld) so a production
 * deployment can back it with Postgres advisory locks or Redis while tests
 * and single-process setups use the memory implementation.
 */

export interface LockAcquireResult {
  acquired: boolean;
  expiresAt: Date | null;
}

export interface DistributedLock {
  /**
   * Attempts to acquire `key` for `owner` for `ttlMs`. Returns `acquired:
   * false` (never throws) when another owner holds the lock.
   */
  acquire(key: string, owner: string, ttlMs: number): Promise<LockAcquireResult>;
  /** Releases the lock; `false` when the owner no longer holds it. */
  release(key: string, owner: string): Promise<boolean>;
  isHeld(key: string): Promise<boolean>;
}

interface LockEntry {
  owner: string;
  expiresAt: number;
}

/**
 * In-process {@link DistributedLock}. Safe for a single scheduler instance;
 * the ownership + expiry bookkeeping mirrors what a real store would do.
 */
export class MemoryDistributedLock implements DistributedLock {
  private readonly entries = new Map<string, LockEntry>();
  private readonly now: () => number;

  constructor(now: () => Date = () => new Date()) {
    this.now = () => now().getTime();
  }

  async acquire(key: string, owner: string, ttlMs: number): Promise<LockAcquireResult> {
    const current = this.entries.get(key);
    const time = this.now();
    if (current !== undefined && current.expiresAt > time && current.owner !== owner) {
      return { acquired: false, expiresAt: new Date(current.expiresAt) };
    }
    const expiresAt = time + ttlMs;
    this.entries.set(key, { owner, expiresAt });
    return { acquired: true, expiresAt: new Date(expiresAt) };
  }

  async release(key: string, owner: string): Promise<boolean> {
    const current = this.entries.get(key);
    if (current === undefined || current.owner !== owner) return false;
    this.entries.delete(key);
    return true;
  }

  async isHeld(key: string): Promise<boolean> {
    const current = this.entries.get(key);
    if (current === undefined) return false;
    if (current.expiresAt <= this.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }
}
