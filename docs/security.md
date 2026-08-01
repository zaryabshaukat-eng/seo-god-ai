# Security

Security-relevant guarantees are implemented in `@seogod/shared` and `@seogod/core` and consumed by the platform.

## Encryption at rest

`encryptAes256Gcm` / `decryptAes256Gcm` (in `@seogod/shared/src/crypto.ts`) protect stored Shopify tokens:

- AES-256-GCM with a random 96-bit IV per message and authentication tag.
- Output is a JSON envelope `{ v: 1, iv, tag, ct }` (base64).
- The key must be exactly 32 bytes, otherwise `ValidationError` is thrown.
- `decrypt` verifies the tag and rejects tampered ciphertext; failures surface as `ShopifyTokenError (TOKEN_DECRYPTION_FAILED)` in the Shopify package.

Generate the key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and set `SHOPIFY_TOKEN_ENCRYPTION_KEY` (64 hex chars).

## Integrity primitives

- `hashSha256`, `hmacSha256` — one-way digests and keyed integrity.
- `constantTimeEqual` — timing-safe comparison for secrets and digests.
- `randomBytes` / `randomHex` — CSPRNG-backed randomness.

## Input sanitization

`@seogod/shared/src/sanitize.ts`:

- `escapeHtml`, `sanitizeHtmlAttr` — prevent XSS in rendered content.
- `sanitizeFilename` — strips path separators and leading dots to prevent path traversal.
- `normalizeWhitespace`, `truncate` — normalize free text.
- `isSafeUrl` — allows only `http`/`https`/`mailto` URLs.

## Platform rules

- Only `@seogod/config` reads `process.env`; secrets never appear elsewhere in code.
- Structured logging redacts sensitive paths (`REDACT_PATHS`) and never logs keys/tokens.
- No `console.log` anywhere; no untyped `any`.
- High-impact actions go through the `ApprovalRequest` gate (`safety.requireApproval`, default true).

## Auditability

Every domain action can be recorded through `@seogod/audit` (`AuditService.log`), which appends to the immutable `AuditLog` table (`actorType`, `action`, `resourceType`, `resourceId`, optional `storeId` and `payload`). Entries are never updated or deleted, making agent behavior explainable and replayable.
