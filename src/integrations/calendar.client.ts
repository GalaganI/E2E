import type { APIRequestContext, APIResponse } from '@playwright/test';
import { z } from 'zod';
import { parseBody } from '@/api/api-response';
import type { CalendarEventInput } from '@/data/calendar.factory';

export const CalendarEventSchema = z.strictObject({
  id: z.string().startsWith('evt_'),
  calendarId: z.string(),
  title: z.string(),
  description: z.string(),
  location: z.string(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  timezone: z.string(),
  attendees: z.array(z.email()),
  status: z.enum(['confirmed', 'cancelled']),
  sequence: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export class CalendarClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly token: string,
  ) {}

  private get headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` };
  }

  createEventRaw(
    calendarId: string,
    input: CalendarEventInput | Record<string, unknown>,
    token = this.token,
  ) {
    return this.request.post(`/v1/calendars/${calendarId}/events`, {
      data: input,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async createEvent(calendarId: string, input: CalendarEventInput): Promise<CalendarEvent> {
    return parseBody(await this.createEventRaw(calendarId, input), CalendarEventSchema);
  }

  async getEvent(eventId: string): Promise<CalendarEvent> {
    return parseBody(
      await this.request.get(`/v1/events/${eventId}`, { headers: this.headers }),
      CalendarEventSchema,
    );
  }

  async listEvents(
    calendarId: string,
    query: { from?: string; to?: string; includeCancelled?: boolean } = {},
  ): Promise<CalendarEvent[]> {
    const params: Record<string, string> = {};
    if (query.from) params.from = query.from;
    if (query.to) params.to = query.to;
    if (query.includeCancelled) params.includeCancelled = 'true';
    const response = await this.request.get(`/v1/calendars/${calendarId}/events`, {
      params,
      headers: this.headers,
    });
    return (await parseBody(response, z.object({ data: z.array(CalendarEventSchema) }))).data;
  }

  updateEventRaw(eventId: string, changes: Partial<CalendarEventInput>): Promise<APIResponse> {
    return this.request.patch(`/v1/events/${eventId}`, { data: changes, headers: this.headers });
  }

  async updateEvent(eventId: string, changes: Partial<CalendarEventInput>): Promise<CalendarEvent> {
    return parseBody(await this.updateEventRaw(eventId, changes), CalendarEventSchema);
  }

  cancelEventRaw(eventId: string): Promise<APIResponse> {
    return this.request.post(`/v1/events/${eventId}/cancel`, { headers: this.headers });
  }

  async cancelEvent(eventId: string): Promise<CalendarEvent> {
    return parseBody(await this.cancelEventRaw(eventId), CalendarEventSchema);
  }
}
