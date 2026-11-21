import { test as base, type APIRequestContext } from '@playwright/test';
import { env } from '@/config/env';
import { AutomationExerciseApi } from '@/api/automation-exercise.client';
import { buildUser, type UserData } from '@/data/user.factory';
import { Shop } from '@/pages';
import { Actor, BrowseTheWeb, CallAnApi } from '@/screenplay';
import { MailpitClient } from '@/integrations/mailpit.client';
import { PaymentClient } from '@/integrations/payment.client';
import { WebhookSimulator } from '@/integrations/webhook.simulator';
import { CalendarClient } from '@/integrations/calendar.client';
import { logger } from '@/utils/logger';

/**
 * Third-party ad/analytics hosts embedded in the demo shop. They inject full-screen
 * interstitials at random, which is the main source of flakiness on this site. Blocking
 * them is safe because none of them is part of the functionality under test.
 */
const THIRD_PARTY_NOISE =
  /(googlesyndication|doubleclick|googleadservices|adservice\.google|google-analytics|googletagmanager|fundingchoicesmessages|adtrafficquality|googletagservices|pagead2)\./;

interface Fixtures {
  shop: Shop;
  aeApi: AutomationExerciseApi;
  /** A unique, not-yet-registered customer. */
  newUser: UserData;
  /** A customer registered through the API before the test and deleted afterwards. */
  registeredUser: UserData;
  /** Creates Screenplay actors bound to this test's page and API context. */
  actorCalled: (name: string) => Actor;
  mailpit: MailpitClient;
  payments: PaymentClient;
  webhooks: WebhookSimulator;
  calendar: CalendarClient;
}

interface WorkerFixtures {
  paymentRequest: APIRequestContext;
  calendarRequest: APIRequestContext;
  mailpitRequest: APIRequestContext;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  context: async ({ context }, use) => {
    await context.route(THIRD_PARTY_NOISE, (route) => route.abort('blockedbyclient'));
    await use(context);
  },

  shop: async ({ page }, use) => {
    await use(new Shop(page));
  },

  aeApi: async ({ request }, use) => {
    await use(new AutomationExerciseApi(request));
  },

  newUser: async ({}, use) => {
    await use(buildUser());
  },

  registeredUser: async ({ aeApi }, use) => {
    const user = buildUser();
    const created = await aeApi.createAccount(user);
    if (created.responseCode !== 201) throw new Error(`Test user setup failed: ${JSON.stringify(created)}`);
    await use(user);
    // Teardown runs even when the test fails. 404 means the test itself deleted the account.
    const deleted = await aeApi.deleteAccount(user.email, user.password);
    if (![200, 404].includes(deleted.responseCode)) {
      logger.warn('Test user cleanup failed', { email: user.email, deleted });
    }
  },

  // A "cast": the same name returns the same actor for the whole test, so memory survives across steps.
  actorCalled: async ({ page, aeApi }, use) => {
    const cast = new Map<string, Actor>();
    await use((name: string) => {
      let actor = cast.get(name);
      if (!actor) {
        actor = new Actor(name).whoCan(BrowseTheWeb.using(page), CallAnApi.using(aeApi));
        cast.set(name, actor);
      }
      return actor;
    });
  },

  // One HTTP context per worker for each local service: cheap to share, no per-test state.
  paymentRequest: [
    async ({ playwright }, use) => {
      const ctx = await playwright.request.newContext({ baseURL: env.PAYMENT_SERVICE_URL });
      await use(ctx);
      await ctx.dispose();
    },
    { scope: 'worker' },
  ],
  calendarRequest: [
    async ({ playwright }, use) => {
      const ctx = await playwright.request.newContext({ baseURL: env.CALENDAR_SERVICE_URL });
      await use(ctx);
      await ctx.dispose();
    },
    { scope: 'worker' },
  ],
  mailpitRequest: [
    async ({ playwright }, use) => {
      const ctx = await playwright.request.newContext({ baseURL: env.MAILPIT_URL });
      await use(ctx);
      await ctx.dispose();
    },
    { scope: 'worker' },
  ],

  mailpit: async ({ mailpitRequest }, use) => {
    await use(new MailpitClient(mailpitRequest));
  },
  payments: async ({ paymentRequest }, use) => {
    await use(new PaymentClient(paymentRequest, env.PAYMENT_API_KEY));
  },
  webhooks: async ({ paymentRequest }, use) => {
    await use(new WebhookSimulator(paymentRequest, env.WEBHOOK_SIGNING_SECRET));
  },
  calendar: async ({ calendarRequest }, use) => {
    await use(new CalendarClient(calendarRequest, env.CALENDAR_API_TOKEN));
  },
});

export { expect } from './matchers';
