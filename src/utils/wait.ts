/**
 * Condition-based polling for asynchronous back-end effects (emails, webhooks).
 * Used instead of fixed sleeps: it returns as soon as the condition holds and
 * fails with the last observed value when the timeout is reached.
 */
export interface PollOptions {
  timeoutMs?: number;
  intervalsMs?: number[];
  description?: string;
}

export async function pollUntil<T>(
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = 10_000, intervalsMs = [100, 250, 500, 1000], description = 'condition' }: PollOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let last: T | undefined;
  for (;;) {
    last = await producer();
    if (predicate(last)) return last;
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${description}. Last value: ${JSON.stringify(last)}`,
      );
    }
    const delay = intervalsMs[Math.min(attempt, intervalsMs.length - 1)] ?? 1000;
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, Math.max(0, deadline - Date.now()))));
  }
}
