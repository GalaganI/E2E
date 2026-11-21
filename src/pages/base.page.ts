import type { Page } from '@playwright/test';
import { HeaderComponent } from './components/header.component';
import { gotoResilient } from '@/utils/transient';

/**
 * Base for all page objects. Pages expose intent-level actions and locators; they never
 * contain assertions, so the same object serves positive, negative and Screenplay tests.
 */
export abstract class BasePage {
  readonly header: HeaderComponent;

  protected abstract readonly path: string;

  constructor(readonly page: Page) {
    this.header = new HeaderComponent(page);
  }

  async open(): Promise<void> {
    await gotoResilient(this.page, this.path);
  }
}
