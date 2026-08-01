# Events

`@seogod/events` implements a **transactional outbox** event bus on top of the `OutboxEvent` table. Publishing an event writes it in the same datastore the domain already writes to, so the event is durable and delivered at-least-once without distributed transactions.

## Event types

Dot-separated, lowercase identifiers:

```
crawl.completed
store.installed
approval.requested
```

Malformed types are rejected with `ValidationError`.

## API

```ts
import { EventBus } from '@seogod/events';

const bus = new EventBus(db, { maxAttempts: 5 });

bus.subscribe('crawl.completed', async (event) => {
  // handle event.payload
});

await bus.publish({ type: 'crawl.completed', aggregateId: 'job-1', payload: { pages: 42 } });
await bus.publishMany([/* ... */]);

const processed = await bus.processNext(100); // claim + dispatch up to 100 due events
```

`subscribe` accepts multiple handlers per type. EventBus takes an optional `now` clock for deterministic tests.

## Delivery lifecycle

`PENDING → PROCESSING → DONE`, or on handler failure:

- `attempts < maxAttempts` → back to `PENDING` with `attempts + 1` and `nextAttemptAt = now + 2^attempts` seconds (exponential backoff).
- `attempts >= maxAttempts` → `FAILED`.

Events with **no** subscribed handler are marked `DONE` (consumed) rather than retried forever.

`processNext` claims only events that are `PENDING` and due (`nextAttemptAt <= now`); the claim uses an atomic `updateMany` guarded on `status = PENDING` so concurrent workers never double-deliver.
