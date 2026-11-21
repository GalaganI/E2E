import { test, expect } from '@/fixtures';

/*
 * Authentication, written in the Page Object style: the test drives page objects directly
 * and keeps assertions in the test, which reads well for short, screen-focused checks.
 */
test.describe('Authentication', { tag: '@ui' }, () => {
  test('registered customer can log in', { tag: '@smoke' }, async ({ shop, page, registeredUser }) => {
    await shop.login.open();
    await shop.login.login(registeredUser.email, registeredUser.password);

    await expect(page).toHaveURL('/');
    await expect(shop.login.header.loggedInAs).toHaveText(`Logged in as ${registeredUser.name}`);
    await expect(shop.login.header.logoutLink).toBeVisible();
  });

  test(
    'login is rejected for a wrong password',
    { tag: '@regression' },
    async ({ shop, page, registeredUser }) => {
      await shop.login.open();
      await shop.login.login(registeredUser.email, 'definitely-wrong');

      await expect(shop.login.errorMessage).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
      await expect(shop.login.header.loggedInAs).toBeHidden();
    },
  );

  test('login is rejected for an unknown e-mail', { tag: '@regression' }, async ({ shop, newUser }) => {
    await shop.login.open();
    await shop.login.login(newUser.email, newUser.password);

    await expect(shop.login.errorMessage).toBeVisible();
  });

  test('login form enforces required e-mail format', { tag: '@regression' }, async ({ shop, page }) => {
    await shop.login.open();
    await shop.login.login('not-an-email', 'whatever');

    // Native HTML5 validation blocks submission; the browser reports why.
    const message = await shop.login.emailInput.evaluate((el: HTMLInputElement) => el.validationMessage);
    expect(message).not.toBe('');
    await expect(page).toHaveURL(/\/login$/);
  });

  test(
    'session persists across reloads and new browser contexts',
    { tag: '@regression' },
    async ({ shop, page, browser, registeredUser }) => {
      await shop.login.open();
      await shop.login.login(registeredUser.email, registeredUser.password);
      await expect(shop.login.header.loggedInAs).toBeVisible();

      await page.reload();
      await expect(shop.login.header.loggedInAs).toBeVisible();

      // A new context seeded with the saved cookies is still authenticated (e.g. a reopened browser).
      const storageState = await page.context().storageState();
      const restored = await browser.newContext({ storageState });
      try {
        const restoredPage = await restored.newPage();
        await restoredPage.goto('/');
        await expect(
          restoredPage.locator('#header').getByText(`Logged in as ${registeredUser.name}`),
        ).toBeVisible();
      } finally {
        await restored.close();
      }
    },
  );

  test(
    'logout ends the session and invalidates the old session cookie',
    { tag: '@regression' },
    async ({ shop, page, browser, registeredUser }) => {
      await shop.login.open();
      await shop.login.login(registeredUser.email, registeredUser.password);
      const stateBeforeLogout = await page.context().storageState();

      await shop.login.header.logout();
      await expect(page).toHaveURL(/\/login$/);
      await expect(shop.login.header.loginLink).toBeVisible();
      await expect(shop.login.header.loggedInAs).toBeHidden();

      // Replaying the pre-logout cookie must not restore the session.
      const replay = await browser.newContext({ storageState: stateBeforeLogout });
      try {
        const replayPage = await replay.newPage();
        await replayPage.goto('/');
        await expect(replayPage.locator('#header').getByText('Logged in as')).toBeHidden();
      } finally {
        await replay.close();
      }
    },
  );

  test('anonymous shopper must log in before checkout', { tag: '@regression' }, async ({ shop, page }) => {
    await shop.products.open();
    await shop.products.addToCart(1);
    await shop.cart.open();
    await shop.cart.proceedToCheckout();

    await expect(shop.cart.checkoutModal).toBeVisible();
    await expect(shop.cart.checkoutModal).toContainText('Register / Login account to proceed on checkout.');
    await shop.cart.checkoutModalLoginLink.click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test(
    'anonymous shopper cannot open the checkout page by URL',
    {
      tag: ['@regression', '@known-defect'],
      annotation: {
        type: 'known defect',
        description:
          'Demo app only guards checkout in the UI modal; GET /checkout renders the checkout page for anonymous users. ' +
          'Marked test.fail() so the run stays green while the defect exists and turns red when it is fixed.',
      },
    },
    async ({ page }) => {
      test.fail();
      await page.goto('/checkout');
      await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
    },
  );
});
