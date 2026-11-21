import type { Locator, Page } from '@playwright/test';

/** Bootstrap modal shown after "Add to cart"; it blocks clicks until dismissed. */
export class AddedToCartModal {
  readonly root: Locator;
  readonly continueButton: Locator;
  readonly viewCartLink: Locator;

  constructor(page: Page) {
    this.root = page.locator('#cartModal');
    this.continueButton = this.root.getByRole('button', { name: 'Continue Shopping' });
    this.viewCartLink = this.root.getByRole('link', { name: 'View Cart' });
  }

  async continueShopping(): Promise<void> {
    await this.continueButton.click();
    await this.root.waitFor({ state: 'hidden' });
  }
}
