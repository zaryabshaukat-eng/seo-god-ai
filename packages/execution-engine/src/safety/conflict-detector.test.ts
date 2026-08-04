import { describe, expect, it } from 'vitest';
import type { Execution } from '../types/execution.js';
import { buildExecution, buildStep } from '../models/execution.js';
import { detectConflicts, isActiveStatus } from './conflict-detector.js';

function makeExecution(id: string, storeId: string, status: string): Execution {
  const steps = [buildStep({ executionId: id, batchId: 'b', storeId, actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: {}, order: 0 })];
  const execution = buildExecution({ id, storeId, mode: 'PRODUCTION', source: 'actions', steps, batches: [] });
  execution.status = status as Execution['status'];
  return execution;
}

describe('conflict detector', () => {
  it('isActiveStatus recognizes running lifecycle states', () => {
    expect(isActiveStatus('PENDING')).toBe(true);
    expect(isActiveStatus('VALIDATING')).toBe(true);
    expect(isActiveStatus('QUEUED')).toBe(true);
    expect(isActiveStatus('EXECUTING')).toBe(true);
    expect(isActiveStatus('COMPLETED')).toBe(false);
    expect(isActiveStatus('FAILED')).toBe(false);
    expect(isActiveStatus('CANCELLED')).toBe(false);
  });

  it('detectConflicts ignores self, other stores and finished executions', () => {
    const candidate = makeExecution('exec-1', 's1', 'EXECUTING');
    const active = [
      candidate,
      makeExecution('exec-2', 's1', 'EXECUTING'),
      makeExecution('exec-3', 's1', 'PENDING'),
      makeExecution('exec-4', 's1', 'COMPLETED'),
      makeExecution('exec-5', 's2', 'EXECUTING'),
    ];
    const conflicts = detectConflicts(candidate, active);
    expect(conflicts.map((c) => c.id)).toEqual(['exec-2', 'exec-3']);
  });

  it('returns no conflicts for an empty active list', () => {
    const candidate = makeExecution('exec-1', 's1', 'EXECUTING');
    expect(detectConflicts(candidate, [])).toEqual([]);
  });
});
