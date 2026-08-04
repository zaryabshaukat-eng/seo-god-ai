import { createHash, randomUUID } from 'node:crypto';

/** Same scheme as @seogod/decision-engine and @seogod/ai-orchestrator. */
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

export function newId(): string {
  return randomUUID();
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
