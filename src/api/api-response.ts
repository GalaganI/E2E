import type { APIResponse } from '@playwright/test';
import type { z } from 'zod';

/**
 * Parses a response body against a zod contract. On mismatch the error includes the
 * request URL, the zod issues and the body, which is what you need when triaging a
 * contract break from a CI log.
 */
export async function parseBody<S extends z.ZodType>(response: APIResponse, schema: S): Promise<z.infer<S>> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `Expected JSON from ${response.url()} but got HTTP ${response.status()} (${response.headers()['content-type'] ?? 'no content-type'}):\n${text.slice(0, 500)}`,
    );
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error(
      `Response from ${response.url()} does not match contract:\n${JSON.stringify(result.error.issues, null, 2)}\nBody: ${JSON.stringify(body).slice(0, 2000)}`,
    );
  }
  return result.data;
}
