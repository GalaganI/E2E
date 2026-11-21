import { test, expect } from '@/fixtures';
import { defined } from '@/utils/defined';
import { buildCard, buildOrder, TestCards } from '@/data/payment.factory';
import { MailpitClient } from '@/integrations/mailpit.client';
import { env } from '@/config/env';

/** Transactional e-mail captured by a local Mailpit SMTP server. */
test.describe('Order e-mails', { tag: ['@integration', '@email'] }, () => {
  test(
    'paid order sends a confirmation e-mail to the customer only',
    { tag: '@smoke' },
    async ({ payments, mailpit }) => {
      const order = await payments.createOrder(buildOrder({ amount: 12_550, currency: 'EUR' }));
      await payments.createPayment({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        card: buildCard(),
      });

      const mail = await mailpit.waitForMessage({
        to: order.customerEmail,
        subject: `Order ${order.id} confirmed`,
      });

      expect(mail.To.map((a) => a.Address)).toEqual([order.customerEmail]);
      expect(mail.From.Address).toBe('no-reply@demo-shop.test');
      expect(mail.Text).toContain('Amount paid: 125.50 EUR');
      expect(mail.HTML).toContain(`<strong>${order.id}</strong>`);
      const headers = await mailpit.getHeaders(mail.ID);
      expect(headers['X-Order-Id']).toEqual([order.id]);
    },
  );

  test(
    'confirmation link in the e-mail confirms the order',
    { tag: '@regression' },
    async ({ payments, mailpit, request }) => {
      const order = await payments.createOrder(buildOrder());
      await payments.createPayment({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        card: buildCard(),
      });
      const mail = await mailpit.waitForMessage({ to: order.customerEmail, subject: 'confirmed' });

      const link = defined(MailpitClient.links(mail, { anchorId: 'confirm-order' })[0], 'confirmation link');
      expect(link.startsWith(`${env.PAYMENT_SERVICE_URL}/merchant/orders/${order.id}/confirm?token=`)).toBe(
        true,
      );
      expect(mail.Text, 'plain-text part must carry the same link').toContain(link);

      const response = await request.get(link);
      expect(response.status()).toBe(200);
      expect((await payments.getOrder(order.id)).customerConfirmed).toBe(true);
    },
  );

  test(
    'a tampered confirmation token is rejected',
    { tag: '@regression' },
    async ({ payments, mailpit, request }) => {
      const order = await payments.createOrder(buildOrder());
      await payments.createPayment({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        card: buildCard(),
      });
      const mail = await mailpit.waitForMessage({ to: order.customerEmail, subject: 'confirmed' });
      const link = defined(MailpitClient.links(mail, { anchorId: 'confirm-order' })[0], 'confirmation link');

      const tampered = link.replace(/token=([0-9a-f])/, (_, c: string) => `token=${c === 'a' ? 'b' : 'a'}`);
      await expect(await request.get(tampered)).toBeApiError(403, 'invalid_token');
      expect((await payments.getOrder(order.id)).customerConfirmed).toBe(false);
    },
  );

  test(
    'declined payment e-mail explains the failure',
    { tag: '@regression' },
    async ({ payments, mailpit }) => {
      const order = await payments.createOrder(buildOrder());
      await payments.createPayment({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        card: buildCard(TestCards.insufficientFunds),
      });

      const mail = await mailpit.waitForMessage({ to: order.customerEmail, subject: 'Payment failed' });
      expect(mail.Subject).toBe(`Payment failed for order ${order.id}`);
      expect(mail.Text).toContain('(insufficient_funds)');
      expect(MailpitClient.links(mail)).toEqual([]);
    },
  );

  test(
    'e-mail sent after a delayed payment confirmation is awaited, not slept for',
    { tag: '@regression' },
    async ({ payments, mailpit }) => {
      const order = await payments.createOrder(buildOrder());
      const started = Date.now();
      await payments.createPayment({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        card: buildCard(TestCards.delayedConfirmation),
      });

      // Nothing yet: the payment is still processing.
      expect(await mailpit.search(`to:"${order.customerEmail}"`)).toEqual([]);

      const mail = await mailpit.waitForMessage(
        { to: order.customerEmail, subject: 'confirmed' },
        { timeoutMs: env.PAYMENT_CONFIRMATION_DELAY_MS + 10_000 },
      );
      expect(mail.Subject).toBe(`Order ${order.id} confirmed`);
      expect(Date.now() - started).toBeGreaterThanOrEqual(env.PAYMENT_CONFIRMATION_DELAY_MS);
    },
  );
});
