import { uniqueEmail, uniqueId } from './unique';

export interface CalendarEventInput {
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  timezone: string;
  attendees?: string[];
}

/** A private calendar per test keeps overlap rules from interfering across parallel workers. */
export const newCalendarId = (): string => uniqueId('cal');

/**
 * Builds a one-hour delivery appointment starting `daysAhead` days from now at `hourUtc`.
 */
export function buildCalendarEvent(
  { daysAhead = 3, hourUtc = 10, durationMinutes = 60 } = {},
  overrides: Partial<CalendarEventInput> = {},
): CalendarEventInput {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + daysAhead);
  start.setUTCHours(hourUtc, 0, 0, 0);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return {
    title: `Delivery slot ${uniqueId('slot').slice(-6)}`,
    description: 'Home delivery for online order',
    location: '221 Test Street, Toronto',
    start: start.toISOString(),
    end: end.toISOString(),
    timezone: 'America/Toronto',
    attendees: [uniqueEmail('attendee')],
    ...overrides,
  };
}
