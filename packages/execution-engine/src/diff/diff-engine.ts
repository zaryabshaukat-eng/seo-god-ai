import type { DiffKind, ExecutionDiff, FieldDiff } from '../types/diff.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  return false;
}

function walk(field: string, prev: unknown, next: unknown, out: FieldDiff[]): void {
  if (deepEqual(prev, next)) return;
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const key of keys) {
      walk(field === '' ? key : `${field}.${key}`, prev[key], next[key], out);
    }
    return;
  }
  const kind: DiffKind = prev === undefined ? 'added' : next === undefined ? 'removed' : 'changed';
  out.push({ field, kind, previous: prev, next });
}

/** Computes the flattened, machine-readable diff between two states. */
export function computeDiff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): FieldDiff[] {
  const changes: FieldDiff[] = [];
  const prev = before ?? {};
  const next = after ?? {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    walk(key, prev[key], next[key], changes);
  }
  return changes;
}

export function hasChanges(changes: FieldDiff[]): boolean {
  return changes.length > 0;
}

/** Returns the dotted paths of every non-unchanged field. */
export function changedFields(changes: FieldDiff[]): string[] {
  return changes.map((change) => change.field);
}

/** Reconstructs the after state by applying changes onto the before state. */
export function applyDiff(before: Record<string, unknown>, changes: FieldDiff[]): Record<string, unknown> {
  const base = structuredClone(before);
  for (const change of changes) {
    if (change.kind === 'removed') {
      deletePath(base, change.field);
    } else {
      setPath(base, change.field, change.next);
    }
  }
  return base;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i] as string;
    const next = cursor[key];
    if (!isPlainObject(next)) {
      const created: Record<string, unknown> = {};
      cursor[key] = created;
      cursor = created;
    } else {
      cursor = next;
    }
  }
  cursor[parts[parts.length - 1] as string] = value;
}

function deletePath(target: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i] as string;
    if (!isPlainObject(cursor[key])) return;
    cursor = cursor[key] as Record<string, unknown>;
  }
  delete cursor[parts[parts.length - 1] as string];
}

/** Formats a single value for human-readable output. */
export function formatValue(value: unknown): string {
  if (value === undefined) return '<undefined>';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    const trimmed = value.length > 48 ? `${value.slice(0, 48)}...` : value;
    return JSON.stringify(trimmed);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function summarizeChanges(changes: FieldDiff[]): string {
  if (changes.length === 0) return 'no changes';
  if (changes.length === 1) {
    const change = changes[0] as FieldDiff;
    return `${change.field} ${change.kind}: ${formatValue(change.previous)} -> ${formatValue(change.next)}`;
  }
  return `${changes.length} changed fields: ${changes.map((c) => c.field).join(', ')}`;
}

export function buildExecutionDiff(input: {
  id: string;
  executionId: string;
  stepId: string;
  storeId: string;
  resourceType: string;
  resourceId: string;
  actionType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}): ExecutionDiff {
  const changes = computeDiff(input.before, input.after);
  return {
    id: input.id,
    executionId: input.executionId,
    stepId: input.stepId,
    storeId: input.storeId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    actionType: input.actionType,
    entityId: input.entityId,
    changedFields: changedFields(changes),
    changes,
    summary: summarizeChanges(changes),
    before: input.before ?? {},
    after: input.after ?? {},
    hasChanges: hasChanges(changes),
    createdAt: new Date(),
  };
}
