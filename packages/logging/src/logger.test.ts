import { afterEach, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { ValidationError } from '@seogod/core';
import { getLogger, resetLogger } from './log.js';
import { createLogger, serializeError } from './logger.js';
import type { Logger, LogDestination } from './logger.js';

interface CapturedLog {
  level: number;
  msg: string;
  name?: string;
  nodeEnv?: string;
  err?: Record<string, unknown>;
  [key: string]: unknown;
}

function makeLogger(options: { name?: string; level?: string; nodeEnv?: string; redact?: boolean } = {}): {
  logger: Logger;
  last: () => CapturedLog;
} {
  const lines: CapturedLog[] = [];
  const destination: LogDestination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as CapturedLog);
      callback();
    },
  });
  const logger = createLogger(
    {
      name: options.name,
      level: options.level as 'info' | undefined,
      nodeEnv: options.nodeEnv,
      redact: options.redact,
    },
    destination,
  );
  const last = () => {
    const line = lines.at(-1);
    if (line === undefined) throw new Error('no log line captured');
    return line;
  };
  return { logger, last };
}

describe('createLogger', () => {
  it('emits newline-delimited JSON with message and level', () => {
    const { logger, last } = makeLogger();
    logger.info('hello');
    expect(last().msg).toBe('hello');
    expect(last().level).toBe(30);
  });

  it('attaches the logger name and nodeEnv to every line', () => {
    const { logger, last } = makeLogger({ name: 'crawler', nodeEnv: 'production' });
    logger.warn('careful');
    expect(last().name).toBe('crawler');
    expect(last().nodeEnv).toBe('production');
  });

  it('supports structured arguments', () => {
    const { logger, last } = makeLogger();
    logger.info({ storeId: 'store-1', count: 3 }, 'crawled');
    expect(last().storeId).toBe('store-1');
    expect(last().count).toBe(3);
  });

  it('filters out lines below the configured level', () => {
    const { logger, last } = makeLogger({ level: 'warn' });
    logger.info('hidden');
    logger.warn('shown');
    expect(last().msg).toBe('shown');
  });

  it('supports child loggers', () => {
    const { logger, last } = makeLogger();
    const child = logger.child({ storeId: 'store-9' });
    child.info('child line');
    expect(last().storeId).toBe('store-9');
  });

  it('redacts secrets by default', () => {
    const { logger, last } = makeLogger();
    logger.info({ apiKey: 'sk-123', token: 'abc', safe: 'ok' }, 'msg');
    expect(last().apiKey).toBe('[REDACTED]');
    expect(last().token).toBe('[REDACTED]');
    expect(last().safe).toBe('ok');
  });

  it('does not redact when redact is disabled', () => {
    const { logger, last } = makeLogger({ redact: false });
    logger.info({ apiKey: 'sk-123' }, 'msg');
    expect(last().apiKey).toBe('sk-123');
  });
});

describe('serializeError', () => {
  it('captures AppError fields when logging an error', () => {
    const { logger, last } = makeLogger();
    const error = new ValidationError('bad input', {
      module: 'api',
      operation: 'create.store',
      requestId: 'req-1',
      context: { field: 'name' },
    });
    logger.error(error, 'request failed');
    const err = last().err as Record<string, unknown>;
    expect(err.type).toBe('ValidationError');
    expect(err.code).toBe('validation.error');
    expect(err.message).toBe('bad input');
    expect(err.module).toBe('api');
    expect(err.operation).toBe('create.store');
    expect(err.requestId).toBe('req-1');
    expect(err.context).toEqual({ field: 'name' });
    expect(err.retryable).toBe(false);
    expect(typeof err.stack).toBe('string');
  });

  it('serializes plain errors with type, message and stack', () => {
    const { logger, last } = makeLogger();
    logger.error(new Error('boom'), 'failed');
    const err = last().err as Record<string, unknown>;
    expect(err.type).toBe('Error');
    expect(err.message).toBe('boom');
    expect(typeof err.stack).toBe('string');
    expect(err.code).toBeUndefined();
  });

  it('serializes nested causes', () => {
    const error = new Error('outer', { cause: new Error('inner') });
    const { logger, last } = makeLogger();
    logger.error(error, 'failed');
    const err = last().err as Record<string, unknown>;
    expect((err.cause as Record<string, unknown>).message).toBe('inner');
  });

  it('serializes non-error values safely', () => {
    expect(serializeError('oops')).toEqual({ type: 'non-error', value: 'oops' });
    expect(serializeError(42)).toEqual({ type: 'non-error', value: 42 });
  });
});

describe('getLogger', () => {
  afterEach(() => resetLogger());

  it('returns a cached singleton configured from the environment', () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.NODE_ENV = 'test';
    try {
      const a = getLogger();
      const b = getLogger();
      expect(a).toBe(b);
    } finally {
      delete process.env.LOG_LEVEL;
      delete process.env.NODE_ENV;
    }
  });

  it('rebuilds after resetLogger', () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.NODE_ENV = 'test';
    try {
      const a = getLogger();
      resetLogger();
      const b = getLogger();
      expect(a).not.toBe(b);
    } finally {
      delete process.env.LOG_LEVEL;
      delete process.env.NODE_ENV;
    }
  });
});
