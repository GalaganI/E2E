import { env } from '@/config/env';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

/**
 * Minimal structured logger. Output goes to stdout, which Playwright attaches to the
 * test result, so log lines show up next to the failing step in the HTML report.
 */
export class Logger {
  constructor(private readonly scope: string) {}

  child(scope: string): Logger {
    return new Logger(`${this.scope}:${scope}`);
  }

  debug(message: string, data?: unknown): void {
    this.write('debug', message, data);
  }
  info(message: string, data?: unknown): void {
    this.write('info', message, data);
  }
  warn(message: string, data?: unknown): void {
    this.write('warn', message, data);
  }
  error(message: string, data?: unknown): void {
    this.write('error', message, data);
  }

  private write(level: Level, message: string, data?: unknown): void {
    if (LEVELS[level] < LEVELS[env.LOG_LEVEL]) return;
    const worker = process.env.TEST_WORKER_INDEX ?? '-';
    const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`;
    console.log(
      `[${new Date().toISOString()}] ${level.toUpperCase()} w${worker} ${this.scope} ${message}${suffix}`,
    );
  }
}

export const logger = new Logger('e2e');
