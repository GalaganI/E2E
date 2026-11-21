import { test, expect } from '@/fixtures';
import { buildShopCard } from '@/data/payment.factory';
import {
  AddToCart,
  BrowseTheWeb,
  CartContents,
  CheckoutSummary,
  Login,
  Navigate,
  OrderConfirmation,
  PlaceOrder,
  ProceedToCheckout,
  RegisterAccount,
} from '@/screenplay';
import { buildUser } from '@/data/user.factory';

/*
 * Checkout, written in the Screenplay style: multi-page business flows read as a sequence of
 * tasks performed by an actor, and every task appears as a named step in the report.
 */
test.describe('Checkout', { tag: '@ui' }, () => {
  test.beforeEach(async ({ actorCalled, registeredUser }) => {
    await actorCalled('Quinn').attemptsTo(
      Login.withCredentials(registeredUser.email, registeredUser.password),
    );
  });

  test(
    'customer completes checkout and receives an order confirmation',
    { tag: '@smoke' },
    async ({ actorCalled }) => {
      const quinn = actorCalled('Quinn');
      await quinn.attemptsTo(
        AddToCart.items([
          { productId: 1, quantity: 2 },
          { productId: 3, quantity: 1 },
        ]),
        ProceedToCheckout,
      );

      const summary = await quinn.asks(CheckoutSummary);
      expect(summary.lines.map((l) => [l.productId, l.quantity])).toEqual([
        [1, 2],
        [3, 1],
      ]);
      expect(summary.total).toBe(summary.lines.reduce((sum, l) => sum + l.lineTotal, 0));

      await quinn.attemptsTo(PlaceOrder.payingWith(buildShopCard()));

      const confirmation = await quinn.asks(OrderConfirmation);
      expect(confirmation.heading).toBe('Order Placed!');
      expect(confirmation.chargedAmount).toBe(summary.total);
      expect(await quinn.asks(CartContents), 'cart must be emptied after the order').toEqual([]);
    },
  );

  test(
    'checkout shows the registered delivery address',
    { tag: '@regression' },
    async ({ actorCalled, registeredUser }) => {
      const quinn = actorCalled('Quinn');
      await quinn.attemptsTo(AddToCart.product(2), ProceedToCheckout);

      const { shop } = BrowseTheWeb.as(quinn);
      const address = shop.checkout.deliveryAddress;
      await expect(address).toContainText(`${registeredUser.firstName} ${registeredUser.lastName}`);
      await expect(address).toContainText(registeredUser.address1);
      await expect(address).toContainText(
        `${registeredUser.city} ${registeredUser.state} ${registeredUser.zipcode}`,
      );
      await expect(address).toContainText(registeredUser.country);
    },
  );

  test(
    'payment form blocks submission until every card field is filled',
    { tag: '@regression' },
    async ({ actorCalled, page }) => {
      const quinn = actorCalled('Quinn');
      await quinn.attemptsTo(AddToCart.product(2), ProceedToCheckout);
      const { shop } = BrowseTheWeb.as(quinn);
      await shop.checkout.placeOrder();

      const card = buildShopCard();
      const fields = [
        ['name_on_card', { nameOnCard: card.nameOnCard }],
        ['card_number', { number: card.number }],
        ['cvc', { cvc: card.cvc }],
        ['expiry_month', { expMonth: card.expMonth }],
        ['expiry_year', { expYear: card.expYear }],
      ] as const;

      for (const [fieldName, value] of fields) {
        await shop.payment.submit();
        await expect(page, `submission must be blocked while ${fieldName} is empty`).toHaveURL(/\/payment$/);
        expect((await shop.payment.firstValidationError())?.field).toBe(fieldName);
        await shop.payment.fillCard(value);
      }

      expect(await shop.payment.firstValidationError()).toBeNull();
      await shop.payment.submit();
      await expect(page).toHaveURL(/\/payment_done\/\d+/);
    },
  );

  test(
    'customer recovers from a failed payment submission',
    { tag: '@regression' },
    async ({ actorCalled, page }) => {
      const quinn = actorCalled('Quinn');
      await quinn.attemptsTo(AddToCart.product(5, 2), ProceedToCheckout);
      const { shop } = BrowseTheWeb.as(quinn);
      const { total } = await quinn.asks(CheckoutSummary);
      await shop.checkout.placeOrder();

      // Fault injection: the first payment submission never reaches the shop and gets a 503.
      // Fulfilling (rather than aborting) keeps the failure deterministic in every browser:
      // an aborted navigation lands on a browser-specific error page that races later navigations.
      let failed = 0;
      await page.route('**/payment', async (route) => {
        if (route.request().method() === 'POST' && failed === 0) {
          failed += 1;
          await route.fulfill({
            status: 503,
            contentType: 'text/html',
            body: '<h1>Service Unavailable</h1>',
          });
        } else {
          await route.fallback();
        }
      });
      await shop.payment.fillCard(buildShopCard());
      await shop.payment.submit();
      await expect(page.getByRole('heading', { name: 'Service Unavailable' })).toBeVisible();
      expect(failed).toBe(1);

      // Nothing was charged: the cart is intact and the customer can simply retry.
      expect((await quinn.asks(CartContents)).map((l) => [l.productId, l.quantity])).toEqual([[5, 2]]);
      await quinn.attemptsTo(ProceedToCheckout, PlaceOrder.payingWith(buildShopCard()));
      expect((await quinn.asks(OrderConfirmation)).chargedAmount).toBe(total);
    },
  );

  test(
    'a completed order cannot be submitted twice',
    { tag: '@regression' },
    async ({ actorCalled, page }) => {
      const quinn = actorCalled('Quinn');
      await quinn.attemptsTo(AddToCart.product(4), ProceedToCheckout, PlaceOrder.payingWith(buildShopCard()));
      const confirmationUrl = page.url();

      // Browser "back" returns to the payment form, but the cart that produced the order is gone.
      await page.goBack();
      expect(await quinn.asks(CartContents)).toEqual([]);
      const { shop } = BrowseTheWeb.as(quinn);
      await expect(shop.cart.proceedToCheckoutButton).toBeHidden();

      // Reloading the confirmation page does not create another order (it is a GET).
      await page.goto(confirmationUrl);
      await expect(shop.confirmation.heading).toBeVisible();
      expect(await quinn.asks(CartContents)).toEqual([]);
    },
  );

  test(
    'payment with an empty cart is rejected',
    {
      tag: ['@regression', '@known-defect'],
      annotation: {
        type: 'known defect',
        description:
          'Demo app accepts POST /payment with an empty cart and shows "Order Placed!" for amount 0.',
      },
    },
    async ({ actorCalled, page }) => {
      test.fail();
      const quinn = actorCalled('Quinn');
      await quinn.attemptsTo(Navigate.to('/payment'));
      const { shop } = BrowseTheWeb.as(quinn);
      await shop.payment.fillCard(buildShopCard());
      await shop.payment.submit();
      await expect(page).not.toHaveURL(/\/payment_done\//, { timeout: 5_000 });
    },
  );
});

test.describe('Checkout for a brand-new customer', { tag: '@ui' }, () => {
  test(
    'customer registered via API can buy immediately',
    { tag: '@regression' },
    async ({ actorCalled, aeApi }) => {
      const user = buildUser();
      const alex = actorCalled('Alex');
      try {
        await alex.attemptsTo(
          RegisterAccount.viaApi(user),
          Login.withCredentials(user.email, user.password),
          AddToCart.product(7),
          ProceedToCheckout,
          PlaceOrder.payingWith(buildShopCard({ nameOnCard: `${user.firstName} ${user.lastName}` })),
        );
        expect((await alex.asks(OrderConfirmation)).heading).toBe('Order Placed!');
      } finally {
        await aeApi.deleteAccount(user.email, user.password);
      }
    },
  );
});
