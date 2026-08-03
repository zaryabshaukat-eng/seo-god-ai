import { createHash, randomUUID } from 'node:crypto';

/**
 * Deterministic UUID v5-style id. Same (namespace, name) always yields the
 * same id, so re-plans and re-built artifacts keep stable identity and diffs
 * stay meaningful. Uses the same scheme as @seogod/knowledge-graph.
 */
export function deterministicUuid(namespace: string, name: string): string {
  const hash = createHash('sha256').update(`${namespace}\u0000${name}`).digest();
  return formatUuid(hash.subarray(0, 16));
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  const version = (parseInt(hex.slice(12, 14), 16) & 0x0f) | 0x50;
  const variant = (parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80;
  const vHex = version.toString(16).padStart(2, '0');
  const rHex = variant.toString(16).padStart(2, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${vHex}${hex.slice(13, 15)}-` +
    `${rHex}${hex.slice(17, 19)}-${hex.slice(20, 32)}`
  );
}

/** Collision-safe id for records that have no natural business key. */
export function newId(): string {
  return randomUUID();
}

/** Validates that a value looks like a UUID. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
