/**
 * Sync-state repository.
 *
 * Incremental sync needs a place to persist the last cursor per
 * `provider:resource`. The interface below is the seam a production
 * (database-backed) implementation plugs into; the package ships an
 * in-memory one for tests and development.
 */

import type { GoogleProvider } from './types.js';

export type SyncStateStatus = 'SYNCED' | 'FAILED';

export interface SyncState {
  provider: GoogleProvider;
  /** Data resource being synced (site URL, property id, page URL, ...). */
  resource: string;
  /** Last successful checkpoint (ISO date or timestamp). */
  cursor: string;
  /** ISO timestamp of the last run. */
  lastSyncedAt: string;
  status: SyncStateStatus;
  error?: string;
}

export interface GoogleSyncRepository {
  saveState(state: SyncState): Promise<void>;
  getState(provider: GoogleProvider, resource: string): Promise<SyncState | null>;
  listStates(provider?: GoogleProvider): Promise<SyncState[]>;
  deleteState(provider: GoogleProvider, resource: string): Promise<void>;
}

/** In-memory sync-state repository. Useful for tests and development. */
export class MemoryGoogleSyncRepository implements GoogleSyncRepository {
  private readonly store = new Map<string, SyncState>();

  async saveState(state: SyncState): Promise<void> {
    this.store.set(stateKey(state.provider, state.resource), { ...state });
  }

  async getState(provider: GoogleProvider, resource: string): Promise<SyncState | null> {
    const state = this.store.get(stateKey(provider, resource));
    return state ? { ...state } : null;
  }

  async listStates(provider?: GoogleProvider): Promise<SyncState[]> {
    return [...this.store.values()]
      .filter((state) => provider === undefined || state.provider === provider)
      .map((state) => ({ ...state }));
  }

  async deleteState(provider: GoogleProvider, resource: string): Promise<void> {
    this.store.delete(stateKey(provider, resource));
  }
}

function stateKey(provider: GoogleProvider, resource: string): string {
  return `${provider}:${resource.trim()}`;
}
