import { describe, expect, it } from 'vitest';
import { ValidationError } from '@seogod/core';
import {
  constantTimeEqual,
  decryptAes256Gcm,
  encryptAes256Gcm,
  hashSha256,
  hmacSha256,
  randomBytes,
  randomHex,
} from './crypto.js';

const KEY = Buffer.from('a'.repeat(64), 'hex');
const SHORT_KEY = Buffer.alloc(16, 1);

describe('encryptAes256Gcm / decryptAes256Gcm', () => {
  it('round-trips plaintext', () => {
    const payload = encryptAes256Gcm('shpat_secret-token', KEY);
    expect(decryptAes256Gcm(payload, KEY)).toBe('shpat_secret-token');
  });

  it('produces a JSON envelope with iv, tag and ct', () => {
    const payload = encryptAes256Gcm('hello', KEY);
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(parsed.v).toBe(1);
    expect(typeof parsed.iv).toBe('string');
    expect(typeof parsed.tag).toBe('string');
    expect(typeof parsed.ct).toBe('string');
  });

  it('produces different ciphertext for identical plaintext (random IV)', () => {
    const a = encryptAes256Gcm('same', KEY);
    const b = encryptAes256Gcm('same', KEY);
    expect(a).not.toBe(b);
    expect(decryptAes256Gcm(a, KEY)).toBe(decryptAes256Gcm(b, KEY));
  });

  it('supports unicode plaintext', () => {
    const payload = encryptAes256Gcm('Über café 日本語', KEY);
    expect(decryptAes256Gcm(payload, KEY)).toBe('Über café 日本語');
  });

  it('fails loudly with the wrong key', () => {
    const payload = encryptAes256Gcm('secret', KEY);
    const wrongKey = Buffer.from('b'.repeat(64), 'hex');
    expect(() => decryptAes256Gcm(payload, wrongKey)).toThrow();
  });

  it('fails loudly on tampered ciphertext', () => {
    const payload = encryptAes256Gcm('secret', KEY);
    const parsed = JSON.parse(payload) as Record<string, string>;
    const ct = parsed.ct;
    if (ct === undefined) throw new Error('envelope has no ct');
    const tamperedCt = ct.startsWith('A') ? `B${ct.slice(1)}` : `A${ct.slice(1)}`;
    expect(() => decryptAes256Gcm(JSON.stringify({ ...parsed, ct: tamperedCt }), KEY)).toThrow();
  });

  it('fails loudly on malformed envelopes', () => {
    expect(() => decryptAes256Gcm('not-json', KEY)).toThrow();
    expect(() => decryptAes256Gcm('{"v":1,"iv":"x"}', KEY)).toThrow();
    expect(() => decryptAes256Gcm('{"v":2,"iv":"x","tag":"y","ct":"z"}', KEY)).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => encryptAes256Gcm('x', SHORT_KEY)).toThrow(ValidationError);
    expect(() => decryptAes256Gcm('{}', SHORT_KEY)).toThrow(ValidationError);
  });
});

describe('hashSha256', () => {
  it('matches a known SHA-256 vector', () => {
    expect(hashSha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic', () => {
    expect(hashSha256('token-1')).toBe(hashSha256('token-1'));
    expect(hashSha256('token-1')).not.toBe(hashSha256('token-2'));
  });
});

describe('hmacSha256', () => {
  it('matches a known HMAC-SHA256 vector (RFC 4231 test case 1)', () => {
    const key = Buffer.alloc(20, 0x0b);
    expect(hmacSha256('Hi There', key)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });

  it('accepts string keys and is deterministic', () => {
    expect(hmacSha256('data', 'key')).toBe(hmacSha256('data', 'key'));
    expect(hmacSha256('data', 'key')).not.toBe(hmacSha256('data', 'other'));
  });
});

describe('constantTimeEqual', () => {
  it('returns true for identical values', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
    expect(constantTimeEqual('abc', Buffer.from('abc'))).toBe(true);
  });

  it('returns false for different values of the same length', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });
});

describe('randomBytes / randomHex', () => {
  it('produces the requested sizes', () => {
    expect(randomBytes(32)).toHaveLength(32);
    expect(randomHex(16)).toHaveLength(32);
    expect(randomHex(8)).toHaveLength(16);
  });

  it('produces unique values', () => {
    expect(randomHex(16)).not.toBe(randomHex(16));
  });
});
