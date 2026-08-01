import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { ValidationError } from '@seogod/core';

export interface EncryptedEnvelope {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

const AES_GCM = 'aes-256-gcm';
const IV_LENGTH = 12;
const ENVELOPE_VERSION = 1;
const KEY_LENGTH_BYTES = 32;

function toBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new ValidationError('AES-256-GCM requires a 32-byte key', { module: 'shared' });
  }
}

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const envelope = value as Record<string, unknown>;
  return (
    envelope.v === ENVELOPE_VERSION &&
    typeof envelope.iv === 'string' &&
    typeof envelope.tag === 'string' &&
    typeof envelope.ct === 'string'
  );
}

function parseEnvelope(payload: string): EncryptedEnvelope {
  const parsed: unknown = JSON.parse(payload) as unknown;
  if (!isEnvelope(parsed)) {
    throw new Error('malformed encrypted envelope');
  }
  return parsed;
}

/** Cryptographically secure random bytes. */
export function randomBytes(count: number): Buffer {
  return nodeRandomBytes(count);
}

/** Cryptographically secure random hex string of `count` random bytes. */
export function randomHex(count: number): string {
  return nodeRandomBytes(count).toString('hex');
}

/**
 * Encrypts a string with AES-256-GCM and returns a JSON envelope
 * `{ v, iv, tag, ct }` (base64 payload). Includes a random IV per call, so
 * identical plaintexts produce different ciphertexts.
 */
export function encryptAes256Gcm(plaintext: string, key: Buffer): string {
  assertKeyLength(key);
  const iv = nodeRandomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_GCM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope: EncryptedEnvelope = {
    v: ENVELOPE_VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ciphertext.toString('base64'),
  };
  return JSON.stringify(envelope);
}

/**
 * Decrypts an envelope produced by {@link encryptAes256Gcm}. Throws if the
 * payload is malformed, tampered with, or the key is wrong (GCM auth tag).
 */
export function decryptAes256Gcm(payload: string, key: Buffer): string {
  assertKeyLength(key);
  const envelope = parseEnvelope(payload);
  const decipher = createDecipheriv(AES_GCM, key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ct, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** SHA-256 hex digest. Use for fingerprinting (not password storage). */
export function hashSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** HMAC-SHA256 hex signature of `data` under `key`. */
export function hmacSha256(data: string, key: string | Buffer): string {
  return createHmac('sha256', toBuffer(key)).update(data, 'utf8').digest('hex');
}

/**
 * Constant-time string/Buffer comparison. Returns false immediately when
 * lengths differ (length is not secret); never reveals content differences.
 */
export function constantTimeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const bufA = toBuffer(a);
  const bufB = toBuffer(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
