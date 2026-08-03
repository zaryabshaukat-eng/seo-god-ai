/**
 * Deterministic output-path resolution for conditional steps and report
 * building. Paths look like `steps.step-a.data.status`; `steps` refers to
 * the workflow outputs map.
 */

export function resolvePath(source: Record<string, unknown>, path: string): unknown {
  if (path === '') return source;
  const segments = path.split('.');
  let current: unknown = source;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    const value = (current as Record<string, unknown>)[segment];
    if (value === undefined) return undefined;
    current = value;
  }
  return current;
}

/** Resolves a path against a workflow outputs record (`steps.<id>.<field>...`). */
export function resolveOutputs(
  outputs: Record<string, unknown>,
  key: string,
): unknown {
  const normalized = key.startsWith('steps.') ? key.slice('steps.'.length) : key;
  return resolvePath(outputs, normalized);
}
