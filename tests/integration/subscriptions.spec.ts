import { test, expect } from '@/fixtures';
import { defined } from '@/utils/defined';
import { uniqueEmail } from '@/data/unique';
import { SubscriptionSchema, type Subscription } from '@/integrations/payment.client';

test.describe('Subscriptions', { tag: ['@integration', '@payments'] }, () => {
  test('subscription can be created, changed and cancelled', { tag: '@smoke' }, async ({ payments }) => {
    const created = await payments.createSubscription({
      customerEmail: uniqueEmail(),
      plan: 'basic',
      quantity: 1,
    });
    expect(created).toMatchObject({ status: 'active', version: 1 });

    const upgrade = await payments.updateSubscription(
      created.id,
      { plan: 'pro', quantity: 3 },
      created.version,
    );
    expect(upgrade.status()).toBe(200);
    expect(upgrade.headers().etag).toBe('"2"');
    const upgraded = (await upgrade.json()) as unknown;
    expect(upgraded).toMatchSchema(SubscriptionSchema);
    expect(upgraded).toMatchObject({ plan: 'pro', quantity: 3, version: 2 });

    const cancel = await payments.cancelSubscription(created.id, 2);
    expect(cancel.status()).toBe(200);
    expect(await payments.getSubscription(created.id)).toMatchObject({ status: 'canceled', version: 3 });
  });

  test(
    'concurrent modifications: exactly one writer wins, the rest get 412',
    { tag: '@regression' },
    async ({ payments }) => {
      const sub = await payments.createSubscription({
        customerEmail: uniqueEmail(),
        plan: 'basic',
        quantity: 1,
      });

      const quantities = [2, 3, 4, 5, 6];
      const responses = await Promise.all(
        quantities.map((quantity) => payments.updateSubscription(sub.id, { quantity }, sub.version)),
      );

      const winners = responses.filter((r) => r.status() === 200);
      const losers = responses.filter((r) => r.status() === 412);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(quantities.length - 1);
      for (const loser of losers) await expect(loser).toBeApiError(412, 'version_conflict');

      // No lost update: the stored state is exactly the winner's write.
      const winner = (await winners[0]?.json()) as Subscription;
      expect(await payments.getSubscription(sub.id)).toEqual(winner);
      expect(winner.version).toBe(2);
    },
  );

  test(
    'a client that lost the race can re-read and apply its change',
    { tag: '@regression' },
    async ({ payments }) => {
      const sub = await payments.createSubscription({
        customerEmail: uniqueEmail(),
        plan: 'basic',
        quantity: 1,
      });
      await payments.updateSubscription(sub.id, { quantity: 5 }, sub.version);

      const stale = await payments.updateSubscription(sub.id, { plan: 'enterprise' }, sub.version);
      await expect(stale).toBeApiError(412, 'version_conflict');

      const fresh = await payments.getSubscription(sub.id);
      const retried = await payments.updateSubscription(sub.id, { plan: 'enterprise' }, fresh.version);
      expect(retried.status()).toBe(200);
      expect(await payments.getSubscription(sub.id)).toMatchObject({
        plan: 'enterprise',
        quantity: 5,
        version: 3,
      });
    },
  );

  test('concurrent cancel and update cannot both succeed', { tag: '@regression' }, async ({ payments }) => {
    const sub = await payments.createSubscription({ customerEmail: uniqueEmail(), plan: 'pro', quantity: 2 });

    const [cancel, update] = await Promise.all([
      payments.cancelSubscription(sub.id, sub.version),
      payments.updateSubscription(sub.id, { quantity: 10 }, sub.version),
    ]);

    expect([cancel.status(), update.status()].sort()).toEqual([200, 412]);
    // Whichever request won, the stored state is exactly its result: no partial merge of both.
    const winner = defined(
      [cancel, update].find((r) => r.status() === 200),
      'winning response',
    );
    const final = await payments.getSubscription(sub.id);
    expect(final).toEqual(await winner.json());
    expect(final.version).toBe(2);
  });

  test('updates require an If-Match version', { tag: '@regression' }, async ({ payments }) => {
    const sub = await payments.createSubscription({
      customerEmail: uniqueEmail(),
      plan: 'basic',
      quantity: 1,
    });
    await expect(await payments.updateSubscription(sub.id, { quantity: 2 }, null)).toBeApiError(
      428,
      'precondition_required',
    );
  });

  test('a cancelled subscription cannot be modified', { tag: '@regression' }, async ({ payments }) => {
    const sub = await payments.createSubscription({
      customerEmail: uniqueEmail(),
      plan: 'basic',
      quantity: 1,
    });
    await payments.cancelSubscription(sub.id, sub.version);

    await expect(await payments.updateSubscription(sub.id, { quantity: 2 }, 2)).toBeApiError(
      409,
      'subscription_canceled',
    );
  });

  test('invalid plan and quantity are rejected', { tag: '@regression' }, async ({ payments }) => {
    const sub = await payments.createSubscription({
      customerEmail: uniqueEmail(),
      plan: 'basic',
      quantity: 1,
    });
    await expect(await payments.updateSubscription(sub.id, { quantity: 0 }, 1)).toBeApiError(
      422,
      'validation_error',
    );
    await expect(
      await payments.updateSubscription(sub.id, { plan: 'platinum' as Subscription['plan'] }, 1),
    ).toBeApiError(422, 'validation_error');
  });
});
