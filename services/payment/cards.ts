/**
 * Deterministic test cards. The simulator never contacts a real processor; the card
 * number alone decides the outcome, the same convention used by provider sandboxes.
 */
export type CardBehaviour =
  | { outcome: 'succeeded' }
  | { outcome: 'failed'; failureCode: 'card_declined' | 'insufficient_funds' | 'expired_card' }
  | { outcome: 'delayed' };

export const TEST_CARDS = {
  success: '4242424242424242',
  declined: '4000000000000002',
  insufficientFunds: '4000000000009995',
  delayedConfirmation: '4000000000000259',
} as const;

export function behaviourFor(cardNumber: string): CardBehaviour {
  switch (cardNumber) {
    case TEST_CARDS.declined:
      return { outcome: 'failed', failureCode: 'card_declined' };
    case TEST_CARDS.insufficientFunds:
      return { outcome: 'failed', failureCode: 'insufficient_funds' };
    case TEST_CARDS.delayedConfirmation:
      return { outcome: 'delayed' };
    default:
      return { outcome: 'succeeded' };
  }
}

/** Luhn checksum, so malformed card numbers are rejected as invalid input (422). */
export function isLuhnValid(cardNumber: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = cardNumber.length - 1; i >= 0; i -= 1) {
    let digit = Number(cardNumber[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}
