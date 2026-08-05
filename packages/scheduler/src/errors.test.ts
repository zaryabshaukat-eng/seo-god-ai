import { describe, expect, it } from 'vitest';
import { ErrorCodes, isAppError } from '@seogod/core';
import {
  CronValidationError,
  JobRunningError,
  JobTimeoutError,
  LockAcquireError,
  MissingHandlerError,
  SchedulerConflictError,
  SchedulerError,
  SchedulerNotFoundError,
  SchedulerValidationError,
} from './errors.js';

describe('scheduler errors', () => {
  it('are all AppErrors with stable codes and modules', () => {
    const samples = [
      { error: new CronValidationError('bad cron'), code: 'cron.invalid' },
      { error: new JobTimeoutError('slow', { jobId: 'j' }, 100), code: 'job.timeout' },
      { error: new LockAcquireError('no lock'), code: 'lock.acquire' },
      { error: new JobRunningError('already running'), code: 'job.running' },
      { error: new MissingHandlerError('no handler'), code: 'handler.missing' },
      { error: new SchedulerError('generic', { code: 'lock.acquire' }), code: 'lock.acquire' },
    ];
    for (const { error, code } of samples) {
      expect(isAppError(error)).toBe(true);
      expect(error.code).toBe(code);
      expect(error.toJSON().code).toBe(code);
    }
  });

  it('JobTimeoutError exposes the timeout in milliseconds', () => {
    const error = new JobTimeoutError('slow', { jobId: 'j' }, 250);
    expect(error.timeoutMs).toBe(250);
  });

  it('SchedulerNotFoundError maps to the platform not_found code', () => {
    const error = new SchedulerNotFoundError('missing job');
    expect(error.code).toBe(ErrorCodes.notFound);
    expect(error.module).toBe('scheduler');
  });

  it('SchedulerValidationError maps to the platform validation code', () => {
    const error = new SchedulerValidationError('bad input', { jobId: 'j' });
    expect(error.code).toBe(ErrorCodes.validation);
    expect(error.context).toEqual({ jobId: 'j' });
  });

  it('SchedulerConflictError maps to the platform conflict code', () => {
    const error = new SchedulerConflictError('conflict');
    expect(error.code).toBe(ErrorCodes.conflict);
  });

  it('carries structured context through serialization', () => {
    const error = new SchedulerError('nope', {
      code: 'handler.missing',
      context: { jobId: 'j-1', attempt: 2 },
      cause: new Error('inner'),
    });
    const serialized = error.toJSON();
    expect(serialized.context).toEqual({ jobId: 'j-1', attempt: 2 });
    expect(serialized.name).toBe('SchedulerError');
    expect(serialized.timestamp).toBeDefined();
  });
});
