import { z } from 'zod';

export const MIN_JWT_SECRET_LENGTH = 32;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5'),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().min(256).max(8192).default(4096),
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),

  /** HS256: tokens issued by the subscription service; the extension sends the JWT as Bearer. */
  JWT_SECRET: z.string().default(''),

  /** Static tokens, comma separated. Meant for development and self-hosting. */
  API_TOKENS: z.string().default(''),

  /** Allowed CORS origins, comma separated. Example: chrome-extension://<id>. Required in production. */
  CORS_ORIGINS: z.string().default(''),

  MAX_EMAILS_PER_REQUEST: z.coerce.number().int().min(1).max(100).default(30),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().default(60),

  /** Public version (health). */
  APP_VERSION: z.string().default('1.0.0'),
  GIT_SHA: z.string().default('dev'),
});

function splitList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Validate an environment object. Throws an Error listing every problem.
 * @param {Record<string, string | undefined>} env
 */
export function parseConfig(env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = Object.entries(parsed.error.flatten().fieldErrors)
      .map(([key, messages]) => `${key}: ${messages.join(', ')}`);
    throw new Error(`Invalid environment: ${fields.join('; ')}`);
  }

  const d = parsed.data;
  const corsOrigins = splitList(d.CORS_ORIGINS);
  const problems = [];

  if (d.JWT_SECRET && d.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }
  if (d.NODE_ENV === 'production' && corsOrigins.length === 0) {
    problems.push('CORS_ORIGINS is required in production (for example chrome-extension://<extension-id>)');
  }
  if (problems.length > 0) {
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  }

  return {
    ...d,
    apiTokens: splitList(d.API_TOKENS),
    corsOrigins,
    hasAnthropic: Boolean(d.ANTHROPIC_API_KEY),
    hasJwt: Boolean(d.JWT_SECRET),
  };
}

function loadConfig() {
  try {
    return parseConfig(process.env);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

export const config = loadConfig();
