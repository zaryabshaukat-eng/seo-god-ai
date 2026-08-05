import { describe, expect, it, vi } from 'vitest';
import { EventBusPublisher, SCHEDULER_EVENT_TYPES } from './events.js';
import type { SchedulerEventInput } from './events.js';

describe('SCHEDULER_EVENT_TYPES', () => {
  it('contains the full job lifecycle', () => {
    expect(SCHEDULER_EVENT_TYPES).toEqual([
      'scheduler.job.scheduled',
      'scheduler.job.updated',
      'scheduler.job.cancelled',
      'scheduler.job.started',
      'scheduler.job.succeeded',
      'scheduler.job.failed',
      'scheduler.job.retrying',
      'scheduler.job.skipped',
    ]);
  });
});

describe('EventBusPublisher', () => {
  it('publishes the scheduler event shape', async () => {
    const publish = vi.fn().mockResolvedValue({ id: 'event-1' });
    const publisher = new EventBusPublisher({ publish });
    await publisher.publish({
      type: 'scheduler.job.succeeded',
      jobId: 'job-1',
      kind: 'crawl',
      name: 'crawl-store',
      priority: 'high',
      storeId: 'store-1',
      attempt: 2,
      runId: 'run-1',
    });
    expect(publish).toHaveBeenCalledWith({
      type: 'scheduler.job.succeeded',
      aggregateType: 'schedulerJob',
      aggregateId: 'job-1',
      payload: expect.objectContaining({
        kind: 'crawl',
        name: 'crawl-store',
        priority: 'high',
        storeId: 'store-1',
        attempt: 2,
        runId: 'run-1',
      }),
    });
  });

  it('omits optional fields when absent', async () => {
    const publish = vi.fn().mockResolvedValue({ id: 'event-1' });
    const publisher = new EventBusPublisher({ publish });
    const input: SchedulerEventInput = {
      type: 'scheduler.job.started',
      jobId: 'job-1',
      kind: 'execution',
      name: 'run-plan',
      priority: 'normal',
      storeId: null,
    };
    await publisher.publish(input);
    const payload = publish.mock.calls[0]![0].payload as Record<string, unknown>;
    expect(payload).toEqual({
      kind: 'execution',
      name: 'run-plan',
      priority: 'normal',
      storeId: null,
    });
    expect('attempt' in payload).toBe(false);
    expect('error' in payload).toBe(false);
    expect('reason' in payload).toBe(false);
    expect('payload' in payload).toBe(false);
  });

  it('merges error, reason and nested payload fields', async () => {
    const publish = vi.fn().mockResolvedValue({ id: 'event-1' });
    const publisher = new EventBusPublisher({ publish });
    await publisher.publish({
      type: 'scheduler.job.failed',
      jobId: 'job-1',
      kind: 'crawl',
      name: 'crawl-store',
      priority: 'low',
      storeId: 'store-1',
      error: 'boom',
      reason: 'handler.missing',
      payload: { seeds: ['https://x.example'] },
    });
    const payload = publish.mock.calls[0]![0].payload as Record<string, unknown>;
    expect(payload.error).toBe('boom');
    expect(payload.reason).toBe('handler.missing');
    expect(payload.payload).toEqual({ seeds: ['https://x.example'] });
  });
});
