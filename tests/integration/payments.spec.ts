import { test, expect } from '@/fixtures';
import { buildCard, buildOrder, TestCards } from '@/data/payment.factory';
import { uniqueId } from '@/data/unique';
import { env } from '@/config/env';
import { PaymentSchema } from '@/integrations/payment.client';

/** Local payment simulator: see services/payment. No real money or third-party account involved. */
test.describe('Payments', { tag: ['@integration', '@payments'] }, () => {
  test('successful card payment marks the order as paid', { tag: '@smoke' }, async ({ payments }) => {
    const order = await payments.createOrder(buildOrder());
    const payment = await payments.createPayment({ ...order, orderId: order.id, card: buildCard() });

    expect(payment).toMatchSchema(PaymentSchema);
    expect(payment).toMatchObject({
      status: 'succeeded',
      failureCode: null,
      cardLast4: '4242',
      amount: order.amount,
    });
    const paid = await payments.waitForOrder(order.id, (o) => o.status === 'paid', 'order to be paid');
    expect(paid.paymentId).toBe(payment.id);
  });

  for (const [card, failureCode] of [
    [TestCards.declined, 'card_declined'],
    [TestCards.insufficientFunds, 'insufficient_funds'],
  ] as const) {
    test(
      `declined payment (${failureCode}) leaves the order unpaid`,
      { tag: '@regression' },
      async ({ payments }) => {
        const order = await payments.createOrder(buildOrder());
        const payment = await payments.createPayment({ ...order, orderId: order.id, card: buildCard(card) });

        expect(payment).toMatchObject({ status: 'failed', failureCode });
        const failed = await payments.waitForOrder(
          order.id,
          (o) => o.status === 'payment_failed',
          'payment_failed',
        );
        expect(failed.paymentId).toBe(payment.id);
      },
    );
  }

  test(
    'customer can retry with another card after a decline',
    { tag: '@regression' },
    async ({ payments }) => {
      const order = await payments.createOrder(buildOrder());
      const body = { orderId: order.id, amount: order.amount, currency: order.currency };

      const declined = await payments.createPayment({ ...body, card: buildCard(TestCards.declined) });
      await payments.waitForOrder(order.id, (o) => o.status === 'payment_failed', 'payment_failed');

      const retried = await payments.createPayment({ ...body, card: buildCard(TestCards.success) });
      expect(retried.id).not.toBe(declined.id);
      const paid = await payments.waitForOrder(order.id, (o) => o.status === 'paid', 'paid after retry');
      expect(paid.paymentId).toBe(retried.id);
      expect(paid.appliedEvents).toHaveLength(2);
    },
  );

  test.describe('idempotency', () => {
    test(
      'replaying a request with the same key returns the original payment',
      { tag: '@smoke' },
      async ({ payments }) => {
        const order = await payments.createOrder(buildOrder());
        const body = { orderId: order.id, amount: order.amount, currency: order.currency, card: buildCard() };
        const key = uniqueId('idem');

        const first = await payments.createPaymentRaw(body, { idempotencyKey: key });
        const replay = await payments.createPaymentRaw(body, { idempotencyKey: key });

        expect(first.status()).toBe(201);
        expect(replay.status()).toBe(201);
        expect(replay.headers()['idempotent-replayed']).toBe('true');
        expect(await replay.json()).toEqual(await first.json());
        expect(await payments.listEvents(order.id), 'only one charge may be emitted').toHaveLength(1);
      },
    );

    test(
      'reusing a key with a different payload is rejected',
      { tag: '@regression' },
      async ({ payments }) => {
        const order = await payments.createOrder(buildOrder());
        const key = uniqueId('idem');
        const body = { orderId: order.id, amount: order.amount, currency: order.currency, card: buildCard() };

        await payments.createPayment(body, key);
        const conflicting = await payments.createPaymentRaw(
          { ...body, card: buildCard(TestCards.declined) },
          {
            idempotencyKey: key,
          },
        );
        await expect(conflicting).toBeApiError(409, 'idempotency_conflict');
      },
    );

    test(
      'concurrent requests with one key create exactly one payment',
      { tag: '@regression' },
      async ({ payments }) => {
        const order = await payments.createOrder(buildOrder());
        const body = { orderId: order.id, amount: order.amount, currency: order.currency, card: buildCard() };
        const key = uniqueId('idem');

        const responses = await Promise.all(
          Array.from({ length: 8 }, () => payments.createPaymentRaw(body, { idempotencyKey: key })),
        );
        const ids = new Set<string>();
        for (const response of responses) {
          expect(response.status()).toBe(201);
          ids.add(((await response.json()) as { id: string }).id);
        }
        expect(ids.size).toBe(1);
        expect(await payments.listEvents(order.id)).toHaveLength(1);
      },
    );

    test(
      'a paid order cannot be charged again with a new key',
      { tag: '@regression' },
      async ({ payments }) => {
        const order = await payments.createOrder(buildOrder());
        const body = { orderId: order.id, amount: order.amount, currency: order.currency, card: buildCard() };

        await payments.createPayment(body);
        await expect(await payments.createPaymentRaw(body)).toBeApiError(409, 'order_already_paid');
      },
    );

    test('requests without an Idempotency-Key are rejected', { tag: '@regression' }, async ({ payments }) => {
      const order = await payments.createOrder(buildOrder());
      const response = await payments.createPaymentRaw(
        { orderId: order.id, amount: order.amount, currency: order.currency, card: buildCard() },
        { idempotencyKey: null },
      );
      await expect(response).toBeApiError(400, 'idempotency_key_required');
    });
  });

  test(
    'delayed confirmation moves the order from processing to paid',
    { tag: '@regression' },
    async ({ payments }) => {
      const order = await payments.createOrder(buildOrder());
      const payment = await payments.createPayment({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        card: buildCard(TestCards.delayedConfirmation),
      });
      expect(payment.status).toBe('processing');
      await payments.waitForOrder(order.id, (o) => o.status === 'payment_processing', 'payment_processing');

      const paid = await payments.waitForOrder(
        order.id,
        (o) => o.status === 'paid',
        'delayed confirmation',
        env.PAYMENT_CONFIRMATION_DELAY_MS + 10_000,
      );
      expect(paid.appliedEvents).toHaveLength(2);
      const settled = (await (await payments.getPayment(payment.id)).json()) as unknown;
      expect(settled).toMatchObject({ id: payment.id, status: 'succeeded' });
    },
  );

  test.describe('recovery after back-end failures', () => {
    test(
      'client retries a 503 with the same key and is charged once',
      { tag: '@regression' },
      async ({ payments }) => {
        const order = await payments.createOrder(buildOrder());
        await payments.injectFaults(order.id, { paymentApiFailures: 2 });

        const { payment, attempts } = await payments.createPaymentWithRetry({
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          card: buildCard(),
        });

        expect(attempts).toBe(3);
        expect(payment.status).toBe('succeeded');
        expect(await payments.listEvents(order.id)).toHaveLength(1);
        await payments.waitForOrder(order.id, (o) => o.status === 'paid', 'paid after recovery');
      },
    );

    test(
      'provider re-delivers webhooks until the merchant recovers',
      { tag: '@regression' },
      async ({ payments }) => {
        const order = await payments.createOrder(buildOrder());
        await payments.injectFaults(order.id, { merchantWebhookFailures: 2 });

        await payments.createPayment({
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          card: buildCard(),
        });

        const paid = await payments.waitForOrder(
          order.id,
          (o) => o.status === 'paid',
          'paid after webhook retries',
        );
        const [record] = await payments.listEvents(order.id);
        expect(record?.deliveries.map((d) => d.status)).toEqual([500, 500, 200]);
        expect(paid.emailsSent).toEqual(['confirmation']);
      },
    );
  });

  test.describe('input validation', () => {
    const invalidBodies: [string, (orderId: string) => Record<string, unknown>][] = [
      [
        'card number failing the Luhn check',
        (o) => ({ orderId: o, amount: 4599, currency: 'USD', card: buildCard(TestCards.luhnInvalid) }),
      ],
      [
        'expired card',
        (o) => ({
          orderId: o,
          amount: 4599,
          currency: 'USD',
          card: buildCard(TestCards.success, { expYear: 2020 }),
        }),
      ],
      ['lower-case currency', (o) => ({ orderId: o, amount: 4599, currency: 'usd', card: buildCard() })],
      ['negative amount', (o) => ({ orderId: o, amount: -1, currency: 'USD', card: buildCard() })],
      ['missing card', (o) => ({ orderId: o, amount: 4599, currency: 'USD' })],
      [
        'non-numeric CVC',
        (o) => ({
          orderId: o,
          amount: 4599,
          currency: 'USD',
          card: buildCard(TestCards.success, { cvc: 'abc' }),
        }),
      ],
    ];

    for (const [name, body] of invalidBodies) {
      test(`rejects ${name} with 422`, { tag: '@regression' }, async ({ payments }) => {
        const order = await payments.createOrder(buildOrder());
        await expect(await payments.createPaymentRaw(body(order.id))).toBeApiError(422, 'validation_error');
      });
    }

    test('rejects an amount that does not match the order', { tag: '@regression' }, async ({ payments }) => {
      const order = await payments.createOrder(buildOrder({ amount: 1000 }));
      const response = await payments.createPaymentRaw({
        orderId: order.id,
        amount: 1,
        currency: 'USD',
        card: buildCard(),
      });
      await expect(response).toBeApiError(422, 'amount_mismatch');
    });
  });

  test.describe('authentication and authorization', () => {
    test('rejects requests without an API key', { tag: '@regression' }, async ({ payments }) => {
      const response = await payments.createPaymentRaw({}, { apiKey: null });
      await expect(response).toBeApiError(401, 'unauthorized');
    });

    test('rejects an invalid API key', { tag: '@regression' }, async ({ payments }) => {
      await expect(await payments.createPaymentRaw({}, { apiKey: 'sk_test_wrong' })).toBeApiError(
        401,
        'unauthorized',
      );
    });

    test(
      'a read-only key can read payments but not create them',
      { tag: '@regression' },
      async ({ payments }) => {
        const order = await payments.createOrder(buildOrder());
        const body = { orderId: order.id, amount: order.amount, currency: order.currency, card: buildCard() };
        const payment = await payments.createPayment(body);

        const read = await payments.getPayment(payment.id, env.PAYMENT_READONLY_KEY);
        expect(read.status()).toBe(200);
        const write = await payments.createPaymentRaw(body, { apiKey: env.PAYMENT_READONLY_KEY });
        await expect(write).toBeApiError(403, 'forbidden');
      },
    );
  });
});
