/**
 * JSON helpers for parsing model output (which is often wrapped in fences or
 * prose) and producing stable, log-safe strings.
 */

/** Attempts to parse JSON text directly; returns null on failure. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Extracts the first JSON value from model output (fenced, inline, or bare). */
export function extractJson(text: string): { data: unknown; raw: string } | null {
  const direct = parseJson(text);
  if (direct !== null) return { data: direct, raw: text };

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence !== null) {
    const raw = fence[1]?.trim() ?? '';
    const data = parseJson(raw);
    if (data !== null) return { data, raw };
  }

  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  const start = Math.min(
    firstBrace === -1 ? Number.POSITIVE_INFINITY : firstBrace,
    firstBracket === -1 ? Number.POSITIVE_INFINITY : firstBracket,
  );
  if (Number.isFinite(start)) {
    const data = parseJson(text.slice(start));
    if (data !== null) return { data, raw: text.slice(start) };
  }

  return null;
}

/** Stable JSON stringification (sorted keys, no whitespace). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}
