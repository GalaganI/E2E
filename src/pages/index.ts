import type { Page } from '@playwright/test';
import { CartPage } from './cart.page';
import { CheckoutPage } from './checkout.page';
import { LoginPage } from './login.page';
import { OrderConfirmationPage } from './order-confirmation.page';
import { PaymentPage } from './payment.page';
import { ProductDetailsPage } from './product-details.page';
import { ProductsPage } from './products.page';

/** Page object registry for one Playwright page; created lazily by the `shop` fixture. */
export class Shop {
  readonly login: LoginPage;
  readonly products: ProductsPage;
  readonly productDetails: ProductDetailsPage;
  readonly cart: CartPage;
  readonly checkout: CheckoutPage;
  readonly payment: PaymentPage;
  readonly confirmation: OrderConfirmationPage;

  constructor(readonly page: Page) {
    this.login = new LoginPage(page);
    this.products = new ProductsPage(page);
    this.productDetails = new ProductDetailsPage(page);
    this.cart = new CartPage(page);
    this.checkout = new CheckoutPage(page);
    this.payment = new PaymentPage(page);
    this.confirmation = new OrderConfirmationPage(page);
  }
}

export {
  CartPage,
  CheckoutPage,
  LoginPage,
  OrderConfirmationPage,
  PaymentPage,
  ProductDetailsPage,
  ProductsPage,
};
export type { CartLine } from './cart.page';
