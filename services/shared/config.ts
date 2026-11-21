/**
 * Configuration for the simulated third-party services. Defaults match .env.example;
 * they are local test values, not secrets.
 */
const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== undefined && value !== '' ? parsed : fallback;
};

const portOf = (url: string | undefined, fallback: number): number =>
  url ? num(new URL(url).port, fallback) : fallback;

export const serviceConfig = {
  paymentPort: portOf(process.env.PAYMENT_SERVICE_URL, 4010),
  calendarPort: portOf(process.env.CALENDAR_SERVICE_URL, 4020),
  paymentServiceUrl: process.env.PAYMENT_SERVICE_URL ?? 'http://127.0.0.1:4010',
  smtpHost: process.env.SMTP_HOST ?? '127.0.0.1',
  smtpPort: num(process.env.SMTP_PORT, 1025),
  paymentApiKey: process.env.PAYMENT_API_KEY ?? 'sk_test_local_payments',
  paymentReadonlyKey: process.env.PAYMENT_READONLY_KEY ?? 'rk_test_local_payments',
  webhookSecret: process.env.WEBHOOK_SIGNING_SECRET ?? 'whsec_test_local',
  calendarToken: process.env.CALENDAR_API_TOKEN ?? 'cal_test_local_token',
  confirmationDelayMs: num(process.env.PAYMENT_CONFIRMATION_DELAY_MS, 1500),
};
