# @seogod/shopify

Reusable Shopify Admin API SDK. This is the **only** module that talks to
Shopify — no other part of the platform calls Shopify APIs directly.

Built for SEO GOD AI with safety in mind: typed errors, automatic rate-limit
handling, retries, and encrypted token storage at rest.

## Features

- **Typed service layer** — `ShopifyService` with typed read/write methods
  (products, collections, pages, blogs, articles, themes, metafields, files).
- **OAuth connection flow** — authorization URL builder, HMAC validation,
  state (CSRF) checks, and code exchange.
- **Admin GraphQL client** — handles auth headers, throttling, retries, and
  cursor pagination.
- **Secure token storage** — pluggable `TokenStorage`, plus an
  `EncryptedTokenStorage` that encrypts access tokens at rest (AES-256-GCM).
- **Consistent error handling** — every failure is a typed `ShopifyError`
  subclass carrying `code`, `context`, and `timestamp`.

## Install

```bash
npm install @seogod/shopify
```

Requires Node >= 20 (uses the global `fetch`).

## Quick start

```ts
import { ShopifyService, EncryptedTokenStorage, MemoryTokenStorage } from '@seogod/shopify';

const tokenStorage = new EncryptedTokenStorage({
  // Delegate persistence. Swap for a database-backed implementation later.
  delegate: new MemoryTokenStorage(),
  // 64-char hex key, e.g. process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY
  masterKey: '0123456789abcdef...',
});

const shopify = new ShopifyService({
  clientId: process.env.SHOPIFY_API_KEY!,
  clientSecret: process.env.SHOPIFY_API_SECRET!,
  redirectUri: 'https://app.example.com/auth/shopify/callback',
  tokenStorage,
});

// 1. Send the store owner to the authorization URL.
const url = shopify.buildAuthorizationUrl({
  shopDomain: 'store.myshopify.com',
  state: 'csrf-token-you-persisted',
});
// redirect(user, url)

// 2. On callback, complete the handshake.
const token = await shopify.handleOAuthCallback({
  query: new URLSearchParams(window.location.search),
  expectedState: 'csrf-token-you-persisted',
});

// 3. Use the service. Never call the Shopify API directly anywhere else.
const products = await shopify.getProducts('store.myshopify.com');
const themes = await shopify.getThemes('store.myshopify.com');
```

## OAuth

`buildAuthorizationUrl` produces the consent URL. Persist the `state` value
yourself (e.g. in a signed session cookie) and pass it back as
`expectedState` to `handleOAuthCallback`, which:

1. validates the shop domain (`*.myshopify.com`, no URL spoofing),
2. validates the HMAC signature (enabled by default; disable via
   `validateHmac: false` only in local development),
3. validates `state` if `expectedState` is provided,
4. exchanges the code for an access token,
5. persists the token via your `TokenStorage`.

Offline tokens are requested by default. Pass `isOnline: true` to request a
per-user (online) token, which includes an `expiresAt`.

## Service methods

### Reads (paginated)

All list methods accept `{ first?, after?, query? }` and return
`{ items, pageInfo }`. Pagination is followed automatically up to
`maxPages` (default 100).

| Method                                          | Returns                              |
| ----------------------------------------------- | ------------------------------------ |
| `getProducts(shop)`                             | `Connection<Product>`                |
| `getCollections(shop)`                          | `Connection<Collection>`             |
| `getPages(shop)`                                | `Connection<Page>`                   |
| `getBlogs(shop)`                                | `Connection<Blog>`                   |
| `getArticles(shop, { blogId? })`                | `Connection<Article>`                |
| `getMetafields(shop, { namespace?, ownerId? })` | `Connection<Metafield>`              |
| `getThemes(shop)`                               | `Theme[]` (not paginated by Shopify) |

### Writes

| Method                              | Purpose                                            |
| ----------------------------------- | -------------------------------------------------- |
| `updateProduct(shop, input)`        | Update title, handle, description, SEO, tags, etc. |
| `updatePage(shop, input)`           | Update page content and SEO                        |
| `updateBlog(shop, input)`           | Update blog title/handle and SEO                   |
| `updateTheme(shop, themeId, files)` | Upsert theme files (e.g. `templates/product.json`) |
| `uploadImage(shop, { url, alt? })`  | Upload an image from a public URL                  |

Mutation errors surface through Shopify's `userErrors` and throw a typed
`ShopifyError` with the field-level messages attached to `context`.

## Rate limits

The GraphQL client watches the `X-Shopify-Shop-Api-Call-Limit` header:

- it **pauses before sending** when the store's bucket is ≥ 85% full
  (share one `RateThrottler` per store across requests for accuracy),
- it **retries 429s**, honoring `Retry-After`,
- it **retries** GraphQL `THROTTLED` errors and 5xx responses with
  exponential backoff + jitter (default 3 retries).

Only transient failures are retried — 4xx client errors fail immediately.

## Token storage

Implement `TokenStorage` to persist tokens anywhere:

```ts
export interface TokenStorage {
  save(token: StoreToken): Promise<void>;
  get(shopDomain: string): Promise<StoreToken | null>;
  delete(shopDomain: string): Promise<void>;
}
```

`EncryptedTokenStorage` wraps any implementation and encrypts the access
token with AES-256-GCM before handing it off. Use a 64-char hex master key
(e.g. `SHOPIFY_TOKEN_ENCRYPTION_KEY`) and rotate it carefully — rotating the
key invalidates previously stored tokens.

## Error handling

Every failure is a subclass of `ShopifyError`:

| Class                      | Meaning                                  |
| -------------------------- | ---------------------------------------- |
| `ShopifyAuthError`         | OAuth code exchange failed               |
| `ShopifyHmacError`         | OAuth callback signature invalid         |
| `ShopifyInvalidStateError` | OAuth `state` mismatch (CSRF)            |
| `ShopifyTokenError`        | Missing or undecryptable stored token    |
| `ShopifyRateLimitError`    | Rate limit exceeded (retryable)          |
| `ShopifyApiError`          | Shopify returned an error (has `status`) |
| `ShopifyNetworkError`      | Network failure (retryable)              |
| `ShopifyValidationError`   | Bad input to the SDK itself              |

All errors expose `code`, `context` (shop domain, operation, request ID),
and an ISO `timestamp` for structured logging.

## Testing

```bash
npm test            # vitest run
npm run typecheck   # tsc --noEmit (includes tests)
npm run build       # tsc -p tsconfig.build.json (excludes tests)
```

The whole service layer is unit-tested with an injectable `fetch`, so no
real Shopify credentials are ever needed.
