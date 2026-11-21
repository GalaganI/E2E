import { expect } from '@playwright/test';
import { Given, When, Then } from './fixtures';
import { buildCard, buildOrder, TestCards } from '@/data/payment.factory';
import type { Order } from '@/integrations/payment.client';
import { WebhookSimulator } from '@/integrations/webhook.simulator';

/*
 * Scenario state (the current order) is keyed by test id, so scenarios stay independent
 * when workers run them in parallel.
 */
const orders = new Map<string, Order>();
const currentOrder = (testId: string): Order => {
  const order = orders.get(testId);
  if (!order) throw new Error('No order in this scenario; add "Given an order awaiting payment"');
  return order;
};

const cards = { success: TestCards.success, declined: TestCards.declined } as const;

Given('an order awaiting payment', async ({ payments, $testInfo }) => {
  orders.set($testInfo.testId, await payments.createOrder(buildOrder()));
});

Given(
  'the merchant back-end fails the next {int} webhook deliveries',
  async ({ payments, $testInfo }, count: number) => {
    await payments.injectFaults(currentOrder($testInfo.testId).id, { merchantWebhookFailures: count });
  },
);

When('the customer pays with the {string} test card', async ({ payments, $testInfo }, card: string) => {
  if (!(card in cards))
    throw new Error(`Unknown test card "${card}". Use one of: ${Object.keys(cards).join(', ')}`);
  const number = cards[card as keyof typeof cards];
  const order = currentOrder($testInfo.testId);
  await payments.createPayment({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    card: buildCard(number),
  });
});

Given('the provider has confirmed the payment', async ({ payments, $testInfo }) => {
  const order = currentOrder($testInfo.testId);
  await payments.createPayment({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    card: buildCard(),
  });
  await payments.waitForOrder(order.id, (o) => o.status === 'paid', 'order paid');
});

When('the {string} event is delivered again', async ({ payments, $testInfo }, kind: string) => {
  const records = await payments.listEvents(currentOrder($testInfo.testId).id);
  const record = records.find((r) => r.event.type === `payment.${kind}`);
  if (!record) throw new Error(`No payment.${kind} event found`);
  await payments.redeliverEvent(record.event.id);
});

When('a stale {string} event arrives late', async ({ webhooks, $testInfo }, kind: string) => {
  if (kind !== 'processing' && kind !== 'failed') throw new Error(`Unsupported stale event "${kind}"`);
  await webhooks.deliver(WebhookSimulator.event(currentOrder($testInfo.testId).id, `payment.${kind}`, 1));
});

Then('the order status becomes {string}', async ({ payments, $testInfo }, status: string) => {
  const order = await payments.waitForOrder(
    currentOrder($testInfo.testId).id,
    (o) => o.status === status,
    `status ${status}`,
  );
  expect(order.status).toBe(status);
});

Then('the order is still {string}', async ({ payments, $testInfo }, status: string) => {
  expect((await payments.getOrder(currentOrder($testInfo.testId).id)).status).toBe(status);
});

Then(
  'the customer receives an e-mail with subject starting {string}',
  async ({ mailpit, $testInfo }, subject: string) => {
    const mail = await mailpit.waitForMessage({ to: currentOrder($testInfo.testId).customerEmail });
    expect(mail.Subject.startsWith(subject)).toBe(true);
  },
);

Then('exactly one confirmation e-mail was sent', async ({ payments, mailpit, $testInfo }) => {
  const order = currentOrder($testInfo.testId);
  expect((await payments.getOrder(order.id)).emailsSent).toEqual(['confirmation']);
  expect(await mailpit.waitForMessages({ to: order.customerEmail, subject: 'confirmed' })).toHaveLength(1);
});

Then('the provider made {int} delivery attempts', async ({ payments, $testInfo }, attempts: number) => {
  const [record] = await payments.listEvents(currentOrder($testInfo.testId).id);
  expect(record?.deliveries).toHaveLength(attempts);
});
