# Configuration

All environment configuration is validated and shaped by `@seogod/config`. It is the **only** package allowed to read `process.env`.

## Source of truth

- `packages/config/src/env.ts` — the Zod schema.
- `.env.example` — the documented contract. Copy to `.env` (never committed).

## Layers

1. **`envSchema`** validates the flat environment surface (every variable the platform reads), applying defaults and coercion. All keys have a default or are optional, so an empty environment is valid.
2. **`configSchema`** transforms the flat surface into a nested, domain-shaped object:

```ts
config.app          // { nodeEnv, isProduction, logLevel, port }
config.shopify      // { shopDomain, apiKey, apiSecret, adminAccessToken, apiVersion, tokenEncryptionKey }
config.database     // { url }
config.redis        // { url }
config.crawler      // { respectRobotsTxt, maxPages, rateLimitMs }
config.ai           // { provider, model, apiKey }
config.safety       // { requireApproval }
config.reports      // { outputDir }
```

## API

```ts
import { loadConfig, getConfig, resetConfig } from '@seogod/config';

const config = loadConfig();          // validates and returns a fresh Config
getConfig();                          // cached singleton; loads on first call
resetConfig();                        // clears the cache (used by tests)
```

`loadConfig` throws `ConfigurationError` when the environment fails validation; the offending paths are included in the error `context`.

## Validation rules worth knowing

- `PORT` must be an integer in `1..65535` (default `3000`). A port of `0` is rejected.
- `SHOPIFY_TOKEN_ENCRYPTION_KEY` must be exactly 64 hex characters (32 bytes).
- `SHOPIFY_API_VERSION` must match `YYYY-MM` (default `2026-07`).
- `AI_PROVIDER` is `openai | anthropic | none` (default `none`).
- Boolean variables accept `true/1/yes/on` and `false/0/no/off` (case-insensitive).
