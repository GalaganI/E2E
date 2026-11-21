import type { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';
import { parseRupees } from '@/utils/money';

export interface CartLine {
  productId: number;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

/** Reads order lines from a cart-style table; shared by the cart and checkout review pages. */
export async function readCartLines(rows: Locator): Promise<CartLine[]> {
  const lines: CartLine[] = [];
  for (const row of await rows.all()) {
    const rowId = (await row.getAttribute('id')) ?? '';
    lines.push({
      productId: Number(rowId.replace('product-', '')),
      name: (await row.locator('.cart_description h4').innerText()).trim(),
      unitPrice: parseRupees(await row.locator('.cart_price').innerText()),
      quantity: Number((await row.locator('.cart_quantity').innerText()).trim()),
      lineTotal: parseRupees(await row.locator('.cart_total').innerText()),
    });
  }
  return lines;
}

export class CartPage extends BasePage {
  protected readonly path = '/view_cart';

  readonly rows: Locator;
  readonly emptyCartMessage: Locator;
  readonly proceedToCheckoutButton: Locator;
  readonly checkoutModal: Locator;
  readonly checkoutModalLoginLink: Locator;

  constructor(page: Page) {
    super(page);
    this.rows = page.locator('#cart_info_table tbody tr[id^="product-"]');
    this.emptyCartMessage = page.locator('#empty_cart');
    this.proceedToCheckoutButton = page.getByText('Proceed To Checkout');
    this.checkoutModal = page.locator('#checkoutModal');
    this.checkoutModalLoginLink = this.checkoutModal.getByRole('link', { name: 'Register / Login' });
  }

  row(productId: number): Locator {
    return this.page.locator(`#cart_info_table tr#product-${productId}`);
  }

  quantityOf(productId: number): Locator {
    return this.row(productId).locator('.cart_quantity');
  }

  async lines(): Promise<CartLine[]> {
    return readCartLines(this.rows);
  }

  async remove(productId: number): Promise<void> {
    await this.row(productId).locator('.cart_quantity_delete').click();
    await this.row(productId).waitFor({ state: 'detached' });
  }

  async proceedToCheckout(): Promise<void> {
    await this.proceedToCheckoutButton.click();
  }
}
