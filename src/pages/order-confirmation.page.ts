import type { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';

export class OrderConfirmationPage extends BasePage {
  protected readonly path = '/payment_done';

  readonly heading: Locator;
  readonly message: Locator;
  readonly downloadInvoiceLink: Locator;
  readonly continueButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.locator('[data-qa="order-placed"]');
    this.message = page.getByText('Congratulations! Your order has been confirmed!');
    this.downloadInvoiceLink = page.getByRole('link', { name: 'Download Invoice' });
    this.continueButton = page.locator('[data-qa="continue-button"]');
  }

  /** The shop encodes the charged amount in the URL: /payment_done/<amount>. */
  chargedAmountFromUrl(): number {
    const match = /\/payment_done\/(\d+)/.exec(this.page.url());
    if (!match?.[1]) throw new Error(`Not on the order confirmation page: ${this.page.url()}`);
    return Number(match[1]);
  }
}
