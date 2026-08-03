import { ValidationError } from '@seogod/core';

/** Keys that must never be persisted into graph metadata. All lowercase. */
const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'credential',
]);

const MAX_DEPTH = 6;
const MAX_ENTRIES = 1000;

/**
 * Deep-copies metadata into a JSON-safe plain object, stripping sensitive
 * keys, functions, symbols, and cycles. Throws on non-serializable values so
 * bad data never reaches storage.
 */
export function sanitizeMetadata(
  value: unknown,
  options: { path?: string; depth?: number } = {},
): Record<string, unknown> {
  if (options.depth !== undefined && options.depth > MAX_DEPTH) {
    throw new ValidationError('Metadata exceeds maximum nesting depth', {
      module: 'knowledge-graph',
      operation: 'sanitizeMetadata',
      context: { path: options.path ?? '(root)' },
    });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Metadata must be a plain object', {
      module: 'knowledge-graph',
      operation: 'sanitizeMetadata',
      context: { path: options.path ?? '(root)' },
    });
  }

  const seen = new WeakSet<object>();
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    if (count >= MAX_ENTRIES) break;
    out[key] = sanitizeValue(entry, key, { depth: (options.depth ?? 0) + 1, seen });
    count += 1;
  }
  return out;
}

function sanitizeValue(
  value: unknown,
  path: string,
  options: { depth: number; seen: WeakSet<object> },
): unknown {
  if (value === null || value === undefined) return null;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    throw new ValidationError(`Metadata contains a non-serializable value at "${path}"`, {
      module: 'knowledge-graph',
      operation: 'sanitizeMetadata',
      context: { path },
    });
  }
  if (type === 'object') {
    if (value instanceof Date) return value.toISOString();
    const obj = value as Record<string, unknown>;
    if (options.seen.has(obj)) {
      throw new ValidationError(`Metadata contains a cycle at "${path}"`, {
        module: 'knowledge-graph',
        operation: 'sanitizeMetadata',
        context: { path },
      });
    }
    options.seen.add(obj);
    if (Array.isArray(value)) {
      return value.slice(0, MAX_ENTRIES).map((item, index) =>
        sanitizeValue(item, `${path}[${index}]`, { ...options, depth: options.depth + 1 }),
      );
    }
    if (options.depth > MAX_DEPTH) {
      throw new ValidationError('Metadata exceeds maximum nesting depth', {
        module: 'knowledge-graph',
        operation: 'sanitizeMetadata',
        context: { path },
      });
    }
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, entry] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      if (count >= MAX_ENTRIES) break;
      out[key] = sanitizeValue(entry, `${path}.${key}`, { ...options, depth: options.depth + 1 });
      count += 1;
    }
    return out;
  }
  return null;
}
