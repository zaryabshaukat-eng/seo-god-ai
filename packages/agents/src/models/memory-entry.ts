import type { MemoryEntry } from '../types/memory.js';
import { newId } from '../utils/ids.js';

/** Deterministic construction of a memory entry. */
export const MemoryEntryModel = {
  build(
    input: Omit<MemoryEntry, 'id' | 'createdAt'>,
    now: () => Date = () => new Date(),
  ): MemoryEntry {
    return { ...input, id: newId(), createdAt: now() };
  },
};
