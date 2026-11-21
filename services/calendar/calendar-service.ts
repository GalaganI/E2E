import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError, Router, requireBearer, type Request, type Response } from '../shared/http';
import { sendMail } from '../shared/mailer';
import { serviceConfig } from '../shared/config';

/*
 * Mock calendar provider used to book delivery / fitting appointments for orders.
 * Behaves like a minimal CalDAV/Google-Calendar style REST API:
 *  - events belong to a calendar; overlapping confirmed events are rejected (409)
 *  - every change bumps `sequence` (RFC 5545) and e-mails an iCalendar invite to attendees
 *  - cancellation is a state change, not a delete, so history stays queryable
 */

interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  timezone: string;
  attendees: string[];
  status: 'confirmed' | 'cancelled';
  sequence: number;
  createdAt: string;
  updatedAt: string;
}

const events = new Map<string, CalendarEvent>();
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

const IsoDateTime = z.iso.datetime({ offset: true });
const EventBase = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000),
  location: z.string().max(200),
  start: IsoDateTime,
  end: IsoDateTime,
  timezone: z.string().refine(isValidTimeZone, 'Unknown IANA time zone'),
  attendees: z.array(z.email()).max(20),
});
const CreateEventSchema = EventBase.extend({
  description: EventBase.shape.description.default(''),
  location: EventBase.shape.location.default(''),
  attendees: EventBase.shape.attendees.default([]),
});
// No defaults here: in zod, .partial() keeps .default() values, which would silently reset omitted fields.
const UpdateEventSchema = EventBase.partial().strict();

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function validateWindow(start: string, end: string): void {
  const duration = Date.parse(end) - Date.parse(start);
  if (duration <= 0) throw new HttpError(422, 'invalid_time_range', 'Event end must be after start');
  if (duration > MAX_DURATION_MS)
    throw new HttpError(422, 'invalid_time_range', 'Event cannot exceed 8 hours');
}

function assertNoConflict(calendarId: string, start: string, end: string, ignoreId?: string): void {
  const s = Date.parse(start);
  const e = Date.parse(end);
  const clash = [...events.values()].find(
    (ev) =>
      ev.calendarId === calendarId &&
      ev.status === 'confirmed' &&
      ev.id !== ignoreId &&
      Date.parse(ev.start) < e &&
      s < Date.parse(ev.end),
  );
  if (clash)
    throw new HttpError(409, 'slot_conflict', 'Time slot overlaps an existing event', { eventId: clash.id });
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(422, 'validation_error', 'Request validation failed', z.flattenError(result.error));
  }
  return result.data;
}

const toIcsDate = (iso: string): string =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

function toIcs(event: CalendarEvent, method: 'REQUEST' | 'CANCEL'): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//demo-shop//mock-calendar//EN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${event.id}@mock-calendar.test`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${toIcsDate(event.updatedAt)}`,
    `DTSTART:${toIcsDate(event.start)}`,
    `DTEND:${toIcsDate(event.end)}`,
    `SUMMARY:${event.title}`,
    `LOCATION:${event.location}`,
    `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...event.attendees.map((a) => `ATTENDEE;RSVP=TRUE:mailto:${a}`),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

async function notifyAttendees(
  event: CalendarEvent,
  kind: 'Invitation' | 'Updated' | 'Cancelled',
): Promise<void> {
  const method = kind === 'Cancelled' ? 'CANCEL' : 'REQUEST';
  await Promise.all(
    event.attendees.map((to) =>
      sendMail({
        to,
        subject: `${kind}: ${event.title}`,
        text: `${kind}: ${event.title}\nWhen: ${event.start} - ${event.end} (${event.timezone})\nWhere: ${event.location}\n`,
        html: `<p>${kind}: <strong>${event.title}</strong></p><p>When: ${event.start} - ${event.end} (${event.timezone})</p><p>Where: ${event.location}</p>`,
        headers: { 'X-Calendar-Event-Id': event.id },
        attachments: [
          {
            filename: 'invite.ics',
            content: toIcs(event, method),
            contentType: `text/calendar; method=${method}`,
          },
        ],
      }),
    ),
  );
}

function getOr404(eventId: string | undefined): CalendarEvent {
  const event = events.get(eventId ?? '');
  if (!event) throw new HttpError(404, 'event_not_found', 'Event not found');
  return event;
}

const auth = (req: Request): void => {
  requireBearer(req, { [serviceConfig.calendarToken]: 'write' }, 'write');
};

async function createEvent(req: Request): Promise<Response> {
  auth(req);
  const calendarId = req.params.calendarId ?? '';
  const input = parse(CreateEventSchema, req.body);
  validateWindow(input.start, input.end);
  assertNoConflict(calendarId, input.start, input.end);
  const timestamp = new Date().toISOString();
  const event: CalendarEvent = {
    id: `evt_${randomUUID()}`,
    calendarId,
    ...input,
    status: 'confirmed',
    sequence: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  events.set(event.id, event);
  await notifyAttendees(event, 'Invitation');
  return { status: 201, body: event };
}

function listEvents(req: Request): Response {
  auth(req);
  const from = req.query.get('from');
  const to = req.query.get('to');
  for (const [name, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (value !== null && !IsoDateTime.safeParse(value).success) {
      throw new HttpError(
        422,
        'validation_error',
        `Query parameter "${name}" must be an ISO date-time with offset`,
      );
    }
  }
  const includeCancelled = req.query.get('includeCancelled') === 'true';
  const list = [...events.values()]
    .filter((e) => e.calendarId === req.params.calendarId)
    .filter((e) => includeCancelled || e.status === 'confirmed')
    .filter((e) => !from || Date.parse(e.end) > Date.parse(from))
    .filter((e) => !to || Date.parse(e.start) < Date.parse(to))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { status: 200, body: { data: list } };
}

async function updateEvent(req: Request): Promise<Response> {
  auth(req);
  const event = getOr404(req.params.id);
  if (event.status === 'cancelled')
    throw new HttpError(409, 'event_cancelled', 'Cancelled events cannot be modified');
  const changes = parse(UpdateEventSchema, req.body);
  const merged = { ...event, ...changes };
  validateWindow(merged.start, merged.end);
  assertNoConflict(event.calendarId, merged.start, merged.end, event.id);
  Object.assign(event, merged, { sequence: event.sequence + 1, updatedAt: new Date().toISOString() });
  await notifyAttendees(event, 'Updated');
  return { status: 200, body: event };
}

async function cancelEvent(req: Request): Promise<Response> {
  auth(req);
  const event = getOr404(req.params.id);
  if (event.status === 'cancelled') throw new HttpError(409, 'event_cancelled', 'Event is already cancelled');
  Object.assign(event, {
    status: 'cancelled',
    sequence: event.sequence + 1,
    updatedAt: new Date().toISOString(),
  });
  await notifyAttendees(event, 'Cancelled');
  return { status: 200, body: event };
}

export function createCalendarRouter(): Router {
  return new Router()
    .on('GET', '/health', () => ({ status: 200, body: { status: 'ok', service: 'calendar-mock' } }))
    .on('POST', '/v1/calendars/:calendarId/events', createEvent)
    .on('GET', '/v1/calendars/:calendarId/events', listEvents)
    .on('GET', '/v1/events/:id', (req) => {
      auth(req);
      return { status: 200, body: getOr404(req.params.id) };
    })
    .on('PATCH', '/v1/events/:id', updateEvent)
    .on('POST', '/v1/events/:id/cancel', cancelEvent);
}
