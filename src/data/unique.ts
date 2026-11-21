import { randomBytes } from 'node:crypto';

/**
 * Collision-free identifiers for parallel runs: worker index + time + randomness.
 * Including the worker index makes leaked data easy to attribute when debugging.
 */
export function uniqueId(prefix: string): string {
  const worker = process.env.TEST_WORKER_INDEX ?? '0';
  return `${prefix}_w${worker}_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

/** Mailbox on a reserved test domain; Mailpit accepts any address, nothing is delivered externally. */
export function uniqueEmail(prefix = 'shopper'): string {
  return `${uniqueId(prefix).toLowerCase()}@e2e.example.test`;
}
