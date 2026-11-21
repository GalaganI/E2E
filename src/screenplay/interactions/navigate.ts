import { activity, type Activity } from '../core/actor';
import { BrowseTheWeb } from '../abilities/browse-the-web';
import { gotoResilient } from '@/utils/transient';

/**
 * Low-level interaction. Most element-level interactions live in the page objects; Screenplay
 * only adds interactions that have no natural page-object home.
 */
export const Navigate = {
  to: (path: string): Activity =>
    activity(`navigates to ${path}`, async (actor) => {
      await gotoResilient(BrowseTheWeb.as(actor).page, path);
    }),
};
