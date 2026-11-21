import { expect } from '@playwright/test';
import { activity, type Activity } from '../core/actor';
import { BrowseTheWeb } from '../abilities/browse-the-web';
import { CallAnApi } from '../abilities/call-an-api';
import type { UserData } from '@/data/user.factory';

export const RegisterAccount = {
  /** Account setup through the API is ~10x faster than the UI sign-up form and not under test here. */
  viaApi: (user: UserData): Activity =>
    activity(`registers ${user.email} via the API`, async (actor) => {
      const result = await CallAnApi.as(actor).api.createAccount(user);
      expect(result, 'account creation response').toEqual({ responseCode: 201, message: 'User created!' });
    }),
};

export const Login = {
  withCredentials: (email: string, password: string): Activity =>
    activity(`logs in as ${email}`, async (actor) => {
      const { shop, page } = BrowseTheWeb.as(actor);
      await shop.login.open();
      await shop.login.login(email, password);
      await expect(page, 'should land on the home page after login').toHaveURL('/');
      await expect(shop.login.header.loggedInAs).toBeVisible();
    }),
};

export const Logout = activity('logs out', async (actor) => {
  const { shop, page } = BrowseTheWeb.as(actor);
  await shop.login.header.logout();
  await expect(page).toHaveURL(/\/login$/);
});
