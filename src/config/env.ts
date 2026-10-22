import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'si'].includes(v.toLowerCase())));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),

    /** URL pública del frontend; se usa para construir enlaces en correos. */
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    /** Orígenes permitidos (separados por coma). Por defecto, FRONTEND_URL. */
    CORS_ORIGINS: optionalString,
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
    COOKIE_SECURE: optionalString,
    SWAGGER_ENABLED: optionalString,
    JOBS_ENABLED: bool(true),
    TRUST_PROXY: bool(true),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./storage'),
    ALLOW_LOCAL_STORAGE_IN_PRODUCTION: bool(true),
    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: bool(true),

    MAIL_DRIVER: z.enum(['console', 'smtp', 'resend']).default('console'),
    MAIL_FROM: z.string().default('LUEM RENT A CAR <no-reply@localhost>'),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_SECURE: bool(false),
    RESEND_API_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} es obligatorio con STORAGE_DRIVER=s3` });
      }
    }
    if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'SMTP_HOST es obligatorio con MAIL_DRIVER=smtp' });
    }
    if (env.MAIL_DRIVER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY es obligatorio con MAIL_DRIVER=resend' });
    }
  });

export type Env = z.infer<typeof EnvSchema> & {
  corsOrigins: string[];
  cookieSecure: boolean;
  swaggerEnabled: boolean;
  isProduction: boolean;
};

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración de entorno inválida:\n${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const origins = (e.CORS_ORIGINS ?? e.FRONTEND_URL)
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  origins.push('https://luem.up.railway.app', 'http://localhost:3000');

  const env: Env = {
    ...e,
    FRONTEND_URL: e.FRONTEND_URL.replace(/\/+$/, ''),
    corsOrigins: Array.from(new Set(origins)),
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : isProduction,
    swaggerEnabled: e.SWAGGER_ENABLED ? e.SWAGGER_ENABLED === 'true' : !isProduction,
    isProduction,
  };
  if (source === process.env) cached = env;
  return env;
}

export const BUSINESS_TIMEZONE = 'America/El_Salvador';
export const CURRENCY = 'USD';
export const SESSION_COOKIE = 'luxem_session';
