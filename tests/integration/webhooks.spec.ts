import { test, expect } from '@/fixtures';
import { defined } from '@/utils/defined';
import { buildCard, buildOrder } from '@/data/payment.factory';
import { WebhookSimulator } from '@/integrations/webhook.simulator';

/*
 * Merchant webhook handling. Events are either produced by the simulated provider or crafted
 * and signed by WebhookSimulator, which gives full control over duplicates and ordering.
 */
test.describe('Payment webhooks', { tag: ['@integration', '@webhooks'] }, () => {
  test(
    'a duplicate delivery of the same event is processed only once',
    { tag: '@smoke' },
    async ({ payments, mailpit }) => {
      const order = await payments.createOrder(buildOrder());
      await payments.createPayment({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        card: buildCard(),
      });
      await payments.waitForOrder(order.id, (o) => o.status === 'paid', 'paid');
      const record = defined((await payments.listEvents(order.id))[0], 'payment event');

      await payments.redeliverEvent(record.event.id);
      await payments.redeliverEvent(record.event.id);

      const after = await payments.getOrder(order.id);
      expect(after.duplicateDeliveries).toBe(2);
      expect(after.appliedEvents).toEqual([record.event.id]);
      expect(after.emailsSent).toEqual(['confirmation']);
      // No second confirmation e-mail despite three deliveries.
      const mails = await mailpit.waitForMessages({ to: order.customerEmail });
      expect(mails).toHaveLength(1);
    },
  );

  test(
    'concurrent duplicate deliveries are applied once',
    { tag: '@regression' },
    async ({ payments, webhooks }) => {
      const order = await payments.createOrder(buildOrder());
      const event = WebhookSimulator.event(order.id, 'payment.succeeded', 1, { amount: order.amount });

      const responses = await Promise.all(Array.from({ length: 6 }, () => webhooks.deliver(event)));
      const bodies = await Promise.all(responses.map((r) => r.json() as Promise<{ duplicate?: boolean }>));

      expect(responses.every((r) => r.status() === 200)).toBe(true);
      expect(bodies.filter((b) => !b.duplicate)).toHaveLength(1);
      const after = await payments.getOrder(order.id);
      expect(after).toMatchObject({ status: 'paid', appliedEvents: [event.id], duplicateDeliveries: 5 });
    },
  );

  test(
    'an out-of-order "processing" event does not downgrade a paid order',
    { tag: '@regression' },
    async ({ payments, webhooks }) => {
      const order = await payments.createOrder(buildOrder());
      const processing = WebhookSimulator.event(order.id, 'payment.processing', 1);
      const succeeded = WebhookSimulator.event(order.id, 'payment.succeeded', 2, {
        paymentId: processing.data.paymentId,
      });

      await webhooks.deliverInOrder([succeeded, processing]); // arrives in the wrong order

      const after = await payments.getOrder(order.id);
      expect(after.status).toBe('paid');
      expect(after.lastAppliedSequence).toBe(2);
      expect(after.ignoredEvents).toEqual([{ id: processing.id, reason: 'stale' }]);
    },
  );

  test(
    'a late "failed" event from an earlier attempt does not undo a later success',
    { tag: '@regression' },
    async ({ payments, webhooks }) => {
      const order = await payments.createOrder(buildOrder());
      const failedFirstAttempt = WebhookSimulator.event(order.id, 'payment.failed', 1);
      const succeededRetry = WebhookSimulator.event(order.id, 'payment.succeeded', 2);

      await webhooks.deliverInOrder([succeededRetry, failedFirstAttempt]);

      const after = await payments.getOrder(order.id);
      expect(after).toMatchObject({ status: 'paid', paymentId: succeededRetry.data.paymentId });
      expect(after.emailsSent).toEqual(['confirmation']);
    },
  );

  test(
    'events delivered in order are all applied',
    { tag: '@regression' },
    async ({ payments, webhooks }) => {
      const order = await payments.createOrder(buildOrder());
      const events = [
        WebhookSimulator.event(order.id, 'payment.failed', 1),
        WebhookSimulator.event(order.id, 'payment.processing', 2),
        WebhookSimulator.event(order.id, 'payment.succeeded', 3),
      ];

      await webhooks.deliverInOrder(events);

      const after = await payments.getOrder(order.id);
      expect(after.appliedEvents).toEqual(events.map((e) => e.id));
      expect(after.status).toBe('paid');
    },
  );

  test(
    'a webhook with an invalid signature is rejected and has no effect',
    { tag: '@regression' },
    async ({ payments, webhooks }) => {
      const order = await payments.createOrder(buildOrder());
      const event = WebhookSimulator.event(order.id, 'payment.succeeded', 1);

      const forged = await webhooks.deliver(event, { signature: `t=${Date.now()},v1=${'0'.repeat(64)}` });
      await expect(forged).toBeApiError(400, 'invalid_signature');
      expect((await payments.getOrder(order.id)).status).toBe('awaiting_payment');
    },
  );

  test(
    'a webhook whose body was tampered with after signing is rejected',
    { tag: '@regression' },
    async ({ payments, webhooks }) => {
      const order = await payments.createOrder(buildOrder());
      const genuine = WebhookSimulator.event(order.id, 'payment.failed', 1);
      const signature = webhooks.sign(JSON.stringify(genuine));
      const tampered = { ...genuine, type: 'payment.succeeded' as const };

      await expect(await webhooks.deliver(tampered, { signature })).toBeApiError(400, 'invalid_signature');
    },
  );

  test('provider event log records every delivery attempt', { tag: '@regression' }, async ({ payments }) => {
    const order = await payments.createOrder(buildOrder());
    await payments.injectFaults(order.id, { merchantWebhookFailures: 1 });
    await payments.createPayment({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      card: buildCard(),
    });

    await payments.waitForOrder(order.id, (o) => o.status === 'paid', 'paid');
    const [record] = await payments.listEvents(order.id);
    expect(record?.deliveries.map((d) => [d.attempt, d.status])).toEqual([
      [1, 500],
      [2, 200],
    ]);
  });
});
