import type { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';
import { AddedToCartModal } from './components/added-to-cart.modal';

export class ProductDetailsPage extends BasePage {
  protected path = '/product_details/1';

  readonly info: Locator;
  readonly name: Locator;
  readonly category: Locator;
  readonly price: Locator;
  readonly availability: Locator;
  readonly condition: Locator;
  readonly brand: Locator;
  readonly quantityInput: Locator;
  readonly addToCartButton: Locator;
  readonly addedModal: AddedToCartModal;

  constructor(page: Page) {
    super(page);
    this.info = page.locator('.product-information');
    this.name = this.info.locator('h2');
    this.category = this.info.getByText(/^Category:/);
    this.price = this.info.locator('span > span').filter({ hasText: /^Rs\./ });
    this.availability = this.info.locator('p').filter({ hasText: 'Availability:' });
    this.condition = this.info.locator('p').filter({ hasText: 'Condition:' });
    this.brand = this.info.locator('p').filter({ hasText: 'Brand:' });
    this.quantityInput = page.locator('#quantity');
    this.addToCartButton = this.info.getByRole('button', { name: 'Add to cart' });
    this.addedModal = new AddedToCartModal(page);
  }

  async openProduct(productId: number): Promise<void> {
    this.path = `/product_details/${productId}`;
    await this.open();
  }

  async addToCart(quantity = 1): Promise<void> {
    await this.quantityInput.fill(String(quantity));
    await this.addToCartButton.click();
    await this.addedModal.continueShopping();
  }
}
