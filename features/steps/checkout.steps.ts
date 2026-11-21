import { expect } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { Given, When, Then } from './fixtures';
import { buildShopCard } from '@/data/payment.factory';
import {
  AddToCart,
  CartContents,
  CheckoutSummary,
  Login,
  OrderConfirmation,
  PlaceOrder,
  ProceedToCheckout,
} from '@/screenplay';

/* Gherkin steps are thin adapters over Screenplay tasks: no locators or logic live here. */

Given(
  '{word} is a registered customer who is logged in',
  async ({ actorCalled, registeredUser }, name: string) => {
    await actorCalled(name).attemptsTo(Login.withCredentials(registeredUser.email, registeredUser.password));
  },
);

When(
  '{word} adds the following products to the cart:',
  async ({ actorCalled }, name: string, table: DataTable) => {
    const items = table
      .hashes()
      .map((row) => ({ productId: Number(row.productId), quantity: Number(row.quantity) }));
    await actorCalled(name).attemptsTo(AddToCart.items(items));
  },
);

When('{word} proceeds to checkout', async ({ actorCalled }, name: string) => {
  await actorCalled(name).attemptsTo(ProceedToCheckout);
});

Then('the order summary lists the cart products with a matching total', async ({ actorCalled }) => {
  const quinn = actorCalled('Quinn');
  const summary = await quinn.asks(CheckoutSummary);
  expect(summary.lines.length).toBeGreaterThan(0);
  expect(summary.total).toBe(summary.lines.reduce((sum, line) => sum + line.lineTotal, 0));
  quinn.remember('orderTotal', summary.total);
});

When('{word} pays with a valid card', async ({ actorCalled }, name: string) => {
  await actorCalled(name).attemptsTo(PlaceOrder.payingWith(buildShopCard()));
});

Then('{word} sees the order confirmation for the order total', async ({ actorCalled }, name: string) => {
  const actor = actorCalled(name);
  const confirmation = await actor.asks(OrderConfirmation);
  expect(confirmation.heading).toBe('Order Placed!');
  expect(confirmation.chargedAmount).toBe(actor.recall<number>('orderTotal'));
});

Then("{word}'s cart is empty", async ({ actorCalled }, name: string) => {
  expect(await actorCalled(name).asks(CartContents)).toEqual([]);
});

Then(
  "{word}'s cart contains product {int} with quantity {int}",
  async ({ actorCalled }, name: string, productId: number, quantity: number) => {
    const lines = await actorCalled(name).asks(CartContents);
    expect(lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))).toEqual([
      { productId, quantity },
    ]);
  },
);
