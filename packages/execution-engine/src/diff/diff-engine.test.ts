import { describe, expect, it } from 'vitest';
import {
  applyDiff,
  buildExecutionDiff,
  changedFields,
  computeDiff,
  deepEqual,
  formatValue,
  hasChanges,
  summarizeChanges,
} from './diff-engine.js';

describe('diff engine', () => {
  it('deepEqual compares primitives, objects and arrays', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [1, 3])).toBe(false);
    expect(deepEqual([1], [1, 2])).toBe(false);
    expect(deepEqual({ a: [1] }, { a: [2] })).toBe(false);
  });

  it('computeDiff reports added, removed and changed fields', () => {
    const before = { title: 'Old', description: 'Keep', seo: { title: 'Old seo' }, tags: ['a'] };
    const after = { title: 'New', seo: { title: 'New seo', focus: 'x' }, tags: ['a'], newField: 1 };
    const changes = computeDiff(before, after);
    const byField = new Map(changes.map((c) => [c.field, c]));
    expect(byField.get('title')?.kind).toBe('changed');
    expect(byField.get('description')?.kind).toBe('removed');
    expect(byField.get('seo.title')?.kind).toBe('changed');
    expect(byField.get('seo.focus')?.kind).toBe('added');
    expect(byField.get('newField')?.kind).toBe('added');
    expect(byField.has('tags')).toBe(false);
    expect(hasChanges(changes)).toBe(true);
    expect(changedFields(changes)).toContain('title');
  });

  it('computeDiff returns empty for identical states and null inputs', () => {
    expect(computeDiff(null, null)).toEqual([]);
    expect(computeDiff({ a: 1 }, { a: 1 })).toEqual([]);
    expect(hasChanges([])).toBe(false);
  });

  it('applyDiff reconstructs the after state', () => {
    const before = { title: 'Old', seo: { title: 'Old seo' }, keep: true };
    const changes = computeDiff(before, { title: 'New', seo: { focus: 'x' }, keep: true });
    const after = applyDiff(before, changes) as { title: string; seo: { focus?: string; title?: string }; keep: boolean };
    expect(after.title).toBe('New');
    expect(after.seo.focus).toBe('x');
    expect(after.seo.title).toBeUndefined();
    expect(after.keep).toBe(true);
    expect(before.seo.title).toBe('Old seo');
  });

  it('applyDiff creates nested paths and handles removal of missing paths', () => {
    const after = applyDiff({}, [{ field: 'a.b.c', kind: 'added', previous: undefined, next: 42 }]) as { a: { b: { c: number } } };
    expect(after.a.b.c).toBe(42);
    const removed = applyDiff({ a: { b: 1 } }, [{ field: 'a.b', kind: 'removed', previous: 1, next: undefined }]) as { a: { b?: number } };
    expect(removed.a.b).toBeUndefined();
    const noop = applyDiff({ a: { b: 1 } }, [{ field: 'missing.path', kind: 'removed', previous: 1, next: undefined }]) as { a: { b: number } };
    expect(noop.a.b).toBe(1);
  });

  it('formatValue handles all shapes', () => {
    expect(formatValue(undefined)).toBe('<undefined>');
    expect(formatValue(null)).toBe('null');
    expect(formatValue(42)).toBe('42');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue('short')).toBe('"short"');
    expect(formatValue('x'.repeat(100))).toContain('...');
  });

  it('summarizeChanges handles zero, one and many changes', () => {
    expect(summarizeChanges([])).toBe('no changes');
    expect(summarizeChanges([{ field: 'title', kind: 'changed', previous: 'a', next: 'b' }])).toBe('title changed: "a" -> "b"');
    const many = summarizeChanges([
      { field: 'a', kind: 'added', previous: undefined, next: 1 },
      { field: 'b', kind: 'removed', previous: 1, next: undefined },
    ]);
    expect(many).toContain('2 changed fields');
    expect(many).toContain('a, b');
  });

  it('buildExecutionDiff produces a complete record', () => {
    const diff = buildExecutionDiff({
      id: 'diff-1',
      executionId: 'exec-1',
      stepId: 'step-1',
      storeId: 'store-1',
      resourceType: 'product',
      resourceId: 'p1',
      actionType: 'update_title',
      entityId: 'p1',
      before: { title: 'A' },
      after: { title: 'B' },
    });
    expect(diff.id).toBe('diff-1');
    expect(diff.hasChanges).toBe(true);
    expect(diff.changedFields).toEqual(['title']);
    expect(diff.summary).toContain('title');
    const empty = buildExecutionDiff({
      id: 'diff-2',
      executionId: 'e',
      stepId: 's',
      storeId: 'st',
      resourceType: 'page',
      resourceId: 'p',
      actionType: 'update_title',
      entityId: 'p',
      before: null,
      after: null,
    });
    expect(empty.hasChanges).toBe(false);
    expect(empty.before).toEqual({});
  });
});
