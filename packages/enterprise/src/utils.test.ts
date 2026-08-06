import { describe, expect, it } from 'vitest';
import {
  addDays,
  datePart,
  hmac,
  isIsoDate,
  newApiKey,
  newId,
  randomSecret,
  sha256,
  signWebhookPayload,
  verifySignature,
} from './utils.js';

describe('newId', () => {
  it('generates prefixed unique ids', () => {
    const a = newId('tnt');
    const b = newId('tnt');
    expect(a).toMatch(/^tnt_[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('cryptographic helpers', () => {
  it('produces stable sha256 digests', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
    expect(sha256('hello')).not.toBe(sha256('world'));
    expect(sha256('hello')).toHaveLength(64);
  });

  it('produces deterministic hmac digests', () => {
    expect(hmac('secret', 'payload')).toBe(hmac('secret', 'payload'));
    expect(hmac('secret', 'payload')).not.toBe(hmac('secret', 'other'));
  });

  it('produces url-safe random secrets', () => {
    const a = randomSecret();
    const b = randomSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomSecret(16)).toHaveLength(22);
  });
});

describe('webhook signature', () => {
  const secret = 'whsec_test';

  it('signs payloads with timestamp and v1 hmac', () => {
    const signature = signWebhookPayload(secret, '{"a":1}', 1_700_000_000);
    expect(signature).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });

  it('uses the current time when no timestamp is given', () => {
    const before = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(secret, '{}');
    const timestamp = Number(signature.slice(2, signature.indexOf(',')));
    expect(timestamp).toBeGreaterThanOrEqual(before);
  });

  it('verifies valid signatures', () => {
    const payload = '{"a":1}';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(secret, payload, timestamp);
    expect(verifySignature(secret, payload, signature)).toBe(true);
  });

  it('rejects tampered payloads and wrong secrets', () => {
    const payload = '{"a":1}';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(secret, payload, timestamp);
    expect(verifySignature(secret, payload.replace('1', '2'), signature)).toBe(false);
    expect(verifySignature('other', payload, signature)).toBe(false);
  });

  it('rejects stale signatures beyond the tolerance window', () => {
    const payload = '{"a":1}';
    const signature = signWebhookPayload(secret, payload, Math.floor(Date.now() / 1000) - 600);
    expect(verifySignature(secret, payload, signature)).toBe(false);
  });

  it('rejects malformed signatures', () => {
    expect(verifySignature(secret, '{}', 'garbage')).toBe(false);
    expect(verifySignature(secret, '{}', 't=abc,v1=zz')).toBe(false);
  });

  it('rejects signatures with mismatched digest lengths', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    expect(verifySignature(secret, '{}', `t=${timestamp},v1=abc`)).toBe(false);
  });
});

describe('date helpers', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-08-06')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-1-1')).toBe(false);
    expect(isIsoDate('not-a-date')).toBe(false);
  });

  it('adds days in UTC without DST drift', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('extracts the date part from ISO timestamps', () => {
    expect(datePart('2026-08-06T12:00:00.000Z')).toBe('2026-08-06');
    expect(datePart('2026-08-06')).toBe('2026-08-06');
    expect(datePart('short')).toBe('short');
  });
});

describe('newApiKey', () => {
  it('returns a prefixed plaintext, a short prefix and a hash', () => {
    const { plaintext, prefix, hash } = newApiKey('Acme Corp');
    expect(plaintext).toMatch(/^sk_seogod_acmecorp_[A-Za-z0-9_-]{32}$/);
    expect(prefix).toBe(plaintext.slice(0, 24));
    expect(hash).toBe(sha256(plaintext));
  });

  it('falls back for slugs with no safe characters', () => {
    const { plaintext } = newApiKey('!!!');
    expect(plaintext).toMatch(/^sk_seogod_tenant_/);
  });
});
