import { describe, expect, it } from 'vitest';
import { type PluginError, PluginErrorCode } from '../src/errors.js';
import { createSandbox } from '../src/sandbox.js';

const SLOW_FN = 'function () { return new Promise(function () {}); }';

describe('createSandbox / evaluate', () => {
  it('evaluates expressions and returns completion values', () => {
    const sandbox = createSandbox();
    expect(sandbox.evaluate<number>('1 + 1')).toBe(2);
    expect(sandbox.evaluate<string>('"hello"')).toBe('hello');
    expect(sandbox.evaluate<{ a: number }>('({ a: 1 })')).toEqual({ a: 1 });
  });

  it('enforces the code length limit', () => {
    const sandbox = createSandbox({ maxCodeLength: 10 });
    expect(sandbox.evaluate<number>('1234567890')).toBe(1234567890);
    try {
      sandbox.evaluate('12345678901');
      expect.unreachable('expected invalidCode');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.invalidCode);
    }
  });

  it('rejects code that fails to parse', () => {
    try {
      createSandbox().evaluate('function (');
      expect.unreachable('expected invalidCode');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.invalidCode);
    }
  });

  it('rejects code that throws at evaluation time', () => {
    try {
      createSandbox().evaluate('throw new Error("boom")');
      expect.unreachable('expected sandboxEval');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.sandboxEval);
    }
  });

  it('rejects code that throws a primitive at evaluation time', () => {
    try {
      createSandbox().evaluate('throw 42');
      expect.unreachable('expected sandboxEval');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.sandboxEval);
    }
  });

  it('times out runaway synchronous code', () => {
    try {
      createSandbox({ timeoutMs: 50 }).evaluate('while (true) {}');
      expect.unreachable('expected sandboxTimeout');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.sandboxTimeout);
    }
  });

  it('strips dangerous globals', () => {
    const sandbox = createSandbox();
    const verdict = sandbox.evaluate<string>(
      '[typeof process, typeof require, typeof module, typeof exports, typeof Buffer, typeof global, typeof fetch, typeof WebAssembly, typeof setTimeout, typeof setInterval, typeof setImmediate, typeof queueMicrotask, typeof XMLHttpRequest, typeof Worker, typeof importScripts].join("|")',
    );
    expect(verdict).toBe('undefined|undefined|undefined|undefined|undefined|undefined|undefined|undefined|undefined|undefined|undefined|undefined|undefined|undefined|undefined');
  });

  it('injects extra safe globals', () => {
    const sandbox = createSandbox({ globals: { API_KEY: 'abc123' } });
    expect(sandbox.evaluate<string>('API_KEY')).toBe('abc123');
  });

  it('does not expose console unless a logger is provided', () => {
    expect(createSandbox().evaluate<string>('typeof console')).toBe('undefined');
    expect(createSandbox({ logger: {} }).evaluate<string>('typeof console')).toBe('object');
  });

  it('routes console output to the logger and freezes console', () => {
    const output: string[] = [];
    const logger = { log: (m: string) => output.push(m), info: (m: string) => output.push(`info:${m}`) };
    const sandbox = createSandbox({ logger });
    sandbox.evaluate('console.log("plain")');
    sandbox.evaluate('console.info({ a: 1 })');
    sandbox.evaluate('console.log(undefined)');
    sandbox.evaluate('const x = {}; x.self = x; console.log(x)');
    expect(output).toEqual(['plain', 'info:{"a":1}', 'undefined', '[object Object]']);
    expect(sandbox.evaluate<boolean>('Object.isFrozen(console)')).toBe(true);
  });
});

describe('invoke', () => {
  it('invokes a sandboxed function with cloned arguments', async () => {
    const sandbox = createSandbox();
    const obj = sandbox.evaluate<{ double: (x: number) => number }>('({ double: function (x) { return x * 2; } })');
    await expect(sandbox.invoke<number>(obj.double, undefined, [21])).resolves.toBe(42);
  });

  it('binds thisArg', async () => {
    const sandbox = createSandbox();
    const obj = sandbox.evaluate<{ add: (x: number) => number }>('({ add: function (x) { return this.base + x; } })');
    await expect(sandbox.invoke<number>(obj.add, { base: 10 }, [5])).resolves.toBe(15);
  });

  it('clones arguments so plugins cannot mutate host data', async () => {
    const sandbox = createSandbox();
    const obj = sandbox.evaluate<{ mutate: (o: { n: number }) => number }>('({ mutate: function (o) { o.n = 99; return o.n; } })');
    const hostObject = { n: 1 };
    await expect(sandbox.invoke<number>(obj.mutate, undefined, [hostObject])).resolves.toBe(99);
    expect(hostObject.n).toBe(1);
  });

  it('clones the result', async () => {
    const sandbox = createSandbox();
    const obj = sandbox.evaluate<{ fresh: () => { count: number } }>('({ fresh: function () { return { count: 1 }; } })');
    const first = await sandbox.invoke<{ count: number }>(obj.fresh, undefined, []);
    first.count = 5;
    const second = await sandbox.invoke<{ count: number }>(obj.fresh, undefined, []);
    expect(second.count).toBe(1);
  });

  it('passes primitives and null through', async () => {
    const sandbox = createSandbox();
    const obj = sandbox.evaluate<{
      str: () => string;
      num: () => number;
      bool: () => boolean;
      nothing: () => null;
      undef: () => undefined;
    }>('({ str: function () { return "s"; }, num: function () { return 7; }, bool: function () { return true; }, nothing: function () { return null; }, undef: function () { return undefined; } })');
    await expect(sandbox.invoke<string>(obj.str, undefined, [])).resolves.toBe('s');
    await expect(sandbox.invoke<number>(obj.num, undefined, [])).resolves.toBe(7);
    await expect(sandbox.invoke<boolean>(obj.bool, undefined, [])).resolves.toBe(true);
    await expect(sandbox.invoke<null>(obj.nothing, undefined, [])).resolves.toBeNull();
    await expect(sandbox.invoke<undefined>(obj.undef, undefined, [])).resolves.toBeUndefined();
  });

  it('passes undefined arguments through', async () => {
    const sandbox = createSandbox();
    const obj = sandbox.evaluate<{ id: (a: unknown) => unknown }>('({ id: function (a) { return a; } })');
    await expect(sandbox.invoke(obj.id, undefined, [undefined])).resolves.toBeUndefined();
  });

  it('rejects non-serializable results', async () => {
    const sandbox = createSandbox();
    const obj = sandbox.evaluate<{ leak: () => unknown }>('({ leak: function () { return function () {}; } })');
    try {
      await sandbox.invoke(obj.leak, undefined, []);
      expect.unreachable('expected invalidOutput');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.invalidOutput);
    }
  });

  it('rejects a non-callable implementation', async () => {
    const sandbox = createSandbox();
    try {
      await sandbox.invoke(42, undefined, []);
      expect.unreachable('expected invalidOutput');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.invalidOutput);
    }
  });

  it('wraps synchronous throws', async () => {
    const sandbox = createSandbox();
    const obj = sandbox.evaluate<{ boom: () => void }>('({ boom: function () { throw new Error("nope"); } })');
    try {
      await sandbox.invoke(obj.boom, undefined, []);
      expect.unreachable('expected sandboxEval');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.sandboxEval);
      expect(pluginError.message).toContain('nope');
    }
  });

  it('awaits thenable results', async () => {
    const sandbox = createSandbox();
    const obj = sandbox.evaluate<{ fast: () => Promise<number> }>(
      '({ fast: function () { return Promise.resolve(5); } })',
    );
    await expect(sandbox.invoke<number>(obj.fast, undefined, [])).resolves.toBe(5);
  });

  it('propagates thenable rejections', async () => {
    const sandbox = createSandbox();
    const obj = sandbox.evaluate<{ fail: () => Promise<void> }>(
      '({ fail: function () { return Promise.reject(new Error("rejected")); } })',
    );
    await expect(sandbox.invoke(obj.fail, undefined, [])).rejects.toThrow('rejected');
  });

  it('times out slow thenables', async () => {
    const sandbox = createSandbox({ timeoutMs: 10_000 });
    const obj = sandbox.evaluate<{ slow: () => Promise<unknown> }>(`({ slow: ${SLOW_FN} })`);
    try {
      await sandbox.invoke(obj.slow, undefined, [], 40);
      expect.unreachable('expected sandboxTimeout');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.sandboxTimeout);
    }
  });

  it('uses the configured default timeout when no override is given', async () => {
    const sandbox = createSandbox({ timeoutMs: 40 });
    const obj = sandbox.evaluate<{ slow: () => Promise<unknown> }>(`({ slow: ${SLOW_FN} })`);
    try {
      await sandbox.invoke(obj.slow, undefined, []);
      expect.unreachable('expected sandboxTimeout');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.sandboxTimeout);
    }
  });
});

describe('dispose', () => {
  it('invalidates the sandbox after dispose', () => {
    const sandbox = createSandbox();
    sandbox.dispose();
    sandbox.dispose();
    try {
      sandbox.evaluate('1 + 1');
      expect.unreachable('expected sandboxEval');
    } catch (error) {
      const pluginError = error as PluginError;
      expect(pluginError.code).toBe(PluginErrorCode.sandboxEval);
    }
  });
});
