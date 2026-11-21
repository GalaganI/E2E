import { test, expect } from '@/fixtures';
import { defined } from '@/utils/defined';

test.describe('Product catalogue', { tag: '@ui' }, () => {
  test(
    'product listing shows the full catalogue served by the API',
    { tag: '@regression' },
    async ({ shop, aeApi }) => {
      const apiProducts = await aeApi.getProducts();
      await shop.products.open();

      await expect(shop.products.listTitle).toHaveText(/All Products/i);
      await expect(shop.products.productCards).toHaveCount(apiProducts.length);
    },
  );

  test(
    'search returns the same products in the UI and the API',
    { tag: '@smoke' },
    async ({ shop, aeApi, page }) => {
      const term = 'jean';
      const expected = (await aeApi.searchProducts(term)).map((p) => p.name);

      await shop.products.open();
      await shop.products.search(term);

      await expect(page).toHaveURL(/\/products\?search=jean/);
      await expect(shop.products.listTitle).toHaveText(/Searched Products/i);
      await expect(shop.products.productNames).toHaveText(expected);
    },
  );

  test('search with no match shows an empty result list', { tag: '@regression' }, async ({ shop }) => {
    await shop.products.open();
    await shop.products.search('zz-no-such-product-zz');

    await expect(shop.products.listTitle).toHaveText(/Searched Products/i);
    await expect(shop.products.productCards).toHaveCount(0);
  });

  test(
    'category filter shows only products from that category',
    { tag: '@regression' },
    async ({ shop, aeApi, page }) => {
      const expected = (await aeApi.getProducts())
        .filter((p) => p.category.usertype.usertype === 'Women' && p.category.category === 'Dress')
        .map((p) => p.name);

      await shop.products.open();
      await shop.products.openCategory('Women', 'Dress');

      await expect(page).toHaveURL(/\/category_products\/\d+/);
      await expect(shop.products.listTitle).toHaveText(/Women - Dress Products/i);
      await expect(shop.products.productNames).toHaveText(expected);
    },
  );

  test(
    'brand filter shows only products of that brand',
    { tag: '@regression' },
    async ({ shop, aeApi, page }) => {
      const expected = (await aeApi.getProducts()).filter((p) => p.brand === 'Polo').map((p) => p.name);

      await shop.products.open();
      await shop.products.openBrand('Polo');

      await expect(page).toHaveURL(/\/brand_products\/Polo/);
      await expect(shop.products.listTitle).toHaveText(/Brand - Polo Products/i);
      await expect(shop.products.productNames).toHaveText(expected);
    },
  );

  test(
    'product details match the catalogue data and show availability',
    { tag: '@smoke' },
    async ({ shop, aeApi }) => {
      const product = defined(
        (await aeApi.getProducts()).find((p) => p.id === 2),
        'product #2 in the catalogue',
      );

      await shop.products.open();
      await shop.products.openDetails(product.id);

      const details = shop.productDetails;
      await expect(details.name).toHaveText(product.name);
      await expect(details.price).toHaveText(product.price);
      await expect(details.category).toHaveText(
        `Category: ${product.category.usertype.usertype} > ${product.category.category}`,
      );
      await expect(details.brand).toHaveText(`Brand: ${product.brand}`);
      await expect(details.availability).toHaveText('Availability: In Stock');
      await expect(details.condition).toHaveText('Condition: New');
      await expect(details.addToCartButton).toBeEnabled();
    },
  );
});
