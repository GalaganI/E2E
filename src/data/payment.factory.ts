import { uniqueEmail, uniqueId } from './unique';

/** Mirrors services/payment/cards.ts. Kept separate: tests treat the simulator as a black box. */
export const TestCards = {
  success: '4242424242424242',
  declined: '4000000000000002',
  insufficientFunds: '4000000000009995',
  delayedConfirmation: '4000000000000259',
  luhnInvalid: '4242424242424241',
} as const;

export interface CardInput {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
}

export interface OrderInput {
  orderId: string;
  customerEmail: string;
  amount: number;
  currency: string;
}

export function buildCard(number: string = TestCards.success, overrides: Partial<CardInput> = {}): CardInput {
  return { number, expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123', ...overrides };
}

export function buildOrder(overrides: Partial<OrderInput> = {}): OrderInput {
  return {
    orderId: uniqueId('ord'),
    customerEmail: uniqueEmail('buyer'),
    amount: 4599,
    currency: 'USD',
    ...overrides,
  };
}

/** Card details for the demo shop's checkout form, which accepts any value (no real charge). */
export interface ShopCard {
  nameOnCard: string;
  number: string;
  cvc: string;
  expMonth: string;
  expYear: string;
}

export function buildShopCard(overrides: Partial<ShopCard> = {}): ShopCard {
  return {
    nameOnCard: 'Quinn Archer',
    number: TestCards.success,
    cvc: '123',
    expMonth: '12',
    expYear: String(new Date().getFullYear() + 3),
    ...overrides,
  };
}
