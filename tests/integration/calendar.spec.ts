import { test, expect } from '@/fixtures';
import { defined } from '@/utils/defined';
import { buildCalendarEvent, newCalendarId } from '@/data/calendar.factory';
import { CalendarEventSchema } from '@/integrations/calendar.client';
import { uniqueEmail } from '@/data/unique';

/** Mock calendar used to book delivery appointments (services/calendar). */
test.describe('Delivery appointment calendar', { tag: ['@integration', '@calendar'] }, () => {
  test(
    'creating an appointment stores it and e-mails an iCalendar invite',
    { tag: '@smoke' },
    async ({ calendar, mailpit }) => {
      const calendarId = newCalendarId();
      const attendee = uniqueEmail('attendee');
      const input = buildCalendarEvent({ daysAhead: 2, hourUtc: 14 }, { attendees: [attendee] });

      const created = await calendar.createEvent(calendarId, input);

      expect(created).toMatchSchema(CalendarEventSchema);
      expect(created).toMatchObject({ calendarId, title: input.title, status: 'confirmed', sequence: 0 });
      expect(Date.parse(created.start)).toBe(Date.parse(input.start));
      expect(await calendar.getEvent(created.id)).toEqual(created);

      const invite = await mailpit.waitForMessage({ to: attendee, subject: `Invitation: ${input.title}` });
      const ics = defined(
        invite.Attachments.find((a) => a.FileName === 'invite.ics'),
        'invite.ics attachment',
      );
      const body = await mailpit.getAttachment(invite.ID, ics.PartID);
      expect(body).toContain('METHOD:REQUEST');
      expect(body).toContain(`UID:${created.id}@mock-calendar.test`);
      expect(body).toContain(`ATTENDEE;RSVP=TRUE:mailto:${attendee}`);
    },
  );

  test(
    'events are listed by time window in chronological order',
    { tag: '@regression' },
    async ({ calendar }) => {
      const calendarId = newCalendarId();
      const late = await calendar.createEvent(calendarId, buildCalendarEvent({ daysAhead: 5, hourUtc: 15 }));
      const early = await calendar.createEvent(calendarId, buildCalendarEvent({ daysAhead: 5, hourUtc: 9 }));
      const outside = await calendar.createEvent(
        calendarId,
        buildCalendarEvent({ daysAhead: 9, hourUtc: 9 }),
      );

      const windowStart = new Date(early.start);
      windowStart.setUTCHours(0);
      const windowEnd = new Date(windowStart.getTime() + 24 * 3600_000);
      const listed = await calendar.listEvents(calendarId, {
        from: windowStart.toISOString(),
        to: windowEnd.toISOString(),
      });

      expect(listed.map((e) => e.id)).toEqual([early.id, late.id]);
      expect(listed.map((e) => e.id)).not.toContain(outside.id);
    },
  );

  test(
    'rescheduling bumps the sequence and notifies attendees',
    { tag: '@regression' },
    async ({ calendar, mailpit }) => {
      const calendarId = newCalendarId();
      const attendee = uniqueEmail('attendee');
      const created = await calendar.createEvent(
        calendarId,
        buildCalendarEvent({}, { attendees: [attendee] }),
      );
      const moved = buildCalendarEvent({ daysAhead: 4, hourUtc: 16, durationMinutes: 90 });

      const updated = await calendar.updateEvent(created.id, {
        start: moved.start,
        end: moved.end,
        location: 'Locker 12',
      });

      expect(updated).toMatchObject({
        id: created.id,
        sequence: 1,
        location: 'Locker 12',
        // Fields not in the PATCH body must be preserved.
        title: created.title,
        description: created.description,
        attendees: [attendee],
      });
      expect(Date.parse(updated.end) - Date.parse(updated.start)).toBe(90 * 60_000);
      const mail = await mailpit.waitForMessage({ to: attendee, subject: `Updated: ${created.title}` });
      expect(mail.Text).toContain('Where: Locker 12');
    },
  );

  test(
    'cancelling keeps the event for audit, hides it from the schedule and notifies',
    { tag: '@regression' },
    async ({ calendar, mailpit }) => {
      const calendarId = newCalendarId();
      const attendee = uniqueEmail('attendee');
      const created = await calendar.createEvent(
        calendarId,
        buildCalendarEvent({}, { attendees: [attendee] }),
      );

      const cancelled = await calendar.cancelEvent(created.id);

      expect(cancelled).toMatchObject({ status: 'cancelled', sequence: 1 });
      expect(await calendar.listEvents(calendarId)).toEqual([]);
      expect((await calendar.listEvents(calendarId, { includeCancelled: true })).map((e) => e.id)).toEqual([
        created.id,
      ]);
      await expect(await calendar.cancelEventRaw(created.id)).toBeApiError(409, 'event_cancelled');
      await expect(await calendar.updateEventRaw(created.id, { title: 'x' })).toBeApiError(
        409,
        'event_cancelled',
      );

      const mail = await mailpit.waitForMessage({ to: attendee, subject: `Cancelled: ${created.title}` });
      const ics = defined(mail.Attachments[0], 'iCalendar attachment on the cancellation');
      expect(await mailpit.getAttachment(mail.ID, ics.PartID)).toContain('METHOD:CANCEL');
    },
  );

  test('a cancelled slot can be booked again', { tag: '@regression' }, async ({ calendar }) => {
    const calendarId = newCalendarId();
    const slot = buildCalendarEvent();
    const first = await calendar.createEvent(calendarId, slot);
    await calendar.cancelEvent(first.id);

    const rebooked = await calendar.createEvent(calendarId, { ...slot, title: 'Rebooked delivery' });
    expect(rebooked.status).toBe('confirmed');
  });

  test.describe('scheduling rules', () => {
    test('overlapping appointments are rejected', { tag: '@regression' }, async ({ calendar }) => {
      const calendarId = newCalendarId();
      const existing = await calendar.createEvent(
        calendarId,
        buildCalendarEvent({ hourUtc: 10, durationMinutes: 60 }),
      );
      const overlapping = buildCalendarEvent({ hourUtc: 10, durationMinutes: 30 });
      overlapping.start = new Date(Date.parse(existing.start) + 30 * 60_000).toISOString();
      overlapping.end = new Date(Date.parse(existing.end) + 30 * 60_000).toISOString();

      await expect(await calendar.createEventRaw(calendarId, overlapping)).toBeApiError(409, 'slot_conflict');
    });

    test('back-to-back appointments are allowed', { tag: '@regression' }, async ({ calendar }) => {
      const calendarId = newCalendarId();
      await calendar.createEvent(calendarId, buildCalendarEvent({ hourUtc: 10 }));
      const next = await calendar.createEvent(calendarId, buildCalendarEvent({ hourUtc: 11 }));
      expect(next.status).toBe('confirmed');
    });

    test('the same slot in another calendar is independent', { tag: '@regression' }, async ({ calendar }) => {
      const slot = buildCalendarEvent();
      await calendar.createEvent(newCalendarId(), slot);
      expect((await calendar.createEvent(newCalendarId(), slot)).status).toBe('confirmed');
    });

    const invalid: [string, Record<string, unknown>, string][] = [
      [
        'end before start',
        { start: '2030-01-01T12:00:00Z', end: '2030-01-01T11:00:00Z' },
        'invalid_time_range',
      ],
      [
        'longer than 8 hours',
        { start: '2030-01-01T08:00:00Z', end: '2030-01-01T17:00:00Z' },
        'invalid_time_range',
      ],
      [
        'date without time zone offset',
        { start: '2030-01-01T12:00:00', end: '2030-01-01T13:00:00' },
        'validation_error',
      ],
      ['unknown time zone', { timezone: 'Mars/Olympus_Mons' }, 'validation_error'],
      ['invalid attendee e-mail', { attendees: ['not-an-email'] }, 'validation_error'],
      ['blank title', { title: '   ' }, 'validation_error'],
    ];
    for (const [name, overrides, code] of invalid) {
      test(`rejects ${name}`, { tag: '@regression' }, async ({ calendar }) => {
        const response = await calendar.createEventRaw(newCalendarId(), {
          ...buildCalendarEvent(),
          ...overrides,
        });
        await expect(response).toBeApiError(422, code);
      });
    }

    test(
      'an update that creates an overlap is rejected and nothing changes',
      { tag: '@regression' },
      async ({ calendar }) => {
        const calendarId = newCalendarId();
        const morning = await calendar.createEvent(calendarId, buildCalendarEvent({ hourUtc: 9 }));
        const noon = await calendar.createEvent(calendarId, buildCalendarEvent({ hourUtc: 12 }));

        const response = await calendar.updateEventRaw(noon.id, { start: morning.start, end: morning.end });
        await expect(response).toBeApiError(409, 'slot_conflict');
        expect(await calendar.getEvent(noon.id)).toEqual(noon);
      },
    );
  });

  test('requests without a valid token are rejected', { tag: '@regression' }, async ({ calendar }) => {
    await expect(
      await calendar.createEventRaw(newCalendarId(), buildCalendarEvent(), 'wrong-token'),
    ).toBeApiError(401, 'unauthorized');
  });
});
