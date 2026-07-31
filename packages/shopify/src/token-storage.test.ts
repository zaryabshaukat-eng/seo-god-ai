import { describe, expect, it } from 'vitest';
import { ShopifyTokenError, ShopifyValidationError } from './errors.js';
import { EncryptedTokenStorage, MemoryTokenStorage } from './token-storage.js';
import type { StoreToken } from './types.js';

const SHOP = 'store.myshopify.com';
const KEY = 'a'.repeat(64);

function sampleToken(): StoreToken {
  return {
    shopDomain: SHOP,
    accessToken: 'shpat_super-secret',
    scopes: ['read_products'],
    installedAt: '2026-01-01T00:00:00Z',
  };
}

describe('MemoryTokenStorage', () => {
  it('round-trips and isolates copies', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(sampleToken());
    const token = await storage.get(SHOP);
    expect(token?.accessToken).toBe('shpat_super-secret');
    expect(token).not.toBe(await storage.get(SHOP));

    token!.accessToken = 'mutated';
    const again = await storage.get(SHOP);
    expect(again?.accessToken).toBe('shpat_super-secret');
  });

  it('returns null for unknown shops and deletes entries', async () => {
    const storage = new MemoryTokenStorage();
    await storage.save(sampleToken());
    expect(await storage.get('other.myshopify.com')).toBeNull();

    await storage.delete(SHOP);
    expect(await storage.get(SHOP)).toBeNull();
  });
});

describe('EncryptedTokenStorage', () => {
  it('encrypts tokens at rest and decrypts them on read', async () => {
    const delegate = new MemoryTokenStorage();
    const storage = new EncryptedTokenStorage({ delegate, masterKey: KEY });

    await storage.save(sampleToken());

    const atRest = await delegate.get(SHOP);
    expect(atRest?.accessToken).not.toBe('shpat_super-secret');
    expect(atRest?.accessToken).toContain('"iv"');

    const token = await storage.get(SHOP);
    expect(token?.accessToken).toBe('shpat_super-secret');
  });

  it('produces different ciphertext for identical tokens (random IV)', async () => {
    const delegate = new MemoryTokenStorage();
    const storage = new EncryptedTokenStorage({ delegate, masterKey: KEY });

    await storage.save(sampleToken());
    const first = (await delegate.get(SHOP))!.accessToken;
    await storage.save(sampleToken());
    const second = (await delegate.get(SHOP))!.accessToken;

    expect(first).not.toBe(second);
  });

  it('fails loudly when the ciphertext is tampered with', async () => {
    const delegate = new MemoryTokenStorage();
    const storage = new EncryptedTokenStorage({ delegate, masterKey: KEY });
    await storage.save(sampleToken());

    await delegate.save({ ...sampleToken(), accessToken: 'tampered' });

    await expect(storage.get(SHOP)).rejects.toBeInstanceOf(ShopifyTokenError);
  });

  it('fails loudly when decrypted with the wrong key', async () => {
    const delegate = new MemoryTokenStorage();
    const storage = new EncryptedTokenStorage({ delegate, masterKey: KEY });
    await storage.save(sampleToken());

    const wrongKey = new EncryptedTokenStorage({ delegate, masterKey: 'b'.repeat(64) });
    await expect(wrongKey.get(SHOP)).rejects.toBeInstanceOf(ShopifyTokenError);
  });

  it('rejects an invalid master key', () => {
    const delegate = new MemoryTokenStorage();
    expect(() => new EncryptedTokenStorage({ delegate, masterKey: 'too-short' })).toThrow(
      ShopifyValidationError,
    );
    expect(() => new EncryptedTokenStorage({ delegate, masterKey: 'z'.repeat(64) })).toThrow(
      ShopifyValidationError,
    );
  });

  it('passes through deletes to the delegate', async () => {
    const delegate = new MemoryTokenStorage();
    const storage = new EncryptedTokenStorage({ delegate, masterKey: KEY });
    await storage.save(sampleToken());
    await storage.delete(SHOP);
    expect(await delegate.get(SHOP)).toBeNull();
  });
});
