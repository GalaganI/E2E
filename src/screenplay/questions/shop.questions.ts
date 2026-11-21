import { question, type Question } from '../core/actor';
import { BrowseTheWeb } from '../abilities/browse-the-web';
import { CallAnApi } from '../abilities/call-an-api';
import type { CartLine } from '@/pages';
import type { UserDetail } from '@/api/schemas/automation-exercise.schemas';

export const CartContents: Question<CartLine[]> = question('the cart contents', async (actor) => {
  const { shop } = BrowseTheWeb.as(actor);
  await shop.cart.open();
  return shop.cart.lines();
});

export const CheckoutSummary: Question<{ lines: CartLine[]; total: number }> = question(
  'the checkout order summary',
  async (actor) => {
    const { shop } = BrowseTheWeb.as(actor);
    return { lines: await shop.checkout.lines(), total: await shop.checkout.total() };
  },
);

export const OrderConfirmation: Question<{ heading: string; chargedAmount: number }> = question(
  'the order confirmation',
  async (actor) => {
    const { shop } = BrowseTheWeb.as(actor);
    return {
      // textContent, not innerText: innerText applies CSS text-transform and varies with stylesheet timing.
      heading: ((await shop.confirmation.heading.textContent()) ?? '').trim(),
      chargedAmount: shop.confirmation.chargedAmountFromUrl(),
    };
  },
);

export const AccountDetails = {
  of: (email: string): Question<UserDetail> =>
    question(`the account details of ${email}`, (actor) => CallAnApi.as(actor).api.getUserByEmail(email)),
};
