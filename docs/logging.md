# Logging

`@seogod/logging` provides structured JSON logging on top of [pino](https://getpino.io).

## API

```ts
import { createLogger, getLogger, resetLogger } from '@seogod/logging';
import type { Logger } from '@seogod/logging';

const logger = createLogger({ name: 'crawler', level: 'info' });
logger.info({ page: '/about' }, 'page crawled');

getLogger();   // singleton; level comes from config.app.logLevel
resetLogger(); // clears the singleton (used by tests)
```

`createLogger` accepts:

| Option    | Purpose                                              |
| --------- | ---------------------------------------------------- |
| `name`    | Logger name attached to every record                 |
| `level`   | pino level (`trace` … `fatal`, `silent`)              |
| `nodeEnv` | When `production`, pretty output is disabled          |
| `redact`  | Array of paths to redact in every log record         |
| `destination` | Custom pino destination stream (tests use a sink) |

## Error serialization

`serializeError` normalizes thrown values into a stable shape before logging:

- `AppError` → code, message, context, operation, module, requestId, retryable.
- Plain `Error` → name + message.
- Non-errors → String(value).
- Nested `cause` chains are serialized recursively.

Use it as the pino `serializers.err` replacement (or pass an `AppError` and rely on the built-in handling).

## Redaction

`REDACT_PATHS` lists sensitive fields (API keys, tokens, secrets) that are redacted as `[Redacted]` in every record. The pino `redact` option is supported for additional paths.
