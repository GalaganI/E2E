import type { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';
import { readCartLines, type CartLine } from './cart.page';
import { parseRupees } from '@/utils/money';

export class CheckoutPage extends BasePage {
  protected readonly path = '/checkout';

  readonly deliveryAddress: Locator;
  readonly billingAddress: Locator;
  readonly reviewRows: Locator;
  readonly totalAmount: Locator;
  readonly commentInput: Locator;
  readonly placeOrderButton: Locator;

  constructor(page: Page) {
    super(page);
    this.deliveryAddress = page.locator('#address_delivery');
    this.billingAddress = page.locator('#address_invoice');
    this.reviewRows = page.locator('#cart_info tbody tr[id^="product-"]');
    this.totalAmount = page
      .locator('#cart_info tbody tr')
      .filter({ hasText: 'Total Amount' })
      .locator('.cart_total_price');
    this.commentInput = page.locator('textarea[name="message"]');
    this.placeOrderButton = page.getByRole('link', { name: 'Place Order' });
  }

  async lines(): Promise<CartLine[]> {
    return readCartLines(this.reviewRows);
  }

  async total(): Promise<number> {
    return parseRupees(await this.totalAmount.innerText());
  }

  async placeOrder(comment?: string): Promise<void> {
    if (comment) await this.commentInput.fill(comment);
    await this.placeOrderButton.click();
  }
}
