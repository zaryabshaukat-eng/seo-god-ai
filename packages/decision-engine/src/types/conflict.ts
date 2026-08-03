/**
 * Conflict types. The conflict detector classifies issues between candidate
 * tasks so the planner can deterministically drop or annotate them.
 */

export type ConflictKind =
  | 'duplicate'
  | 'incompatible'
  | 'overwrite'
  | 'stale'
  | 'mutually_exclusive';

export type ConflictSeverity = 'ERROR' | 'WARNING';

export interface Conflict {
  kind: ConflictKind;
  severity: ConflictSeverity;
  description: string;
  /** Task (or recommendation) ids involved. */
  involved: string[];
  /** Deterministic suggested resolution. */
  resolution: string;
}

export interface ConflictReport {
  conflicts: Conflict[];
  /** Task ids that must be excluded from the plan (severity ERROR). */
  excludedTaskIds: string[];
  /** Task ids retained but flagged (severity WARNING). */
  flaggedTaskIds: string[];
}
