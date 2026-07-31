import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ShopifyTokenError, ShopifyValidationError } from './errors.js';
import type { StoreToken } from './types.js';

/**
 * Pluggable persistence for shop tokens.
 *
 * The rest of the platform can provide a database-backed implementation;
 * the SDK ships with an in-memory one for tests and an encrypted wrapper.
 */
export interface TokenStorage {
  save(token: StoreToken): Promise<void>;
  get(shopDomain: string): Promise<StoreToken | null>;
  delete(shopDomain: string): Promise<void>;
}

/** In-memory token storage. Useful for tests only. */
export class MemoryTokenStorage implements TokenStorage {
  private readonly store = new Map<string, StoreToken>();

  async save(token: StoreToken): Promise<void> {
    this.store.set(normalizeShopDomain(token.shopDomain), { ...token });
  }

  async get(shopDomain: string): Promise<StoreToken | null> {
    const token = this.store.get(normalizeShopDomain(shopDomain));
    return token ? { ...token } : null;
  }

  async delete(shopDomain: string): Promise<void> {
    this.store.delete(normalizeShopDomain(shopDomain));
  }
}

export interface EncryptedTokenStorageOptions {
  /** Underlying persistence that will receive the ciphertext. */
  delegate: TokenStorage;
  /**
   * 32-byte AES key. Either a 64-char hex string (e.g. from an env var
   * `SHOPIFY_TOKEN_ENCRYPTION_KEY`) or a raw Buffer.
   */
  masterKey: string | Buffer;
}

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const ENVELOPE_VERSION = 1;

interface CipherEnvelope {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

/**
 * Wraps any `TokenStorage` and encrypts access tokens at rest with
 * AES-256-GCM before handing them to the delegate.
 *
 * The stored payload is an authenticated envelope `{ v, iv, tag, ct }`;
 * any tampering or use of the wrong key causes decryption to fail loudly.
 */
export class EncryptedTokenStorage implements TokenStorage {
  private readonly delegate: TokenStorage;
  private readonly key: Buffer;

  constructor(options: EncryptedTokenStorageOptions) {
    this.delegate = options.delegate;
    this.key = parseMasterKey(options.masterKey);
  }

  async save(token: StoreToken): Promise<void> {
    await this.delegate.save({ ...token, accessToken: this.encrypt(token.accessToken) });
  }

  async get(shopDomain: string): Promise<StoreToken | null> {
    const stored = await this.delegate.get(shopDomain);
    if (!stored) {
      return null;
    }
    return { ...stored, accessToken: this.decrypt(stored.accessToken) };
  }

  async delete(shopDomain: string): Promise<void> {
    await this.delegate.delete(shopDomain);
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope: CipherEnvelope = {
      v: ENVELOPE_VERSION,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ct: ciphertext.toString('base64'),
    };
    return JSON.stringify(envelope);
  }

  private decrypt(payload: string): string {
    const envelope = parseEnvelope(payload);
    try {
      const decipher = createDecipheriv(
        ENCRYPTION_ALGORITHM,
        this.key,
        Buffer.from(envelope.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ct, 'base64')),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch {
      throw new ShopifyTokenError(
        'Failed to decrypt stored access token',
        'TOKEN_DECRYPTION_FAILED',
      );
    }
  }
}

function parseEnvelope(payload: string): CipherEnvelope {
  try {
    const parsed = JSON.parse(payload) as Partial<CipherEnvelope>;
    if (
      parsed.v !== ENVELOPE_VERSION ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.tag !== 'string' ||
      typeof parsed.ct !== 'string'
    ) {
      throw new Error('malformed envelope');
    }
    return { v: parsed.v, iv: parsed.iv, tag: parsed.tag, ct: parsed.ct };
  } catch {
    throw new ShopifyTokenError(
      'Stored token is not a valid encrypted envelope',
      'TOKEN_DECRYPTION_FAILED',
    );
  }
}

function parseMasterKey(key: string | Buffer): Buffer {
  if (Buffer.isBuffer(key)) {
    if (key.length !== 32) {
      throw new ShopifyValidationError('Master key must be exactly 32 bytes', {
        operation: 'parseMasterKey',
      });
    }
    return key;
  }
  const normalized = key.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new ShopifyValidationError(
      'Master key must be a 64-char hex string or a 32-byte Buffer',
      { operation: 'parseMasterKey' },
    );
  }
  return Buffer.from(normalized, 'hex');
}

function normalizeShopDomain(shopDomain: string): string {
  return shopDomain.trim().toLowerCase();
}
