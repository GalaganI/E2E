import type { Page } from '@playwright/test';
import { Shop } from '@/pages';
import type { Actor } from '../core/actor';

/**
 * Gives an actor a browser. Exposes the page objects instead of raw selectors, so
 * Screenplay tasks reuse the POM locators rather than duplicating them.
 */
export class BrowseTheWeb {
  readonly shop: Shop;

  constructor(readonly page: Page) {
    this.shop = new Shop(page);
  }

  static using(page: Page): BrowseTheWeb {
    return new BrowseTheWeb(page);
  }

  static as(actor: Actor): BrowseTheWeb {
    return actor.abilityTo(BrowseTheWeb);
  }
}
