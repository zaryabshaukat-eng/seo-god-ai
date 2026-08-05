/**
 * OAuth credential management.
 *
 * Credentials are keyed by `provider:account` (the account is the Google
 * account email) so one account can hold separate tokens per product scope.
 * The {@link CredentialManager} transparently refreshes expiring access
 * tokens, so callers always receive a valid token or a typed error.
 */

import { decryptAes256Gcm, encryptAes256Gcm } from '@seogod/shared';
import { GoogleTokenError, GoogleValidationError } from './errors.js';
import type { GoogleOAuth } from './oauth.js';
import type { GoogleProvider, OAuthTokenResult, StoredCredential } from './types.js';

/** Refresh the access token this far before it actually expires. */
const EXPIRY_LEEWAY_MS = 30_000;

export interface CredentialStorage {
  save(credential: StoredCredential): Promise<void>;
  get(provider: GoogleProvider, account: string): Promise<StoredCredential | null>;
  delete(provider: GoogleProvider, account: string): Promise<void>;
}

/** In-memory credential storage. Useful for tests and development only. */
export class MemoryCredentialStorage implements CredentialStorage {
  private readonly store = new Map<string, StoredCredential>();

  async save(credential: StoredCredential): Promise<void> {
    this.store.set(keyFor(credential.provider, credential.account), { ...credential });
  }

  async get(provider: GoogleProvider, account: string): Promise<StoredCredential | null> {
    const stored = this.store.get(keyFor(provider, account));
    return stored ? { ...stored } : null;
  }

  async delete(provider: GoogleProvider, account: string): Promise<void> {
    this.store.delete(keyFor(provider, account));
  }
}

export interface EncryptedCredentialStorageOptions {
  /** Underlying persistence that will receive the ciphertext. */
  delegate: CredentialStorage;
  /**
   * 32-byte AES key. Either a 64-char hex string (e.g. from an env var
   * `GOOGLE_CREDENTIAL_ENCRYPTION_KEY`) or a raw Buffer.
   */
  masterKey: string | Buffer;
}

/**
 * Wraps any `CredentialStorage` and encrypts access and refresh tokens at
 * rest with AES-256-GCM before handing them to the delegate.
 *
 * The stored payload is an authenticated envelope `{ v, iv, tag, ct }`
 * (see `@seogod/shared`); any tampering or use of the wrong key causes
 * decryption to fail loudly.
 */
export class EncryptedCredentialStorage implements CredentialStorage {
  private readonly delegate: CredentialStorage;
  private readonly key: Buffer;

  constructor(options: EncryptedCredentialStorageOptions) {
    this.delegate = options.delegate;
    this.key = parseMasterKey(options.masterKey);
  }

  async save(credential: StoredCredential): Promise<void> {
    const copy: StoredCredential = { ...credential };
    copy.accessToken = this.encrypt(credential.accessToken);
    if (credential.refreshToken) {
      copy.refreshToken = this.encrypt(credential.refreshToken);
    }
    await this.delegate.save(copy);
  }

  async get(provider: GoogleProvider, account: string): Promise<StoredCredential | null> {
    const stored = await this.delegate.get(provider, account);
    if (!stored) {
      return null;
    }
    const copy: StoredCredential = { ...stored };
    copy.accessToken = this.decrypt(stored.accessToken);
    if (stored.refreshToken) {
      copy.refreshToken = this.decrypt(stored.refreshToken);
    }
    return copy;
  }

  async delete(provider: GoogleProvider, account: string): Promise<void> {
    await this.delegate.delete(provider, account);
  }

  private encrypt(plaintext: string): string {
    return encryptAes256Gcm(plaintext, this.key);
  }

  private decrypt(payload: string): string {
    try {
      return decryptAes256Gcm(payload, this.key);
    } catch {
      throw new GoogleTokenError(
        'Failed to decrypt stored credential',
        'TOKEN_DECRYPTION_FAILED',
      );
    }
  }
}

export interface CredentialManagerOptions {
  oauth: GoogleOAuth;
  storage: CredentialStorage;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

/**
 * Reads and refreshes credentials for a `provider:account` pair. The
 * access token is auto-refreshed when it is about to expire, keeping the
 * rest of the package free from expiry bookkeeping.
 */
export class CredentialManager {
  private readonly oauth: GoogleOAuth;
  private readonly storage: CredentialStorage;
  private readonly now: () => Date;

  constructor(options: CredentialManagerOptions) {
    this.oauth = options.oauth;
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
  }

  /** Persists freshly exchanged tokens under `provider:account`. */
  async storeTokens(
    provider: GoogleProvider,
    account: string,
    tokens: OAuthTokenResult,
  ): Promise<StoredCredential> {
    const credential = toStoredCredential(provider, account, tokens, this.now());
    await this.storage.save(credential);
    return credential;
  }

  /**
   * Returns a valid (non-expired) credential for `provider:account`,
   * refreshing the access token first when necessary. Throws
   * `GoogleTokenError` when nothing is stored or the token cannot be
   * refreshed.
   */
  async getValidTokens(provider: GoogleProvider, account: string): Promise<StoredCredential> {
    const stored = await this.storage.get(provider, account);
    if (!stored) {
      throw new GoogleTokenError('No credentials stored for this account', 'TOKEN_NOT_FOUND', {
        provider,
        resource: account,
      });
    }
    if (!isExpired(stored, this.now())) {
      return { ...stored };
    }
    if (!stored.refreshToken) {
      throw new GoogleTokenError('Access token expired and no refresh token is available', 'OAUTH_EXPIRED', {
        provider,
        resource: account,
      });
    }
    const refreshed = await this.oauth.refreshAccessToken(stored.refreshToken);
    const updated = await this.storeTokens(provider, account, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
      expiresIn: refreshed.expiresIn,
      scope: refreshed.scope || stored.scope,
      tokenType: refreshed.tokenType || stored.tokenType,
    });
    return updated;
  }

  /** Whether a credential exists for the pair. */
  async hasCredentials(provider: GoogleProvider, account: string): Promise<boolean> {
    return (await this.storage.get(provider, account)) !== null;
  }

  /** Removes a stored credential. */
  async delete(provider: GoogleProvider, account: string): Promise<void> {
    await this.storage.delete(provider, account);
  }
}

export function toStoredCredential(
  provider: GoogleProvider,
  account: string,
  tokens: OAuthTokenResult,
  now: Date,
): StoredCredential {
  return {
    provider,
    account,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    scope: tokens.scope,
    expiresAt: tokens.expiresIn != null ? now.getTime() + tokens.expiresIn * 1000 : 0,
    tokenType: tokens.tokenType,
    updatedAt: now.toISOString(),
  };
}

function isExpired(credential: StoredCredential, now: Date): boolean {
  if (credential.expiresAt === 0) {
    return false;
  }
  return now.getTime() >= credential.expiresAt - EXPIRY_LEEWAY_MS;
}

function keyFor(provider: GoogleProvider, account: string): string {
  return `${provider}:${account.trim().toLowerCase()}`;
}

function parseMasterKey(key: string | Buffer): Buffer {
  if (Buffer.isBuffer(key)) {
    if (key.length !== 32) {
      throw new GoogleValidationError('Master key must be exactly 32 bytes', {
        operation: 'parseMasterKey',
      });
    }
    return key;
  }
  const normalized = key.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new GoogleValidationError(
      'Master key must be a 64-char hex string or a 32-byte Buffer',
      { operation: 'parseMasterKey' },
    );
  }
  return Buffer.from(normalized, 'hex');
}
