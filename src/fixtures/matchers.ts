import { expect as baseExpect, type APIResponse } from '@playwright/test';
import type { z } from 'zod';

/**
 * Domain assertions shared by API and integration tests. Failure messages include the
 * response body, which is the first thing needed when triaging a failed contract check.
 */
export const expect = baseExpect.extend({
  toMatchSchema(received: unknown, schema: z.ZodType) {
    const result = schema.safeParse(received);
    return {
      pass: result.success,
      name: 'toMatchSchema',
      message: () =>
        result.success
          ? 'Expected value NOT to match the schema, but it did'
          : `Schema validation failed:\n${JSON.stringify(result.error.issues, null, 2)}\nReceived: ${JSON.stringify(received).slice(0, 1500)}`,
    };
  },

  async toBeApiError(received: APIResponse, status: number, code: string) {
    const body = (await received.json().catch(() => null)) as { error?: { code?: string } } | null;
    const pass = received.status() === status && body?.error?.code === code;
    return {
      pass,
      name: 'toBeApiError',
      message: () =>
        `Expected ${status} "${code}", received ${received.status()} ${JSON.stringify(body)} from ${received.url()}`,
    };
  },
});
