import type { APIRequestContext, APIResponse } from '@playwright/test';
import { z } from 'zod';
import { parseBody } from '@/api/api-response';
import type { CardInput, OrderInput } from '@/data/payment.factory';
import { uniqueId } from '@/data/unique';
import { pollUntil } from '@/utils/wait';

export const PaymentSchema = z.strictObject({
  id: z.string().startsWith('pay_'),
  orderId: z.string(),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  status: z.enum(['processing', 'succeeded', 'failed']),
  failureCode: z.string().nullable(),
  cardLast4: z.string().length(4),
  createdAt: z.iso.datetime(),
});

export const OrderSchema = z.strictObject({
  id: z.string(),
  customerEmail: z.email(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.enum(['awaiting_payment', 'payment_processing', 'payment_failed', 'paid']),
  paymentId: z.string().nullable(),
  lastAppliedSequence: z.number().int(),
  appliedEvents: z.array(z.string()),
  ignoredEvents: z.array(z.object({ id: z.string(), reason: z.literal('stale') })),
  duplicateDeliveries: z.number().int(),
  emailsSent: z.array(z.enum(['confirmation', 'payment_failed'])),
  customerConfirmed: z.boolean(),
});

export const EventSchema = z.object({
  id: z.string().startsWith('evt_'),
  type: z.enum(['payment.processing', 'payment.succeeded', 'payment.failed']),
  sequence: z.number().int().positive(),
  created: z.iso.datetime(),
  data: z.object({
    paymentId: z.string(),
    orderId: z.string(),
    status: z.string(),
    amount: z.number(),
    failureCode: z.string().nullable(),
  }),
});

export const EventRecordSchema = z.object({
  event: EventSchema,
  deliveries: z.array(
    z.object({
      attempt: z.number().int(),
      status: z.union([z.number(), z.literal('network_error')]),
      at: z.string(),
    }),
  ),
});

export const SubscriptionSchema = z.strictObject({
  id: z.string().startsWith('sub_'),
  customerEmail: z.email(),
  plan: z.enum(['basic', 'pro', 'enterprise']),
  quantity: z.number().int(),
  status: z.enum(['active', 'canceled']),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});

export const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export type Payment = z.infer<typeof PaymentSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type PaymentEvent = z.infer<typeof EventSchema>;
export type EventRecord = z.infer<typeof EventRecordSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type ApiError = z.infer<typeof ErrorSchema>;

export interface CreatePaymentRequest {
  orderId: string;
  amount: number;
  currency: string;
  card: CardInput;
}

/**
 * Client for the local payment simulator. Methods returning `APIResponse` are used where the
 * test asserts on status codes; the typed helpers parse and validate successful responses.
 */
export class PaymentClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly apiKey: string,
  ) {}

  private auth(key = this.apiKey): Record<string, string> {
    return { authorization: `Bearer ${key}` };
  }

  // ----- merchant -----
  async createOrder(order: OrderInput): Promise<Order> {
    return parseBody(await this.request.post('/merchant/orders', { data: order }), OrderSchema);
  }

  async getOrder(orderId: string): Promise<Order> {
    return parseBody(await this.request.get(`/merchant/orders/${encodeURIComponent(orderId)}`), OrderSchema);
  }

  /** Polls the merchant order until it satisfies `predicate` (webhooks are asynchronous). */
  async waitForOrder(
    orderId: string,
    predicate: (order: Order) => boolean,
    description: string,
    timeoutMs = 10_000,
  ) {
    return pollUntil(() => this.getOrder(orderId), predicate, { timeoutMs, description });
  }

  // ----- provider: payments -----
  createPaymentRaw(
    body: CreatePaymentRequest | Record<string, unknown>,
    {
      idempotencyKey = uniqueId('idem'),
      apiKey,
    }: { idempotencyKey?: string | null; apiKey?: string | null } = {},
  ): Promise<APIResponse> {
    const headers: Record<string, string> = apiKey === null ? {} : this.auth(apiKey ?? this.apiKey);
    if (idempotencyKey !== null) headers['idempotency-key'] = idempotencyKey;
    return this.request.post('/v1/payments', { data: body, headers });
  }

  async createPayment(body: CreatePaymentRequest, idempotencyKey = uniqueId('idem')): Promise<Payment> {
    return parseBody(await this.createPaymentRaw(body, { idempotencyKey }), PaymentSchema);
  }

  /**
   * Client-side resilience pattern under test: retry transient (5xx) failures with the SAME
   * idempotency key so a retry can never create a second charge.
   */
  async createPaymentWithRetry(
    body: CreatePaymentRequest,
    { idempotencyKey = uniqueId('idem'), maxAttempts = 4 } = {},
  ): Promise<{ payment: Payment; attempts: number }> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await this.createPaymentRaw(body, { idempotencyKey });
      if (response.status() < 500) {
        return { payment: await parseBody(response, PaymentSchema), attempts: attempt };
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt)); // exponential backoff
      }
    }
    throw new Error(`Payment still failing after ${maxAttempts} attempts`);
  }

  async getPayment(paymentId: string, apiKey?: string): Promise<APIResponse> {
    return this.request.get(`/v1/payments/${paymentId}`, { headers: this.auth(apiKey) });
  }

  async listEvents(orderId: string): Promise<EventRecord[]> {
    const response = await this.request.get('/v1/events', { params: { orderId }, headers: this.auth() });
    return (await parseBody(response, z.object({ data: z.array(EventRecordSchema) }))).data;
  }

  // ----- provider: subscriptions -----
  async createSubscription(input: { customerEmail: string; plan: Subscription['plan']; quantity: number }) {
    return parseBody(
      await this.request.post('/v1/subscriptions', { data: input, headers: this.auth() }),
      SubscriptionSchema,
    );
  }

  async getSubscription(id: string): Promise<Subscription> {
    return parseBody(
      await this.request.get(`/v1/subscriptions/${id}`, { headers: this.auth() }),
      SubscriptionSchema,
    );
  }

  updateSubscription(
    id: string,
    changes: Partial<Pick<Subscription, 'plan' | 'quantity'>>,
    version: number | null,
  ): Promise<APIResponse> {
    const headers = { ...this.auth(), ...(version === null ? {} : { 'if-match': `"${version}"` }) };
    return this.request.patch(`/v1/subscriptions/${id}`, { data: changes, headers });
  }

  cancelSubscription(id: string, version: number): Promise<APIResponse> {
    return this.request.post(`/v1/subscriptions/${id}/cancel`, {
      headers: { ...this.auth(), 'if-match': `"${version}"` },
    });
  }

  // ----- test control plane -----
  async injectFaults(
    orderId: string,
    faults: { paymentApiFailures?: number; merchantWebhookFailures?: number },
  ) {
    const response = await this.request.post('/__control/faults', { data: { orderId, ...faults } });
    if (!response.ok())
      throw new Error(`Fault injection failed: ${response.status()} ${await response.text()}`);
  }

  async redeliverEvent(eventId: string): Promise<void> {
    const response = await this.request.post(`/__control/events/${eventId}/redeliver`);
    if (response.status() !== 202) throw new Error(`Redelivery failed: ${response.status()}`);
  }
}
