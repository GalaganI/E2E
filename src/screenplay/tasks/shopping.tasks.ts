import { expect } from '@playwright/test';
import { activity, type Activity } from '../core/actor';
import { BrowseTheWeb } from '../abilities/browse-the-web';
import type { ShopCard } from '@/data/payment.factory';

export interface CartItem {
  productId: number;
  quantity: number;
}

export const AddToCart = {
  product: (productId: number, quantity = 1): Activity =>
    activity(`adds ${quantity} x product #${productId} to the cart`, async (actor) => {
      const { shop } = BrowseTheWeb.as(actor);
      await shop.productDetails.openProduct(productId);
      await shop.productDetails.addToCart(quantity);
    }),

  items: (items: CartItem[]): Activity =>
    activity(`adds ${items.length} product(s) to the cart`, async (actor) => {
      for (const item of items) await actor.attemptsTo(AddToCart.product(item.productId, item.quantity));
    }),
};

export const ProceedToCheckout = activity('proceeds to checkout', async (actor) => {
  const { shop, page } = BrowseTheWeb.as(actor);
  await shop.cart.open();
  await shop.cart.proceedToCheckout();
  await expect(page).toHaveURL(/\/checkout$/);
});

export const PlaceOrder = {
  payingWith: (card: ShopCard, comment = 'Automated E2E order'): Activity =>
    activity(`places the order paying with card ending ${card.number.slice(-4)}`, async (actor) => {
      const { shop, page } = BrowseTheWeb.as(actor);
      await shop.checkout.placeOrder(comment);
      await expect(page).toHaveURL(/\/payment$/);
      await shop.payment.fillCard(card);
      await shop.payment.submit();
      await expect(page).toHaveURL(/\/payment_done\/\d+/);
    }),
};
