import type { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';
import { AddedToCartModal } from './components/added-to-cart.modal';

export class ProductsPage extends BasePage {
  protected readonly path = '/products';

  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly listTitle: Locator;
  readonly productCards: Locator;
  readonly productNames: Locator;
  readonly addedModal: AddedToCartModal;

  constructor(page: Page) {
    super(page);
    this.searchInput = page.locator('#search_product');
    this.searchButton = page.locator('#submit_search');
    this.listTitle = page.locator('.features_items h2.title');
    this.productCards = page.locator('.features_items .product-image-wrapper');
    this.productNames = this.productCards.locator('.productinfo p');
    this.addedModal = new AddedToCartModal(page);
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await this.searchButton.click();
  }

  async openCategory(userType: 'Women' | 'Men' | 'Kids', category: string): Promise<void> {
    await this.page.locator('#accordian').getByRole('link', { name: userType }).click();
    await this.page.locator(`#${userType}`).getByRole('link', { name: category, exact: true }).click();
  }

  async openBrand(brand: string): Promise<void> {
    await this.page
      .locator('.brands-name')
      .getByRole('link', { name: new RegExp(`${escapeRegExp(brand)}$`) })
      .click();
  }

  card(productId: number): Locator {
    return this.productCards.filter({
      has: this.page.locator(`.productinfo [data-product-id="${productId}"]`),
    });
  }

  /** Adds a product from the grid and dismisses the confirmation modal. */
  async addToCart(productId: number): Promise<void> {
    await this.card(productId).locator('.productinfo .add-to-cart').click();
    await this.addedModal.continueShopping();
  }

  async openDetails(productId: number): Promise<void> {
    await this.card(productId).getByRole('link', { name: 'View Product' }).click();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
