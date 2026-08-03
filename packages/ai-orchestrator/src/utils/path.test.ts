import { describe, expect, it } from 'vitest';
import { resolveOutputs, resolvePath } from './path.js';

describe('resolvePath', () => {
  it('returns the source for an empty path', () => {
    expect(resolvePath({ a: 1 }, '')).toEqual({ a: 1 });
  });

  it('walks dot-separated segments', () => {
    const source = { steps: { stepA: { data: { status: 'ok' } } } };
    expect(resolvePath(source, 'steps.stepA.data.status')).toBe('ok');
  });

  it('returns undefined for missing segments or non-object steps', () => {
    const source = { a: { b: 1 } };
    expect(resolvePath(source, 'a.c.d')).toBeUndefined();
    expect(resolvePath(source, 'x.y')).toBeUndefined();
    expect(resolvePath(source, 'a.b.c')).toBeUndefined();
  });
});

describe('resolveOutputs', () => {
  it('strips a steps. prefix and resolves against outputs', () => {
    const outputs = { stepA: { data: { status: 'ok' } } };
    expect(resolveOutputs(outputs, 'steps.stepA.data.status')).toBe('ok');
    expect(resolveOutputs(outputs, 'stepA.data.status')).toBe('ok');
    expect(resolveOutputs(outputs, 'steps.missing.value')).toBeUndefined();
  });
});
