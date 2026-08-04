/**
 * Execution diff types. Every executed step exposes a before/after diff that
 * carries the entity identifier, changed fields, a machine-readable field
 * list and a human-readable summary.
 */

export type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface FieldDiff {
  /** Dotted path of the changed field, e.g. `seo.title`. */
  field: string;
  kind: DiffKind;
  previous: unknown;
  next: unknown;
}

export interface ExecutionDiff {
  id: string;
  executionId: string;
  stepId: string;
  storeId: string;
  resourceType: string;
  resourceId: string;
  actionType: string;
  /** Stable business key of the entity the diff refers to. */
  entityId: string;
  /** Changed fields (dotted paths). */
  changedFields: string[];
  /** Machine-readable change list. */
  changes: FieldDiff[];
  /** Human-readable summary. */
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  hasChanges: boolean;
  createdAt: Date;
}
