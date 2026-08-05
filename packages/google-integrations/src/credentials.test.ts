import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CredentialManager,
  EncryptedCredentialStorage,
  MemoryCredentialStorage,
  type CredentialStorage,
} from './credentials.js';
import { GoogleTokenError, GoogleValidationError } from './errors.js';
import { GoogleOAuth } from './oauth.js';
import type { OAuthTokenResult, StoredCredential } from './types.js';

const NOW = new Date('2026-08-05T12:00:00Z');

function oauth(refreshImpl?: (refreshToken: string) => Promise<OAuthTokenResult>): GoogleOAuth {
  const oauth = new GoogleOAuth({
    clientId: 'c',
    clientSecret: 's',
    redirectUri: 'https://app.example.com/cb',
    scopes: ['s1'],
  });
  if (refreshImpl) {
    vi.spyOn(oauth, 'refreshAccessToken').mockImplementation(refreshImpl);
  }
  return oauth;
}

const REFRESH = vi.fn(async (refreshToken: string): Promise<OAuthTokenResult> => {
  if (refreshToken !== 'rt-1') throw new Error('unexpected refresh token');
  return {
    accessToken: 'at-refreshed',
    refreshToken: 'rt-2',
    expiresIn: 3600,
    scope: 's1',
    tokenType: 'Bearer',
  };
});

const BASE_TOKENS: OAuthTokenResult = {
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  expiresIn: 3600,
  scope: 's1 s2',
  tokenType: 'Bearer',
};

function credential(now = NOW): StoredCredential {
  return {
    provider: 'search-console',
    account: 'owner@example.com',
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    scope: 's1 s2',
    expiresAt: now.getTime() + 3600_000,
    tokenType: 'Bearer',
    updatedAt: now.toISOString(),
  };
}

describe('MemoryCredentialStorage', () => {
  it('saves, reads copies and deletes', async () => {
    const storage = new MemoryCredentialStorage();
    const tokens = credential();
    await storage.save(tokens);
    tokens.accessToken = 'mutated';

    const read = await storage.get('search-console', 'owner@example.com');
    expect(read?.accessToken).toBe('at-1');

    await storage.save({ ...read!, accessToken: 'at-2' });
    expect((await storage.get('search-console', 'owner@example.com'))?.accessToken).toBe('at-2');

    await storage.delete('search-console', 'owner@example.com');
    expect(await storage.get('search-console', 'owner@example.com')).toBeNull();
  });
});

describe('EncryptedCredentialStorage', () => {
  const KEY = 'a'.repeat(64);

  it('encrypts tokens at rest and decrypts on read', async () => {
    const delegate = new MemoryCredentialStorage();
    const storage = new EncryptedCredentialStorage({ delegate, masterKey: KEY });
    await storage.save(credential());

    const raw = await delegate.get('search-console', 'owner@example.com');
    expect(raw?.accessToken).not.toBe('at-1');
    expect(raw?.accessToken).toContain('"ct"');

    const read = await storage.get('search-console', 'owner@example.com');
    expect(read?.accessToken).toBe('at-1');
    expect(read?.refreshToken).toBe('rt-1');
    expect(read?.provider).toBe('search-console');
  });

  it('keeps optional refresh token unset', async () => {
    const delegate = new MemoryCredentialStorage();
    const storage = new EncryptedCredentialStorage({ delegate, masterKey: KEY });
    const tokens = credential();
    delete tokens.refreshToken;
    await storage.save(tokens);
    const read = await storage.get('search-console', 'owner@example.com');
    expect(read?.refreshToken).toBeUndefined();
  });

  it('returns null when the delegate has nothing', async () => {
    const storage = new EncryptedCredentialStorage({
      delegate: new MemoryCredentialStorage(),
      masterKey: KEY,
    });
    expect(await storage.get('analytics', 'x@y.z')).toBeNull();
  });

  it('deletes through to the delegate', async () => {
    const delegate = new MemoryCredentialStorage();
    const storage = new EncryptedCredentialStorage({ delegate, masterKey: KEY });
    await storage.save(credential());
    await storage.delete('search-console', 'owner@example.com');
    expect(await delegate.get('search-console', 'owner@example.com')).toBeNull();
  });

  it('throws when the payload was tampered with', async () => {
    const delegate = new MemoryCredentialStorage();
    const storage = new EncryptedCredentialStorage({ delegate, masterKey: KEY });
    await storage.save(credential());
    const raw = await delegate.get('search-console', 'owner@example.com');
    await delegate.save({ ...raw!, accessToken: raw!.accessToken.slice(0, -3) + 'zzz' });

    await expect(storage.get('search-console', 'owner@example.com')).rejects.toBeInstanceOf(
      GoogleTokenError,
    );
  });

  it('validates the master key format', () => {
    const delegate = new MemoryCredentialStorage();
    expect(() => new EncryptedCredentialStorage({ delegate, masterKey: 'short' })).toThrow(
      GoogleValidationError,
    );
    expect(
      () => new EncryptedCredentialStorage({ delegate, masterKey: Buffer.alloc(16) }),
    ).toThrow(GoogleValidationError);
    expect(
      () => new EncryptedCredentialStorage({ delegate, masterKey: Buffer.alloc(32) }),
    ).not.toThrow();
  });
});

describe('CredentialManager', () => {
  beforeEach(() => {
    REFRESH.mockClear();
  });

  function manager(
    storage: CredentialStorage = new MemoryCredentialStorage(),
    refreshImpl = REFRESH,
  ): CredentialManager {
    return new CredentialManager({
      oauth: oauth(refreshImpl),
      storage,
      now: () => NOW,
    });
  }

  it('stores tokens and computes the expiry from expiresIn', async () => {
    const storage = new MemoryCredentialStorage();
    const stored = await manager(storage).storeTokens('search-console', 'owner@example.com', BASE_TOKENS);
    expect(stored.expiresAt).toBe(NOW.getTime() + 3600_000);
    expect(stored.updatedAt).toBe(NOW.toISOString());
    expect(await storage.get('search-console', 'owner@example.com')).toMatchObject({ accessToken: 'at-1' });
  });

  it('returns a stored credential unchanged when not expired', async () => {
    const storage = new MemoryCredentialStorage();
    const mgr = manager(storage);
    const stored = await mgr.storeTokens('search-console', 'owner@example.com', BASE_TOKENS);
    const tokens = await mgr.getValidTokens('search-console', 'owner@example.com');
    expect(tokens.accessToken).toBe('at-1');
    expect(tokens.updatedAt).toBe(stored.updatedAt);
  });

  it('refreshes and re-stores when the token is about to expire', async () => {
    const storage = new MemoryCredentialStorage();
    const mgr = manager(storage);
    await mgr.storeTokens('search-console', 'owner@example.com', {
      ...BASE_TOKENS,
      expiresIn: 10,
    });
    const tokens = await mgr.getValidTokens('search-console', 'owner@example.com');
    expect(tokens.accessToken).toBe('at-refreshed');
    expect(tokens.refreshToken).toBe('rt-2');
    expect(tokens.expiresAt).toBe(NOW.getTime() + 3600_000);
    expect(REFRESH).toHaveBeenCalledWith('rt-1');
  });

  it('keeps the stored refresh token when the refresh response omits one', async () => {
    const storage = new MemoryCredentialStorage();
    const mgr = manager(
      storage,
      vi.fn(async (): Promise<OAuthTokenResult> => ({
        accessToken: 'at-refreshed',
        expiresIn: 3600,
        scope: '',
        tokenType: '',
      })),
    );
    await mgr.storeTokens('search-console', 'owner@example.com', { ...BASE_TOKENS, expiresIn: 1 });
    const tokens = await mgr.getValidTokens('search-console', 'owner@example.com');
    expect(tokens.refreshToken).toBe('rt-1');
    expect(tokens.scope).toBe('s1 s2');
  });

  it('throws when nothing is stored', async () => {
    await expect(
      manager().getValidTokens('analytics', 'nobody@example.com'),
    ).rejects.toBeInstanceOf(GoogleTokenError);
  });

  it('throws when expired without a refresh token', async () => {
    const storage = new MemoryCredentialStorage();
    const mgr = manager(storage);
    await mgr.storeTokens('search-console', 'owner@example.com', {
      accessToken: 'at-1',
      expiresIn: 1,
      scope: 's1',
      tokenType: 'Bearer',
    });
    await expect(mgr.getValidTokens('search-console', 'owner@example.com')).rejects.toMatchObject({
      code: 'OAUTH_EXPIRED',
    });
  });

  it('does not refresh when expiresAt is 0 (unknown expiry)', async () => {
    const storage = new MemoryCredentialStorage();
    const mgr = manager(storage);
    await mgr.storeTokens('search-console', 'owner@example.com', {
      accessToken: 'at-1',
      scope: 's1',
      tokenType: 'Bearer',
    });
    const tokens = await mgr.getValidTokens('search-console', 'owner@example.com');
    expect(tokens.accessToken).toBe('at-1');
    expect(REFRESH).not.toHaveBeenCalled();
  });

  it('defaults now to the current time when not provided', async () => {
    const mgr = new CredentialManager({ oauth: oauth(), storage: new MemoryCredentialStorage() });
    const stored = await mgr.storeTokens('search-console', 'owner@example.com', BASE_TOKENS);
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
    expect(stored.updatedAt).toBeTruthy();
  });

  it('reports hasCredentials and deletes', async () => {
    const storage = new MemoryCredentialStorage();
    const mgr = manager(storage);
    expect(await mgr.hasCredentials('search-console', 'owner@example.com')).toBe(false);
    await mgr.storeTokens('search-console', 'owner@example.com', BASE_TOKENS);
    expect(await mgr.hasCredentials('search-console', 'owner@example.com')).toBe(true);
    await mgr.delete('search-console', 'owner@example.com');
    expect(await mgr.hasCredentials('search-console', 'owner@example.com')).toBe(false);
  });
});
