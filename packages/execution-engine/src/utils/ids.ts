import { createHash, randomUUID } from 'node:crypto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Random v4 UUID. */
export function newId(): string {
  return randomUUID();
}

/** Deterministic v4-shaped UUID from a stable input string. */
export function deterministicUuid(input: string): string {
  const hash = createHash('sha256').update(input).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
