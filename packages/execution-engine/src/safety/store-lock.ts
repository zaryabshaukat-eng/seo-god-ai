import type { StoreLockState } from '../types/safety.js';

/** Exclusive per-store write lock. One execution owns a store at a time. */
export class StoreLock {
  private readonly locks = new Map<string, string>();

  /** Returns true when the lock was acquired for `executionId`. */
  acquire(storeId: string, executionId: string): boolean {
    if (this.locks.has(storeId)) return false;
    this.locks.set(storeId, executionId);
    return true;
  }

  isLocked(storeId: string): boolean {
    return this.locks.has(storeId);
  }

  /** The execution id currently holding the store's lock, or null. */
  owner(storeId: string): string | null {
    return this.locks.get(storeId) ?? null;
  }

  release(storeId: string): boolean {
    return this.locks.delete(storeId);
  }

  /** Releases the lock only when `executionId` still holds it. */
  releaseIfOwner(storeId: string, executionId: string): boolean {
    if (this.locks.get(storeId) !== executionId) return false;
    return this.locks.delete(storeId);
  }

  state(): StoreLockState {
    return { locks: Object.fromEntries(this.locks) };
  }

  activeStores(): string[] {
    return [...this.locks.keys()];
  }
}
