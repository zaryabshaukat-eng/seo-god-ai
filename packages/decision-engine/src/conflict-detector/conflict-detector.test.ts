import { describe, expect, it } from 'vitest';
import { ORIGIN, task } from '../test/fixtures.js';
import { ConflictDetector } from './conflict-detector.js';

describe('ConflictDetector', () => {
  it('flags duplicate actions on the same resource', () => {
    const detector = new ConflictDetector();
    const keeper = task({ id: 'a', priority: 80 });
    const dup = task({ id: 'b', priority: 70 });
    const report = detector.detect([keeper, dup]);
    expect(report.excludedTaskIds).toEqual(['b']);
    expect(report.conflicts.some((conflict) => conflict.kind === 'duplicate')).toBe(true);
    expect(report.conflicts.find((conflict) => conflict.kind === 'duplicate')?.severity).toBe(
      'ERROR',
    );
  });

  it('excludes incompatible action pairs on the same resource', () => {
    const detector = new ConflictDetector();
    const del = task({ id: 'del', actionType: 'delete_page', priority: 90 });
    const upd = task({ id: 'upd', actionType: 'update_title', priority: 80 });
    const report = detector.detect([del, upd]);
    expect(report.excludedTaskIds).toEqual(['upd']);
    expect(report.conflicts.some((conflict) => conflict.kind === 'incompatible')).toBe(true);
  });

  it('keeps the higher-priority task as the survivor', () => {
    const detector = new ConflictDetector();
    const upd = task({ id: 'upd', actionType: 'update_title', priority: 70 });
    const del = task({ id: 'del', actionType: 'delete_page', priority: 90 });
    const report = detector.detect([upd, del]);
    expect(report.excludedTaskIds).toEqual(['upd']);
    expect(report.conflicts.find((conflict) => conflict.kind === 'incompatible')?.resolution).toContain(
      'keep del',
    );
  });

  it('excludes tasks that overwrite shared content fields', () => {
    const detector = new ConflictDetector();
    const a = task({ id: 'a', payload: { title: 'A', priority: 80 } });
    const b = task({ id: 'b', payload: { title: 'B', priority: 70 } });
    const report = detector.detect([a, b]);
    expect(report.excludedTaskIds).toEqual(['b']);
    expect(report.conflicts.some((conflict) => conflict.kind === 'overwrite')).toBe(true);
  });

  it('keeps the higher-priority task as the overwrite survivor', () => {
    const detector = new ConflictDetector();
    const low = task({ id: 'low', payload: { title: 'A' }, priority: 70 });
    const high = task({ id: 'high', payload: { title: 'B' }, priority: 90 });
    const report = detector.detect([low, high]);
    expect(report.excludedTaskIds).toEqual(['low']);
    expect(report.conflicts.find((conflict) => conflict.kind === 'overwrite')?.resolution).toContain(
      'Keep high',
    );
  });

  it('ignores planning metadata when checking overwrites', () => {
    const detector = new ConflictDetector();
    const a = task({ id: 'a', rule: 'missing-title', payload: { rule: 'missing-title' } });
    const b = task({ id: 'b', rule: 'thin-content', payload: { rule: 'thin-content' } });
    const report = detector.detect([a, b]);
    expect(report.excludedTaskIds).toEqual([]);
    expect(report.conflicts.some((conflict) => conflict.kind === 'overwrite')).toBe(false);
  });

  it('excludes mutually exclusive rules on the same resource', () => {
    const detector = new ConflictDetector();
    const remove = task({ id: 'r', rule: 'remove-duplicate-content', actionType: 'delete_page', priority: 90 });
    const merge = task({ id: 'm', rule: 'merge-duplicate-content', actionType: 'update_body', priority: 80 });
    const report = detector.detect([remove, merge]);
    expect(report.excludedTaskIds).toEqual(['m']);
    expect(report.conflicts.some((conflict) => conflict.kind === 'mutually_exclusive')).toBe(true);
  });

  it('keeps the higher-priority task as the exclusive survivor', () => {
    const detector = new ConflictDetector();
    const merge = task({ id: 'm', rule: 'merge-duplicate-content', actionType: 'update_body', priority: 80 });
    const remove = task({ id: 'r', rule: 'remove-duplicate-content', actionType: 'delete_page', priority: 90 });
    const report = detector.detect([merge, remove]);
    expect(report.excludedTaskIds).toEqual(['m']);
  });

  it('flags tasks derived from an older snapshot as stale', () => {
    const detector = new ConflictDetector();
    const stale = task({ id: 'stale', payload: { snapshotId: 'snap-1' } });
    const fresh = task({ id: 'fresh', payload: { snapshotId: 'snap-2' } });
    const report = detector.detect([stale, fresh], { latestSnapshotId: 'snap-2' });
    expect(report.flaggedTaskIds).toEqual(['stale']);
    expect(report.conflicts.find((conflict) => conflict.kind === 'stale')?.severity).toBe(
      'WARNING',
    );
  });

  it('does not flag stale without a latest snapshot reference', () => {
    const detector = new ConflictDetector();
    const report = detector.detect([task({ payload: { snapshotId: 'snap-1' } })]);
    expect(report.flaggedTaskIds).toEqual([]);
    expect(report.conflicts.some((conflict) => conflict.kind === 'stale')).toBe(false);
  });

  it('allows custom incompatible pairs and exclusive rules', () => {
    const detector = new ConflictDetector({
      incompatibleActions: [['update_title', 'update_robots']],
      mutuallyExclusiveRules: [['rule-a', 'rule-b']],
    });
    const a = task({ id: 'a', actionType: 'update_title', rule: 'rule-a', priority: 90 });
    const b = task({ id: 'b', actionType: 'update_robots', rule: 'rule-b', priority: 80 });
    const report = detector.detect([a, b]);
    expect(report.excludedTaskIds).toContain('b');
    expect(report.conflicts.some((conflict) => conflict.kind === 'incompatible')).toBe(true);
    expect(report.conflicts.some((conflict) => conflict.kind === 'mutually_exclusive')).toBe(true);
  });

  it('produces deterministic, sorted output', () => {
    const detector = new ConflictDetector();
    const tasks = [
      task({ id: 'z', payload: { title: 'Z' }, priority: 90 }),
      task({ id: 'a', payload: { title: 'A' }, priority: 80, resourceId: `${ORIGIN}/p/1` }),
      task({ id: 'dup', priority: 50 }),
    ];
    const report = detector.detect(tasks);
    expect(report.excludedTaskIds).toEqual(['a', 'dup']);
    expect(report.flaggedTaskIds).toEqual([]);
    const kinds = report.conflicts.map((conflict) => conflict.kind);
    expect([...kinds].sort()).toEqual(kinds);
  });

  it('sorts same-kind conflicts by involved task ids', () => {
    const detector = new ConflictDetector();
    const report = detector.detect([
      task({ id: 'keeper-a', priority: 90, resourceId: `${ORIGIN}/p/1` }),
      task({ id: 'dup-b', priority: 70, resourceId: `${ORIGIN}/p/1` }),
      task({ id: 'keeper-c', priority: 90, resourceId: `${ORIGIN}/p/2` }),
      task({ id: 'dup-a', priority: 60, resourceId: `${ORIGIN}/p/2` }),
    ]);
    const duplicates = report.conflicts.filter((conflict) => conflict.kind === 'duplicate');
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map((conflict) => conflict.involved.join('|'))).toEqual([
      'keeper-a|dup-b',
      'keeper-c|dup-a',
    ]);
  });
});
