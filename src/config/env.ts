import 'dotenv/config';
import { z } from 'zod';

/**
 * Single source of truth for runtime configuration.
 * Values are validated once at startup so a misconfigured environment fails fast
 * with a readable message instead of producing confusing test failures.
 */
const EnvSchema = z.object({
  BASE_URL: z.url().default('https://automationexercise.com'),
  PAYMENT_SERVICE_URL: z.url().default('http://127.0.0.1:4010'),
  CALENDAR_SERVICE_URL: z.url().default('http://127.0.0.1:4020'),
  MAILPIT_URL: z.url().default('http://127.0.0.1:8025'),
  PAYMENT_API_KEY: z.string().min(1).default('sk_test_local_payments'),
  PAYMENT_READONLY_KEY: z.string().min(1).default('rk_test_local_payments'),
  WEBHOOK_SIGNING_SECRET: z.string().min(1).default('whsec_test_local'),
  CALENDAR_API_TOKEN: z.string().min(1).default('cal_test_local_token'),
  PAYMENT_CONFIRMATION_DELAY_MS: z.coerce.number().int().nonnegative().default(1500),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CROSS_BROWSER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CI: z
    .string()
    .optional()
    .transform((v) => Boolean(v) && v !== 'false'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
