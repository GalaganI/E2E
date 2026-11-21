import type { AutomationExerciseApi } from '@/api/automation-exercise.client';
import type { Actor } from '../core/actor';

export class CallAnApi {
  constructor(readonly api: AutomationExerciseApi) {}

  static using(api: AutomationExerciseApi): CallAnApi {
    return new CallAnApi(api);
  }

  static as(actor: Actor): CallAnApi {
    return actor.abilityTo(CallAnApi);
  }
}
