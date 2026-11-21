import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError, Router, requireBearer, type Request, type Response } from '../shared/http';
import { sendMail } from '../shared/mailer';
import { signPayload, verifySignature } from '../shared/signature';
import { serviceConfig } from '../shared/config';
import { behaviourFor, isLuhnValid } from './cards';

/*
 * One process simulates two parties so their interaction can be tested end to end:
 *
 *   Provider  (/v1/...)        - payment + subscription API, emits signed webhooks with retries
 *   Merchant  (/merchant/...)  - shop back-end: orders, webhook receiver, confirmation e-mails
 *   Control   (/__control/...) - test-only fault injection and event redelivery
 *
 * All state is in memory and keyed by IDs the tests generate, so parallel workers
 * never share records and fault injection is scoped to a single order.
 */

// ---------- Types ----------

type PaymentStatus = 'processing' | 'succeeded' | 'failed';
type OrderStatus = 'awaiting_payment' | 'payment_processing' | 'payment_failed' | 'paid';
type EventType = 'payment.processing' | 'payment.succeeded' | 'payment.failed';

interface Payment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  failureCode: string | null;
  cardLast4: string;
  createdAt: string;
}

interface PaymentEvent {
  id: string;
  type: EventType;
  sequence: number;
  created: string;
  data: {
    paymentId: string;
    orderId: string;
    status: PaymentStatus;
    amount: number;
    failureCode: string | null;
  };
}

interface Delivery {
  attempt: number;
  status: number | 'network_error';
  at: string;
}

interface Order {
  id: string;
  customerEmail: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  paymentId: string | null;
  lastAppliedSequence: number;
  appliedEvents: string[];
  ignoredEvents: { id: string; reason: 'stale' }[];
  duplicateDeliveries: number;
  emailsSent: string[];
  confirmationToken: string;
  customerConfirmed: boolean;
}

interface Subscription {
  id: string;
  customerEmail: string;
  plan: 'basic' | 'pro' | 'enterprise';
  quantity: number;
  status: 'active' | 'canceled';
  version: number;
  updatedAt: string;
}

interface Faults {
  paymentApiFailures: number;
  merchantWebhookFailures: number;
}

// ---------- State ----------

const payments = new Map<string, Payment>();
const orders = new Map<string, Order>();
const events = new Map<string, { event: PaymentEvent; deliveries: Delivery[] }>();
const subscriptions = new Map<string, Subscription>();
const idempotency = new Map<string, { requestHash: string; response: Response }>();
const sequences = new Map<string, number>();
const faults = new Map<string, Faults>();
const processedEventIds = new Set<string>();

const RETRY_SCHEDULE_MS = [200, 400, 800, 1600, 3200];
const now = (): string => new Date().toISOString();
const id = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;

function faultsFor(orderId: string): Faults {
  let entry = faults.get(orderId);
  if (!entry) {
    entry = { paymentApiFailures: 0, merchantWebhookFailures: 0 };
    faults.set(orderId, entry);
  }
  return entry;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(422, 'validation_error', 'Request validation failed', z.flattenError(result.error));
  }
  return result.data;
}

const keys = {
  [serviceConfig.paymentApiKey]: 'write',
  [serviceConfig.paymentReadonlyKey]: 'read',
} as const;

// ---------- Provider: payments ----------

const CreatePaymentSchema = z.object({
  orderId: z.string().min(1).max(64),
  amount: z.number().int().positive().max(10_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code expected'),
  card: z
    .object({
      number: z.string().regex(/^\d{12,19}$/, 'Card number must be 12-19 digits'),
      expMonth: z.number().int().min(1).max(12),
      expYear: z.number().int().min(2000).max(2100),
      cvc: z.string().regex(/^\d{3,4}$/),
    })
    .refine((c) => isLuhnValid(c.number), { message: 'Card number fails Luhn check', path: ['number'] })
    .refine((c) => new Date(c.expYear, c.expMonth) > new Date(), {
      message: 'Card is expired',
      path: ['expYear'],
    }),
});

function emit(orderId: string, type: EventType, payment: Payment): PaymentEvent {
  const sequence = (sequences.get(orderId) ?? 0) + 1;
  sequences.set(orderId, sequence);
  const event: PaymentEvent = {
    id: id('evt'),
    type,
    sequence,
    created: now(),
    data: {
      paymentId: payment.id,
      orderId,
      status: payment.status,
      amount: payment.amount,
      failureCode: payment.failureCode,
    },
  };
  events.set(event.id, { event, deliveries: [] });
  void deliver(event.id, 0);
  return event;
}

/** Delivers an event to the merchant, retrying with backoff on non-2xx or network errors. */
async function deliver(eventId: string, attemptIndex: number): Promise<void> {
  const record = events.get(eventId);
  if (!record) return;
  const rawBody = JSON.stringify(record.event);
  let status: number | 'network_error';
  try {
    const res = await fetch(`http://127.0.0.1:${serviceConfig.paymentPort}/merchant/webhooks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': signPayload(rawBody, serviceConfig.webhookSecret),
      },
      body: rawBody,
    });
    status = res.status;
  } catch {
    status = 'network_error';
  }
  record.deliveries.push({ attempt: record.deliveries.length + 1, status, at: now() });
  const ok = typeof status === 'number' && status >= 200 && status < 300;
  const delay = RETRY_SCHEDULE_MS[attemptIndex];
  if (!ok && delay !== undefined) {
    setTimeout(() => void deliver(eventId, attemptIndex + 1), delay);
  }
}

function createPayment(req: Request): Response {
  requireBearer(req, keys, 'write');
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 8) {
    throw new HttpError(400, 'idempotency_key_required', 'Idempotency-Key header (min 8 chars) is required');
  }
  const input = parse(CreatePaymentSchema, req.body);

  const requestHash = createHash('sha256').update(req.rawBody).digest('hex');
  const cached = idempotency.get(key);
  if (cached) {
    if (cached.requestHash !== requestHash) {
      throw new HttpError(
        409,
        'idempotency_conflict',
        'Idempotency-Key was already used with a different payload',
      );
    }
    return { ...cached.response, headers: { 'idempotent-replayed': 'true' } };
  }

  // Simulated upstream outage, scoped to one order. Not cached: the client must retry.
  const orderFaults = faultsFor(input.orderId);
  if (orderFaults.paymentApiFailures > 0) {
    orderFaults.paymentApiFailures -= 1;
    throw new HttpError(503, 'service_unavailable', 'Payment processor temporarily unavailable');
  }

  const order = orders.get(input.orderId);
  if (!order) throw new HttpError(404, 'order_not_found', `Order ${input.orderId} does not exist`);
  // Duplicate checkout guard. Checked against provider state (updated synchronously), not the
  // merchant order status, which only changes once the webhook has been processed.
  const active = [...payments.values()].find((p) => p.orderId === input.orderId && p.status !== 'failed');
  if (active) {
    throw new HttpError(
      409,
      active.status === 'succeeded' ? 'order_already_paid' : 'payment_in_progress',
      `Order already has a ${active.status} payment (${active.id})`,
    );
  }
  if (order.amount !== input.amount || order.currency !== input.currency) {
    throw new HttpError(422, 'amount_mismatch', 'Payment amount or currency does not match the order');
  }

  const behaviour = behaviourFor(input.card.number);
  const payment: Payment = {
    id: id('pay'),
    orderId: input.orderId,
    amount: input.amount,
    currency: input.currency,
    status: behaviour.outcome === 'delayed' ? 'processing' : behaviour.outcome,
    failureCode: behaviour.outcome === 'failed' ? behaviour.failureCode : null,
    cardLast4: input.card.number.slice(-4),
    createdAt: now(),
  };
  payments.set(payment.id, payment);

  if (behaviour.outcome === 'delayed') {
    emit(order.id, 'payment.processing', payment);
    setTimeout(() => {
      payment.status = 'succeeded';
      emit(order.id, 'payment.succeeded', payment);
    }, serviceConfig.confirmationDelayMs);
  } else {
    emit(order.id, payment.status === 'succeeded' ? 'payment.succeeded' : 'payment.failed', payment);
  }

  const response: Response = { status: 201, body: payment };
  idempotency.set(key, { requestHash, response });
  return response;
}

function getPayment(req: Request): Response {
  requireBearer(req, keys, 'read');
  const payment = payments.get(req.params.id ?? '');
  if (!payment) throw new HttpError(404, 'payment_not_found', 'Payment not found');
  return { status: 200, body: payment };
}

function listEvents(req: Request): Response {
  requireBearer(req, keys, 'read');
  const orderId = req.query.get('orderId');
  const list = [...events.values()]
    .filter((e) => !orderId || e.event.data.orderId === orderId)
    .sort((a, b) => a.event.sequence - b.event.sequence);
  return { status: 200, body: { data: list } };
}

function getEvent(req: Request): Response {
  requireBearer(req, keys, 'read');
  const record = events.get(req.params.id ?? '');
  if (!record) throw new HttpError(404, 'event_not_found', 'Event not found');
  return { status: 200, body: record };
}

// ---------- Provider: subscriptions (optimistic concurrency) ----------

const PlanSchema = z.enum(['basic', 'pro', 'enterprise']);
const CreateSubscriptionSchema = z.object({
  customerEmail: z.email(),
  plan: PlanSchema,
  quantity: z.number().int().min(1).max(100),
});
const UpdateSubscriptionSchema = z
  .object({ plan: PlanSchema.optional(), quantity: z.number().int().min(1).max(100).optional() })
  .refine((v) => v.plan !== undefined || v.quantity !== undefined, { message: 'Nothing to update' });

function requireVersion(req: Request): number {
  const header = req.headers['if-match'];
  if (typeof header !== 'string') {
    throw new HttpError(
      428,
      'precondition_required',
      'If-Match header with the subscription version is required',
    );
  }
  const version = Number(header.replaceAll('"', ''));
  if (!Number.isInteger(version))
    throw new HttpError(400, 'invalid_if_match', 'If-Match must be an integer version');
  return version;
}

function getSubscriptionOr404(subscriptionId: string | undefined): Subscription {
  const sub = subscriptions.get(subscriptionId ?? '');
  if (!sub) throw new HttpError(404, 'subscription_not_found', 'Subscription not found');
  return sub;
}

/** Simulates storage latency between read and write, which is where lost updates happen. */
const persistenceLatency = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25));

async function updateSubscription(req: Request): Promise<Response> {
  requireBearer(req, keys, 'write');
  const expectedVersion = requireVersion(req);
  const changes = parse(UpdateSubscriptionSchema, req.body);
  const sub = getSubscriptionOr404(req.params.id);
  if (sub.status === 'canceled')
    throw new HttpError(409, 'subscription_canceled', 'Subscription is canceled');
  if (sub.version !== expectedVersion) {
    throw new HttpError(412, 'version_conflict', 'Subscription was modified by another request', {
      currentVersion: sub.version,
    });
  }
  await persistenceLatency();
  // Compare-and-set at write time: a concurrent writer may have committed during the latency window.
  if (sub.version !== expectedVersion) {
    throw new HttpError(412, 'version_conflict', 'Subscription was modified by another request', {
      currentVersion: sub.version,
    });
  }
  Object.assign(sub, changes, { version: sub.version + 1, updatedAt: now() });
  return { status: 200, body: sub, headers: { etag: `"${sub.version}"` } };
}

async function cancelSubscription(req: Request): Promise<Response> {
  requireBearer(req, keys, 'write');
  const expectedVersion = requireVersion(req);
  const sub = getSubscriptionOr404(req.params.id);
  if (sub.status === 'canceled')
    throw new HttpError(409, 'subscription_canceled', 'Subscription is already canceled');
  await persistenceLatency();
  if (sub.version !== expectedVersion) {
    throw new HttpError(412, 'version_conflict', 'Subscription was modified by another request', {
      currentVersion: sub.version,
    });
  }
  Object.assign(sub, { status: 'canceled', version: sub.version + 1, updatedAt: now() });
  return { status: 200, body: sub, headers: { etag: `"${sub.version}"` } };
}

// ---------- Merchant back-end ----------

const CreateOrderSchema = z.object({
  orderId: z.string().min(1).max(64),
  customerEmail: z.email(),
  amount: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

function orderView(order: Order): Omit<Order, 'confirmationToken'> {
  const { confirmationToken: _token, ...view } = order;
  return view;
}

function createOrder(req: Request): Response {
  const input = parse(CreateOrderSchema, req.body);
  if (orders.has(input.orderId)) throw new HttpError(409, 'order_exists', 'Order already exists');
  const order: Order = {
    id: input.orderId,
    customerEmail: input.customerEmail,
    amount: input.amount,
    currency: input.currency,
    status: 'awaiting_payment',
    paymentId: null,
    lastAppliedSequence: 0,
    appliedEvents: [],
    ignoredEvents: [],
    duplicateDeliveries: 0,
    emailsSent: [],
    confirmationToken: randomBytes(16).toString('hex'),
    customerConfirmed: false,
  };
  orders.set(order.id, order);
  return { status: 201, body: orderView(order) };
}

function getOrder(req: Request): Response {
  const order = orders.get(req.params.id ?? '');
  if (!order) throw new HttpError(404, 'order_not_found', 'Order not found');
  return { status: 200, body: orderView(order) };
}

const STATUS_BY_EVENT: Record<EventType, OrderStatus> = {
  'payment.processing': 'payment_processing',
  'payment.succeeded': 'paid',
  'payment.failed': 'payment_failed',
};

async function notifyCustomer(
  order: Order,
  kind: 'confirmation' | 'payment_failed',
  failureCode: string | null,
) {
  const amount = `${(order.amount / 100).toFixed(2)} ${order.currency}`;
  if (kind === 'confirmation') {
    const link = `${serviceConfig.paymentServiceUrl}/merchant/orders/${encodeURIComponent(order.id)}/confirm?token=${order.confirmationToken}`;
    await sendMail({
      to: order.customerEmail,
      subject: `Order ${order.id} confirmed`,
      text: `Thank you for your order ${order.id}.\nAmount paid: ${amount}\nConfirm your order: ${link}\n`,
      html: `<p>Thank you for your order <strong>${order.id}</strong>.</p><p>Amount paid: ${amount}</p><p><a id="confirm-order" href="${link}">Confirm your order</a></p>`,
      headers: { 'X-Order-Id': order.id },
    });
  } else {
    await sendMail({
      to: order.customerEmail,
      subject: `Payment failed for order ${order.id}`,
      text: `We could not process your payment for order ${order.id} (${failureCode ?? 'unknown'}). Please try another card.\n`,
      html: `<p>We could not process your payment for order <strong>${order.id}</strong> (${failureCode ?? 'unknown'}).</p><p>Please try another card.</p>`,
      headers: { 'X-Order-Id': order.id },
    });
  }
  order.emailsSent.push(kind);
}

async function receiveWebhook(req: Request): Promise<Response> {
  if (
    !verifySignature(
      req.headers['x-signature'] as string | undefined,
      req.rawBody,
      serviceConfig.webhookSecret,
    )
  ) {
    throw new HttpError(400, 'invalid_signature', 'Webhook signature verification failed');
  }
  const event = req.body as PaymentEvent;
  const order = orders.get(event.data.orderId);
  if (!order) throw new HttpError(404, 'order_not_found', 'Unknown order');

  const orderFaults = faultsFor(order.id);
  if (orderFaults.merchantWebhookFailures > 0) {
    orderFaults.merchantWebhookFailures -= 1;
    throw new HttpError(500, 'merchant_unavailable', 'Simulated merchant back-end failure');
  }

  // 1. Idempotency: the provider may deliver the same event more than once.
  if (processedEventIds.has(event.id)) {
    order.duplicateDeliveries += 1;
    return { status: 200, body: { received: true, duplicate: true } };
  }
  processedEventIds.add(event.id);

  // 2. Ordering: never let an older event overwrite newer state, and never leave "paid".
  if (event.sequence <= order.lastAppliedSequence || order.status === 'paid') {
    order.ignoredEvents.push({ id: event.id, reason: 'stale' });
    return { status: 200, body: { received: true, ignored: 'stale' } };
  }

  order.status = STATUS_BY_EVENT[event.type];
  order.paymentId = event.data.paymentId;
  order.lastAppliedSequence = event.sequence;
  order.appliedEvents.push(event.id);

  // "paid" is terminal (stale events are rejected above), so the confirmation is sent at most once.
  if (order.status === 'paid') await notifyCustomer(order, 'confirmation', null);
  if (order.status === 'payment_failed')
    await notifyCustomer(order, 'payment_failed', event.data.failureCode);

  return { status: 200, body: { received: true } };
}

function confirmOrder(req: Request): Response {
  const order = orders.get(req.params.id ?? '');
  if (!order) throw new HttpError(404, 'order_not_found', 'Order not found');
  if (req.query.get('token') !== order.confirmationToken) {
    throw new HttpError(403, 'invalid_token', 'Confirmation token is invalid');
  }
  if (order.status !== 'paid')
    throw new HttpError(409, 'order_not_paid', 'Only paid orders can be confirmed');
  order.customerConfirmed = true;
  return { status: 200, body: { orderId: order.id, customerConfirmed: true } };
}

// ---------- Test control plane ----------

const FaultsSchema = z.object({
  orderId: z.string().min(1),
  paymentApiFailures: z.number().int().min(0).max(10).optional(),
  merchantWebhookFailures: z.number().int().min(0).max(10).optional(),
});

export function createPaymentRouter(): Router {
  return new Router()
    .on('GET', '/health', () => ({ status: 200, body: { status: 'ok', service: 'payment-simulator' } }))
    .on('POST', '/v1/payments', createPayment)
    .on('GET', '/v1/payments/:id', getPayment)
    .on('GET', '/v1/events', listEvents)
    .on('GET', '/v1/events/:id', getEvent)
    .on('POST', '/v1/subscriptions', (req) => {
      requireBearer(req, keys, 'write');
      const input = parse(CreateSubscriptionSchema, req.body);
      const sub: Subscription = { id: id('sub'), ...input, status: 'active', version: 1, updatedAt: now() };
      subscriptions.set(sub.id, sub);
      return { status: 201, body: sub, headers: { etag: `"${sub.version}"` } };
    })
    .on('GET', '/v1/subscriptions/:id', (req) => {
      requireBearer(req, keys, 'read');
      const sub = getSubscriptionOr404(req.params.id);
      return { status: 200, body: sub, headers: { etag: `"${sub.version}"` } };
    })
    .on('PATCH', '/v1/subscriptions/:id', updateSubscription)
    .on('POST', '/v1/subscriptions/:id/cancel', cancelSubscription)
    .on('POST', '/merchant/orders', createOrder)
    .on('GET', '/merchant/orders/:id', getOrder)
    .on('GET', '/merchant/orders/:id/confirm', confirmOrder)
    .on('POST', '/merchant/webhooks', receiveWebhook)
    .on('POST', '/__control/faults', (req) => {
      const input = parse(FaultsSchema, req.body);
      const entry = faultsFor(input.orderId);
      entry.paymentApiFailures = input.paymentApiFailures ?? entry.paymentApiFailures;
      entry.merchantWebhookFailures = input.merchantWebhookFailures ?? entry.merchantWebhookFailures;
      return { status: 200, body: { orderId: input.orderId, ...entry } };
    })
    .on('POST', '/__control/events/:id/redeliver', async (req) => {
      const record = events.get(req.params.id ?? '');
      if (!record) throw new HttpError(404, 'event_not_found', 'Event not found');
      await deliver(record.event.id, RETRY_SCHEDULE_MS.length); // single attempt, no retry chain
      return { status: 202, body: { redelivered: record.event.id } };
    });
}
