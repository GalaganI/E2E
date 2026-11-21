import { createHmac } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { PaymentEvent } from './payment.client';
import { uniqueId } from '@/data/unique';

/**
 * Sends hand-crafted, correctly signed webhook events straight to the merchant endpoint.
 * This gives tests full control over delivery order, duplication and timing, which a
 * real provider sandbox cannot offer deterministically.
 */
export class WebhookSimulator {
  constructor(
    private readonly request: APIRequestContext,
    private readonly secret: string,
  ) {}

  static event(
    orderId: string,
    type: PaymentEvent['type'],
    sequence: number,
    overrides: Partial<PaymentEvent['data']> = {},
  ): PaymentEvent {
    const status = {
      'payment.processing': 'processing',
      'payment.succeeded': 'succeeded',
      'payment.failed': 'failed',
    }[type];
    return {
      id: uniqueId('evt'),
      type,
      sequence,
      created: new Date().toISOString(),
      data: {
        paymentId: uniqueId('pay'),
        orderId,
        status,
        amount: 4599,
        failureCode: type === 'payment.failed' ? 'card_declined' : null,
        ...overrides,
      },
    };
  }

  sign(rawBody: string, timestamp = Date.now()): string {
    const digest = createHmac('sha256', this.secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return `t=${timestamp},v1=${digest}`;
  }

  /** Sends the exact bytes that were signed; re-serialising would break the signature. */
  deliver(event: PaymentEvent, { signature }: { signature?: string } = {}): Promise<APIResponse> {
    const rawBody = JSON.stringify(event);
    return this.request.post('/merchant/webhooks', {
      data: rawBody,
      headers: { 'content-type': 'application/json', 'x-signature': signature ?? this.sign(rawBody) },
    });
  }

  async deliverInOrder(events: PaymentEvent[]): Promise<APIResponse[]> {
    const responses: APIResponse[] = [];
    for (const event of events) responses.push(await this.deliver(event));
    return responses;
  }
}
