import type { KillSwitchState } from '../types/safety.js';

/**
 * Global + per-store kill switch. Stopping globally freezes every write;
 * stopping a single store freezes only that store's executions.
 */
export class KillSwitch {
  private global = false;
  private readonly stores = new Map<string, boolean>();

  stop(storeId?: string): void {
    if (storeId === undefined || storeId === '') {
      this.global = true;
    } else {
      this.stores.set(storeId, true);
    }
  }

  stopAll(): void {
    this.global = true;
  }

  resume(storeId?: string): void {
    if (storeId === undefined || storeId === '') {
      this.global = false;
    } else {
      this.stores.delete(storeId);
    }
  }

  resumeAll(): void {
    this.global = false;
    this.stores.clear();
  }

  isStopped(storeId: string): boolean {
    return this.global || (this.stores.get(storeId) ?? false);
  }

  state(): KillSwitchState {
    return { global: this.global, stores: Object.fromEntries(this.stores) };
  }
}
