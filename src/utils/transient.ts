import { test, type APIResponse, type Page, type Response } from '@playwright/test';
import { logger } from './logger';

/*
 * The public demo shop sheds load by answering with "This website is under heavy load
 * (queue full)" (HTML) or a 5xx/429. That is an availability problem of the shared demo
 * environment, not a product defect, so it is retried a bounded number of times.
 * Each retry is recorded as a test annotation, so it is visible in the HTML report and
 * never silently hides a failure. Any other error is surfaced immediately.
 */

const OVERLOAD_TEXT = 'under heavy load';
const BACKOFF_MS = [1_000, 3_000, 6_000];

const isTransientStatus = (status: number): boolean => status === 429 || status >= 500;

function annotate(description: string): void {
  logger.warn(`transient AUT error: ${description}`);
  try {
    test.info().annotations.push({ type: 'transient-aut-error', description });
  } catch {
    // Outside a running test (e.g. a global setup); the log line is enough.
  }
}

const backoff = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt] ?? 6_000));

export async function gotoResilient(page: Page, url: string): Promise<Response | null> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await page.goto(url);
    const status = response?.status() ?? 200;
    const overloaded =
      isTransientStatus(status) ||
      (await page.getByRole('heading', { name: new RegExp(OVERLOAD_TEXT) }).count()) > 0;
    if (!overloaded || attempt >= BACKOFF_MS.length) return response;
    annotate(`GET ${url} -> HTTP ${status} (overloaded), retry ${attempt + 1}/${BACKOFF_MS.length}`);
    await backoff(attempt);
  }
}

export async function requestResilient(send: () => Promise<APIResponse>): Promise<APIResponse> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await send();
    const contentType = response.headers()['content-type'] ?? '';
    const overloaded =
      isTransientStatus(response.status()) ||
      (contentType.includes('text/html') && (await response.text()).includes(OVERLOAD_TEXT));
    if (!overloaded || attempt >= BACKOFF_MS.length) return response;
    annotate(
      `${response.url()} -> HTTP ${response.status()} (overloaded), retry ${attempt + 1}/${BACKOFF_MS.length}`,
    );
    await backoff(attempt);
  }
}
