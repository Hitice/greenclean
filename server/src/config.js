import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-haiku-20241022'),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().min(256).max(8192).default(4096),

  /** HS256: assine tokens no painel de assinatura; a extensão envia o JWT no Bearer. */
  JWT_SECRET: z.string().default(''),

  /** Legado / dev: lista separada por vírgula. Não use em produção se usar só JWT. */
  API_TOKENS: z.string().default(''),

  /** Origens CORS permitidas, separadas por vírgula. Ex: chrome-extension://id,https://admin.seusite.com */
  CORS_ORIGINS: z.string().default(''),

  MAX_EMAILS_PER_REQUEST: z.coerce.number().int().min(1).max(100).default(30),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().default(60),

  /** Versão pública (health). */
  APP_VERSION: z.string().default('1.0.0'),
  GIT_SHA: z.string().default('dev'),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const d = parsed.data;
  return {
    ...d,
    apiTokens: d.API_TOKENS.split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    corsOrigins: d.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    hasAnthropic: Boolean(d.ANTHROPIC_API_KEY),
    hasJwt: Boolean(d.JWT_SECRET && d.JWT_SECRET.length >= 8),
  };
}

export const config = loadConfig();
