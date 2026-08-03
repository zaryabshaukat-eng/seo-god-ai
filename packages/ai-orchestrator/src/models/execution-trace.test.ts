import { describe, expect, it } from 'vitest';
import { ExecutionTraceModel } from './execution-trace.js';

describe('ExecutionTraceModel', () => {
  it('derives a stable trace id from the execution id', () => {
    expect(ExecutionTraceModel.idFor('exec-1')).toBe(ExecutionTraceModel.idFor('exec-1'));
    expect(ExecutionTraceModel.idFor('exec-1')).not.toBe(ExecutionTraceModel.idFor('exec-2'));
  });

  it('creates an empty trace', () => {
    const trace = ExecutionTraceModel.create('exec-1');
    expect(trace.executionId).toBe('exec-1');
    expect(trace.events).toEqual([]);
  });

  it('appends events with optional fields and timestamps', () => {
    const now = () => new Date('2026-01-01T00:00:00Z');
    let trace = ExecutionTraceModel.create('exec-1');
    trace = ExecutionTraceModel.append(trace, { executionId: 'exec-1', type: 'started', data: { a: 1 } }, now);
    trace = ExecutionTraceModel.append(trace, { executionId: 'exec-1', type: 'agent.started', stepId: 's1', attempt: 2 }, now);
    expect(trace.events).toHaveLength(2);
    expect(trace.events[0]?.type).toBe('started');
    expect(trace.events[0]?.data).toEqual({ a: 1 });
    expect(trace.events[1]?.stepId).toBe('s1');
    expect(trace.events[1]?.attempt).toBe(2);
    expect(trace.events[1]?.at).toEqual(now());
  });

  it('appends events with the default clock', () => {
    const trace = ExecutionTraceModel.append(ExecutionTraceModel.create('exec-1'), {
      executionId: 'exec-1',
      type: 'started',
    });
    expect(trace.events[0]?.at).toBeInstanceOf(Date);
  });
});
