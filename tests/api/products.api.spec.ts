import { test, expect } from '@/fixtures';
import { BrandsResponseSchema, ProductSchema } from '@/api/schemas/automation-exercise.schemas';

test.describe('Products API', { tag: ['@api'] }, () => {
  test(
    'GET productsList returns the catalogue matching the contract',
    { tag: '@smoke' },
    async ({ aeApi }) => {
      const products = await aeApi.getProducts(); // parseBody enforces the strict schema

      expect(products.length).toBeGreaterThan(0);
      for (const product of products) expect(product).toMatchSchema(ProductSchema);
      const ids = products.map((p) => p.id);
      expect(new Set(ids).size, 'product ids must be unique').toBe(ids.length);
    },
  );

  test('POST productsList is rejected with 405', { tag: '@regression' }, async ({ aeApi }) => {
    expect(await aeApi.raw('POST', '/api/productsList')).toEqual({
      responseCode: 405,
      message: 'This request method is not supported.',
    });
  });

  test(
    'GET brandsList matches the contract and covers every product brand',
    { tag: '@regression' },
    async ({ aeApi, request }) => {
      const response = await request.get('/api/brandsList');
      expect(response.ok()).toBe(true);
      expect((await response.json()) as unknown).toMatchSchema(BrandsResponseSchema);

      const brandNames = new Set((await aeApi.getBrands()).map((b) => b.brand));
      const productBrands = new Set((await aeApi.getProducts()).map((p) => p.brand));
      for (const brand of productBrands)
        expect(brandNames, `brand "${brand}" missing from brandsList`).toContain(brand);
    },
  );

  test('PUT brandsList is rejected with 405', { tag: '@regression' }, async ({ aeApi }) => {
    expect((await aeApi.raw('PUT', '/api/brandsList')).responseCode).toBe(405);
  });

  for (const term of ['top', 'jean', 'tshirt']) {
    test(
      `searchProduct "${term}" returns only matching catalogue items`,
      { tag: '@regression' },
      async ({ aeApi }) => {
        const [results, catalogue] = await Promise.all([aeApi.searchProducts(term), aeApi.getProducts()]);

        expect(results.length).toBeGreaterThan(0);
        const catalogueById = new Map(catalogue.map((p) => [p.id, p]));
        for (const product of results) {
          const haystack = `${product.name} ${product.category.category}`.toLowerCase();
          expect(haystack, `"${product.name}" does not match "${term}"`).toContain(term);
          // Data consistency: search results must be identical to the catalogue records.
          expect(product).toEqual(catalogueById.get(product.id));
        }
      },
    );
  }

  test(
    'searchProduct with an unmatched term returns an empty list',
    { tag: '@regression' },
    async ({ aeApi }) => {
      expect(await aeApi.searchProducts('zz-no-such-product-zz')).toEqual([]);
    },
  );

  test('searchProduct without search_product returns 400', { tag: '@regression' }, async ({ aeApi }) => {
    expect(await aeApi.raw('POST', '/api/searchProduct')).toEqual({
      responseCode: 400,
      message: 'Bad request, search_product parameter is missing in POST request.',
    });
  });

  test('concurrent catalogue reads return identical data', { tag: '@regression' }, async ({ aeApi }) => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => aeApi.getProducts()));
    for (const products of responses.slice(1)) expect(products).toEqual(responses[0]);
  });
});
