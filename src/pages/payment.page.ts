import type { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';
import type { ShopCard } from '@/data/payment.factory';

export class PaymentPage extends BasePage {
  protected readonly path = '/payment';

  readonly form: Locator;
  readonly nameOnCard: Locator;
  readonly cardNumber: Locator;
  readonly cvc: Locator;
  readonly expiryMonth: Locator;
  readonly expiryYear: Locator;
  readonly payButton: Locator;

  constructor(page: Page) {
    super(page);
    this.form = page.locator('#payment-form');
    this.nameOnCard = page.locator('[data-qa="name-on-card"]');
    this.cardNumber = page.locator('[data-qa="card-number"]');
    this.cvc = page.locator('[data-qa="cvc"]');
    this.expiryMonth = page.locator('[data-qa="expiry-month"]');
    this.expiryYear = page.locator('[data-qa="expiry-year"]');
    this.payButton = page.locator('[data-qa="pay-button"]');
  }

  async fillCard(card: Partial<ShopCard>): Promise<void> {
    if (card.nameOnCard !== undefined) await this.nameOnCard.fill(card.nameOnCard);
    if (card.number !== undefined) await this.cardNumber.fill(card.number);
    if (card.cvc !== undefined) await this.cvc.fill(card.cvc);
    if (card.expMonth !== undefined) await this.expiryMonth.fill(card.expMonth);
    if (card.expYear !== undefined) await this.expiryYear.fill(card.expYear);
  }

  async submit(): Promise<void> {
    await this.payButton.click();
  }

  /** Returns the browser's native validation message for the first invalid field, if any. */
  async firstValidationError(): Promise<{ field: string; message: string } | null> {
    return this.form.evaluate((form: HTMLFormElement) => {
      const invalid = form.querySelector<HTMLInputElement>('input:invalid');
      return invalid ? { field: invalid.name, message: invalid.validationMessage } : null;
    });
  }
}
