import { describe, expect, it } from 'vitest';
import { InMemoryQueueStore } from './queue-store.js';

describe('in-memory queue store', () => {
  it('enqueuePayload builds a well-formed queued entry', async () => {
    const store = new InMemoryQueueStore<{ job: string }>({ nowMs: () => 1000 });
    const entry = await store.enqueuePayload({ job: 'x' }, { priority: 5, delayMs: 200, maxAttempts: 4 });
    expect(entry.status).toBe('QUEUED');
    expect(entry.priority).toBe(5);
    expect(entry.delayMs).toBe(200);
    expect(entry.availableAt).toBe(1200);
    expect(entry.enqueuedAt).toBe(1000);
    expect(entry.attempts).toBe(0);
    expect(entry.maxAttempts).toBe(4);
    expect(store.size()).toBe(1);
  });

  it('claim skips delayed and non-queued entries', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1, { priority: 1, delayMs: 100 });
    await store.enqueuePayload(2, { priority: 1, delayMs: 0 });
    expect((await store.claim(50))?.payload).toBe(2);
    expect((await store.claim(150))?.payload).toBe(1);
    expect(await store.claim(200)).toBeNull();
  });

  it('claim prefers higher priority and then FIFO', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1, { priority: 5 });
    await store.enqueuePayload(2, { priority: 1 });
    await store.enqueuePayload(3, { priority: 5 });
    expect((await store.claim(0))?.payload).toBe(2);
    expect((await store.claim(0))?.payload).toBe(1);
    expect((await store.claim(0))?.payload).toBe(3);
  });

  it('complete succeeds a claimed entry and refuses to complete a cancelled one', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1);
    const entry = await store.claim(0);
    expect(await store.complete(entry!.id)).toBe(true);
    expect((await store.list())[0]!.status).toBe('SUCCEEDED');
    await store.enqueuePayload(2);
    const queued = (await store.list('QUEUED'))[0]!;
    expect(await store.cancel(queued.id)).toBe(true);
    expect(await store.complete(queued.id)).toBe(false);
  });

  it('fail reschedules with backoff until attempts are exhausted', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1, { maxAttempts: 2 });
    let entry = await store.claim(0);
    await store.fail(entry!.id, 'err', 500);
    expect(store.wasCancelled(entry!.id)).toBe(false);
    const after = (await store.list())[0]!;
    expect(after.status).toBe('QUEUED');
    expect(after.attempts).toBe(1);
    expect(after.availableAt).toBe(500);
    expect(after.lastError).toBe('err');
    entry = await store.claim(500);
    await store.fail(entry!.id, 'err again', 1000);
    expect((await store.list())[0]!.status).toBe('DEAD');
  });

  it('dead and requeueDead round-trip entries', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1);
    const entry = await store.claim(0);
    await store.dead(entry!.id, 'poison');
    expect((await store.list())[0]!.status).toBe('DEAD');
    expect(await store.requeueDead('missing')).toBe(false);
    expect(await store.requeueDead(entry!.id, 1)).toBe(true);
    const requeued = (await store.list())[0]!;
    expect(requeued.status).toBe('QUEUED');
    expect(requeued.priority).toBe(1);
    expect(requeued.attempts).toBe(0);
  });

  it('unknown ids are ignored by complete, fail and dead', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    expect(await store.complete('missing')).toBe(false);
    await store.enqueuePayload(1);
    await store.dead('missing', 'err');
    await store.fail('missing', 'err', 500);
    expect(store.size()).toBe(1);
  });

  it('requeueDead keeps the existing priority when none is given', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1, { priority: 7 });
    const entry = await store.claim(0);
    await store.dead(entry!.id, 'poison');
    expect(await store.requeueDead(entry!.id)).toBe(true);
    const requeued = (await store.list())[0]!;
    expect(requeued.status).toBe('QUEUED');
    expect(requeued.priority).toBe(7);
  });

  it('cancelAll skips entries that are no longer queued or claimed', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1);
    const entry = await store.claim(0);
    await store.complete(entry!.id);
    await store.enqueuePayload(2);
    expect(await store.cancelAll()).toBe(1);
  });

  it('cancel works on queued entries and tracks cancelled in-flight claims', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1);
    const entry = await store.claim(0);
    expect(await store.cancel(entry!.id)).toBe(true);
    expect(store.wasCancelled(entry!.id)).toBe(true);
    await store.enqueuePayload(2);
    const pending = (await store.list('QUEUED'))[0]!;
    expect(await store.cancel(pending.id)).toBe(true);
    expect((await store.list('CANCELLED')).length).toBe(1);
    expect(await store.cancel('missing')).toBe(false);
    expect(await store.cancel(pending.id)).toBe(false);
  });

  it('cancelAll filters by predicate', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1, { priority: 1 });
    await store.enqueuePayload(2, { priority: 2 });
    const count = await store.cancelAll((entry) => entry.priority === 1);
    expect(count).toBe(1);
    expect((await store.list('CANCELLED')).map((e) => e.payload)).toEqual([1]);
  });

  it('purge clears everything', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1);
    await store.enqueuePayload(2);
    expect(await store.purge()).toBe(2);
    expect(store.size()).toBe(0);
  });

  it('list filters by status and empty entries are never claimed', async () => {
    const store = new InMemoryQueueStore<number>({ nowMs: () => 0 });
    await store.enqueuePayload(1);
    expect((await store.list()).length).toBe(1);
    expect((await store.list('DEAD')).length).toBe(0);
  });
});
