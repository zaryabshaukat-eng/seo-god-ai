import { decryptAes256Gcm, encryptAes256Gcm } from '@seogod/shared';
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

/**
 * Wraps any `TokenStorage` and encrypts access tokens at rest with
 * AES-256-GCM before handing them to the delegate.
 *
 * The stored payload is an authenticated envelope `{ v, iv, tag, ct }`
 * (see `@seogod/shared`); any tampering or use of the wrong key causes
 * decryption to fail loudly.
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
    return encryptAes256Gcm(plaintext, this.key);
  }

  private decrypt(payload: string): string {
    try {
      return decryptAes256Gcm(payload, this.key);
    } catch {
      throw new ShopifyTokenError(
        'Failed to decrypt stored access token',
        'TOKEN_DECRYPTION_FAILED',
      );
    }
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
