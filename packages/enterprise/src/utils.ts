/**
 * Enterprise utilities: id generation, cryptographic helpers (hashing, HMAC
 * signing/verification, secrets) and deterministic date arithmetic. All date
 * math runs on UTC so behavior is DST-independent and testable.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Generates a prefixed, random id like `ent_a1b2c3d4e5f6`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

/** SHA-256 hex digest of a string. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** HMAC-SHA-256 hex digest of a payload using a secret. */
export function hmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/** Random cryptographic secret, base64url encoded. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Signs a webhook payload as `t=<unixSeconds>,v1=<hmac>`, the scheme used by
 * Stripe/Slack-style webhook verification.
 */
export function signWebhookPayload(secret: string, payload: string, timestamp?: number): string {
  const now = timestamp ?? Math.floor(Date.now() / 1000);
  return `t=${now},v1=${hmac(secret, `${now}.${payload}`)}`;
}

/**
 * Verifies a signed webhook payload. Accepts `v1` signatures, rejects payloads
 * older than `toleranceSeconds` (default 5 minutes) to blunt replay attacks.
 */
export function verifySignature(secret: string, payload: string, signature: string, toleranceSeconds = 300): boolean {
  const entry = parseSignature(signature);
  if (entry === null) return false;
  const { timestamp, signatureHex } = entry;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(hmac(secret, `${timestamp}.${payload}`), 'hex');
  const received = Buffer.from(signatureHex, 'hex');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

interface ParsedSignature {
  timestamp: number;
  signatureHex: string;
}

function parseSignature(signature: string): ParsedSignature | null {
  const parts = signature.split(',');
  let timestamp: number | null = null;
  let signatureHex: string | null = null;
  for (const part of parts) {
    if (part.startsWith('t=')) {
      const value = Number(part.slice(2));
      timestamp = Number.isFinite(value) ? value : null;
    } else if (part.startsWith('v1=')) {
      signatureHex = part.slice(3);
    }
  }
  if (timestamp === null || signatureHex === null || signatureHex.length === 0) return null;
  return { timestamp, signatureHex };
}

/** True when a string is a valid `YYYY-MM-DD` date. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Adds days to a `YYYY-MM-DD` string using UTC math. */
export function addDays(date: string, days: number): string {
  const utc =
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) +
    days * 86_400_000;
  return new Date(utc).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of an ISO timestamp or date string. */
export function datePart(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/** Generates a tenant-scoped API key: `sk_seogod_<slug>_<secret>`. */
export function newApiKey(slug: string): { plaintext: string; prefix: string; hash: string } {
  const secret = randomSecret(24);
  const safeSlug = slug.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase().slice(0, 16) || 'tenant';
  const plaintext = `sk_seogod_${safeSlug}_${secret}`;
  return { plaintext, prefix: plaintext.slice(0, 24), hash: sha256(plaintext) };
}
