import type { Locator, Page } from '@playwright/test';

export class HeaderComponent {
  readonly root: Locator;
  readonly productsLink: Locator;
  readonly cartLink: Locator;
  readonly loginLink: Locator;
  readonly logoutLink: Locator;
  readonly deleteAccountLink: Locator;
  readonly loggedInAs: Locator;

  constructor(page: Page) {
    this.root = page.locator('#header');
    this.productsLink = this.root.locator('a[href="/products"]');
    this.cartLink = this.root.locator('a[href="/view_cart"]');
    this.loginLink = this.root.locator('a[href="/login"]');
    this.logoutLink = this.root.locator('a[href="/logout"]');
    this.deleteAccountLink = this.root.locator('a[href="/delete_account"]');
    this.loggedInAs = this.root.getByText(/Logged in as/);
  }

  async logout(): Promise<void> {
    await this.logoutLink.click();
  }

  async goToCart(): Promise<void> {
    await this.cartLink.click();
  }
}
