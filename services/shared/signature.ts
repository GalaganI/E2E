import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature scheme modelled on common payment providers:
 *   header `x-signature: t=<unix-ms>,v1=<hex hmac-sha256 of "<t>.<raw body>">`
 */
export function signPayload(rawBody: string, secret: string, timestamp = Date.now()): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

export function verifySignature(header: string | undefined, rawBody: string, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const timestamp = Number(parts.t);
  const received = parts.v1;
  if (!Number.isFinite(timestamp) || !received) return false;
  const expected = signPayload(rawBody, secret, timestamp).split('v1=')[1] ?? '';
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
