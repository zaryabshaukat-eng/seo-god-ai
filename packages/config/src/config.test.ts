import { afterEach, describe, expect, it } from 'vitest';
import { ConfigurationError } from '@seogod/core';
import { configSchema, envSchema, getConfig, loadConfig, resetConfig } from './index.js';

const fullEnv: Record<string, unknown> = {
  NODE_ENV: 'production',
  PORT: '8080',
  SHOPIFY_SHOP_DOMAIN: 'acme.myshopify.com',
  SHOPIFY_API_KEY: 'key',
  SHOPIFY_API_SECRET: 'secret',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'token',
  SHOPIFY_API_VERSION: '2025-01',
  SHOPIFY_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
  DATABASE_URL: 'postgresql://u:p@db:5432/seogod',
  REDIS_URL: 'redis://redis:6379',
  CRAWLER_RESPECT_ROBOTS_TXT: 'false',
  CRAWLER_MAX_PAGES: '1000',
  CRAWLER_RATE_LIMIT_MS: '50',
  AI_PROVIDER: 'openai',
  AI_MODEL: 'gpt-4o',
  AI_API_KEY: 'sk-test',
  SAFETY_REQUIRE_APPROVAL: 'false',
  REPORTS_OUTPUT_DIR: './out',
};

describe('envSchema', () => {
  it('parses a full valid environment into a nested config', () => {
    const config = configSchema.parse(fullEnv);
    expect(config.app).toEqual({ nodeEnv: 'production', isProduction: true, logLevel: 'info', port: 8080 });
    expect(config.shopify).toEqual({
      shopDomain: 'acme.myshopify.com',
      apiKey: 'key',
      apiSecret: 'secret',
      adminAccessToken: 'token',
      apiVersion: '2025-01',
      tokenEncryptionKey: 'a'.repeat(64),
    });
    expect(config.database.url).toBe('postgresql://u:p@db:5432/seogod');
    expect(config.redis.url).toBe('redis://redis:6379');
    expect(config.crawler).toEqual({ respectRobotsTxt: false, maxPages: 1000, rateLimitMs: 50 });
    expect(config.ai).toEqual({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' });
    expect(config.safety.requireApproval).toBe(false);
    expect(config.reports.outputDir).toBe('./out');
  });

  it('applies defaults when the environment is empty', () => {
    const config = configSchema.parse({});
    expect(config.app).toEqual({ nodeEnv: 'development', isProduction: false, logLevel: 'info', port: 3000 });
    expect(config.shopify.apiVersion).toBe('2026-07');
    expect(config.shopify.tokenEncryptionKey).toBeUndefined();
    expect(config.database.url).toBe('postgresql://seogod:seogod@localhost:5432/seogod');
    expect(config.redis.url).toBe('redis://localhost:6379');
    expect(config.crawler).toEqual({ respectRobotsTxt: true, maxPages: 5000, rateLimitMs: 200 });
    expect(config.ai).toEqual({ provider: 'none', model: undefined, apiKey: undefined });
    expect(config.safety.requireApproval).toBe(true);
    expect(config.reports.outputDir).toBe('./reports-output');
  });

  it('treats empty strings as unset', () => {
    const config = configSchema.parse({ SHOPIFY_API_KEY: '', DATABASE_URL: '' });
    expect(config.shopify.apiKey).toBeUndefined();
    expect(config.database.url).toBe('postgresql://seogod:seogod@localhost:5432/seogod');
  });

  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['on', true],
    [true, true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['off', false],
    [false, false],
  ])('parses boolean-ish value %p as %p', (value, expected) => {
    expect(configSchema.parse({ CRAWLER_RESPECT_ROBOTS_TXT: value }).crawler.respectRobotsTxt).toBe(
      expected,
    );
  });

  it('rejects an invalid boolean-ish value', () => {
    expect(() => configSchema.parse({ SAFETY_REQUIRE_APPROVAL: 'maybe' })).toThrow();
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => envSchema.parse({ NODE_ENV: 'staging' })).toThrow(/Invalid option/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => envSchema.parse({ PORT: '70000' })).toThrow();
  });

  it('rejects a malformed token encryption key', () => {
    expect(() => envSchema.parse({ SHOPIFY_TOKEN_ENCRYPTION_KEY: 'not-hex' })).toThrow(/64-char hex/);
  });

  it('rejects a malformed API version', () => {
    expect(() => envSchema.parse({ SHOPIFY_API_VERSION: '26-07' })).toThrow(/2026-07/);
  });

  it('rejects an unknown AI provider', () => {
    expect(() => envSchema.parse({ AI_PROVIDER: 'gemini' })).toThrow();
  });
});

describe('loadConfig', () => {
  it('returns the parsed config', () => {
    expect(loadConfig(fullEnv).app.port).toBe(8080);
  });

  it('reads from process.env by default', () => {
    process.env.PORT = '4567';
    try {
      expect(loadConfig().app.port).toBe(4567);
    } finally {
      delete process.env.PORT;
    }
  });

  it('throws a ConfigurationError with issue details on invalid input', () => {
    try {
      loadConfig({ PORT: '99999', AI_PROVIDER: 'gemini' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const configError = error as ConfigurationError;
      expect(configError.module).toBe('config');
      const issues = (configError.context.issues as { path: string; message: string }[]).map(
        (issue) => issue.path,
      );
      expect(issues).toContain('PORT');
      expect(issues).toContain('AI_PROVIDER');
    }
  });
});

describe('getConfig / resetConfig', () => {
  afterEach(() => resetConfig());

  it('caches the first parsed result', () => {
    const first = getConfig({ PORT: '1111' });
    const second = getConfig({ PORT: '2222' });
    expect(first).toBe(second);
    expect(first.app.port).toBe(1111);
  });

  it('re-parses after resetConfig', () => {
    expect(getConfig({ PORT: '1111' }).app.port).toBe(1111);
    resetConfig();
    expect(getConfig({ PORT: '2222' }).app.port).toBe(2222);
  });
});
