import { test, expect } from '@/fixtures';
import { parseRupees } from '@/utils/money';

test.describe('Shopping cart', { tag: '@ui' }, () => {
  test('products can be added to and removed from the cart', { tag: '@smoke' }, async ({ shop }) => {
    await shop.products.open();
    await shop.products.addToCart(1);
    await shop.products.addToCart(3);

    await shop.cart.open();
    await expect(shop.cart.rows).toHaveCount(2);

    await shop.cart.remove(1);
    await expect(shop.cart.rows).toHaveCount(1);
    await expect(shop.cart.row(3)).toBeVisible();

    await shop.cart.remove(3);
    await expect(shop.cart.emptyCartMessage).toBeVisible();
  });

  test('adding the same product again increases its quantity', { tag: '@regression' }, async ({ shop }) => {
    // The demo cart has no quantity editor: quantity is set on the product page and accumulates.
    await shop.productDetails.openProduct(2);
    await shop.productDetails.addToCart(3);
    await shop.productDetails.addToCart(2);

    await shop.cart.open();
    await expect(shop.cart.rows).toHaveCount(1);
    await expect(shop.cart.quantityOf(2)).toHaveText('5');
  });

  test(
    'line totals equal catalogue price multiplied by quantity',
    { tag: '@regression' },
    async ({ shop, aeApi }) => {
      const items = [
        { productId: 1, quantity: 2 },
        { productId: 5, quantity: 1 },
        { productId: 8, quantity: 3 },
      ];
      const catalogue = new Map((await aeApi.getProducts()).map((p) => [p.id, parseRupees(p.price)]));

      for (const item of items) {
        await shop.productDetails.openProduct(item.productId);
        await shop.productDetails.addToCart(item.quantity);
      }
      await shop.cart.open();
      const lines = await shop.cart.lines();

      expect(lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))).toEqual(items);
      for (const line of lines) {
        expect(line.unitPrice, `unit price of #${line.productId}`).toBe(catalogue.get(line.productId));
        expect(line.lineTotal, `line total of #${line.productId}`).toBe(line.unitPrice * line.quantity);
      }
    },
  );

  test('cart survives a page reload', { tag: '@regression' }, async ({ shop, page }) => {
    await shop.products.open();
    await shop.products.addToCart(4);
    await shop.cart.open();
    await expect(shop.cart.row(4)).toBeVisible();

    await page.reload();
    await expect(shop.cart.row(4)).toBeVisible();
  });

  test(
    'a logged-in customer finds their cart again in a new session',
    { tag: '@regression' },
    async ({ shop, browser, registeredUser }) => {
      await shop.login.open();
      await shop.login.login(registeredUser.email, registeredUser.password);
      await shop.productDetails.openProduct(6);
      await shop.productDetails.addToCart(2);
      await shop.login.header.logout();

      // Fresh browser context = different device; the cart is stored server-side per account.
      const otherDevice = await browser.newContext();
      try {
        const otherPage = await otherDevice.newPage();
        await otherPage.goto('/login');
        await otherPage.locator('[data-qa="login-email"]').fill(registeredUser.email);
        await otherPage.locator('[data-qa="login-password"]').fill(registeredUser.password);
        await otherPage.locator('[data-qa="login-button"]').click();
        await otherPage.goto('/view_cart');
        await expect(otherPage.locator('#product-6 .cart_quantity')).toHaveText('2');
      } finally {
        await otherDevice.close();
      }
    },
  );
});
