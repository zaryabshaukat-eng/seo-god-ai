import { z } from 'zod';

const truthyValues = ['true', '1', 'yes', 'on'];
const falsyValues = ['false', '0', 'no', 'off'];

const optionalString = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v),
  z.string().optional(),
);

const stringWithDefault = (defaultValue: string) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    z.string().min(1).default(defaultValue),
  );

const booleanFromEnv = z.preprocess(
  (v) => {
    if (v === undefined || v === '') return undefined;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (truthyValues.includes(s)) return true;
    if (falsyValues.includes(s)) return false;
    return v;
  },
  z.boolean().optional(),
);

const intFromEnv = (defaultValue: number) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    z.coerce.number().int().positive().default(defaultValue),
  );

const portFromEnv = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v),
  z.coerce.number().int().min(1).max(65535).default(3000),
);

/**
 * Validates the raw (flat) environment variable surface. Every variable the
 * platform reads is declared here; no other package touches `process.env`.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  PORT: portFromEnv,
  SHOPIFY_SHOP_DOMAIN: optionalString,
  SHOPIFY_API_KEY: optionalString,
  SHOPIFY_API_SECRET: optionalString,
  SHOPIFY_ADMIN_ACCESS_TOKEN: optionalString,
  SHOPIFY_API_VERSION: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    z.string().regex(/^\d{4}-\d{2}$/, 'API version must look like 2026-07').default('2026-07'),
  ),
  SHOPIFY_TOKEN_ENCRYPTION_KEY: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'token encryption key must be a 64-char hex string')
      .optional(),
  ),
  DATABASE_URL: stringWithDefault('postgresql://seogod:seogod@localhost:5432/seogod'),
  REDIS_URL: stringWithDefault('redis://localhost:6379'),
  CRAWLER_RESPECT_ROBOTS_TXT: booleanFromEnv.default(true),
  CRAWLER_MAX_PAGES: intFromEnv(5000),
  CRAWLER_RATE_LIMIT_MS: intFromEnv(200),
  AI_PROVIDER: z.enum(['openai', 'anthropic', 'none']).default('none'),
  AI_MODEL: optionalString,
  AI_API_KEY: optionalString,
  SAFETY_REQUIRE_APPROVAL: booleanFromEnv.default(true),
  REPORTS_OUTPUT_DIR: stringWithDefault('./reports-output'),
});

export type EnvInput = z.input<typeof envSchema>;
export type Env = z.output<typeof envSchema>;

/**
 * Maps the flat environment surface to the nested, domain-shaped config
 * consumed by the rest of the platform.
 */
export const configSchema = envSchema.transform((env) => ({
  app: {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    logLevel: env.LOG_LEVEL,
    port: env.PORT,
  },
  shopify: {
    shopDomain: env.SHOPIFY_SHOP_DOMAIN,
    apiKey: env.SHOPIFY_API_KEY,
    apiSecret: env.SHOPIFY_API_SECRET,
    adminAccessToken: env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    apiVersion: env.SHOPIFY_API_VERSION,
    tokenEncryptionKey: env.SHOPIFY_TOKEN_ENCRYPTION_KEY,
  },
  database: { url: env.DATABASE_URL },
  redis: { url: env.REDIS_URL },
  crawler: {
    respectRobotsTxt: env.CRAWLER_RESPECT_ROBOTS_TXT,
    maxPages: env.CRAWLER_MAX_PAGES,
    rateLimitMs: env.CRAWLER_RATE_LIMIT_MS,
  },
  ai: { provider: env.AI_PROVIDER, model: env.AI_MODEL, apiKey: env.AI_API_KEY },
  safety: { requireApproval: env.SAFETY_REQUIRE_APPROVAL },
  reports: { outputDir: env.REPORTS_OUTPUT_DIR },
}));

export type Config = z.infer<typeof configSchema>;
