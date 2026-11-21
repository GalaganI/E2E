import { test } from '@playwright/test';

/** Something an actor can do: a business-level Task or a low-level Interaction. */
export interface Activity {
  readonly description: string;
  performAs(actor: Actor): Promise<void>;
}

/** Something an actor can find out about the system's state. */
export interface Question<T> {
  readonly description: string;
  answeredBy(actor: Actor): Promise<T>;
}

/** Marker for capabilities (a browser, an API client) that activities obtain from the actor. */
export type Ability = object;

type AbilityClass<A extends Ability> = abstract new (...args: never) => A;

/**
 * Screenplay actor. Every activity and question is wrapped in `test.step`, so the HTML report
 * and trace viewer show business-readable steps ("Quinn adds 2 x product #3 to the cart").
 */
export class Actor {
  private readonly abilities: Ability[] = [];
  private readonly memory = new Map<string, unknown>();

  constructor(readonly name: string) {}

  whoCan(...abilities: Ability[]): this {
    this.abilities.push(...abilities);
    return this;
  }

  abilityTo<A extends Ability>(type: AbilityClass<A>): A {
    const ability = this.abilities.find((a): a is A => a instanceof type);
    if (!ability) throw new Error(`${this.name} does not have the ability ${type.name}`);
    return ability;
  }

  async attemptsTo(...activities: Activity[]): Promise<void> {
    for (const activity of activities) {
      await test.step(`${this.name} ${activity.description}`, () => activity.performAs(this));
    }
  }

  async asks<T>(question: Question<T>): Promise<T> {
    return test.step(`${this.name} checks ${question.description}`, () => question.answeredBy(this));
  }

  /** Short-term memory, used to pass facts between BDD steps without module-level state. */
  remember(key: string, value: unknown): void {
    this.memory.set(key, value);
  }

  // The caller states the type it stored; memory is untyped by design (as in Serenity/JS notes).
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  recall<T>(key: string): T {
    if (!this.memory.has(key)) throw new Error(`${this.name} does not remember "${key}"`);
    return this.memory.get(key) as T;
  }
}

/** Builds activities from a description and a function, which keeps simple tasks one-liners. */
export const activity = (description: string, perform: (actor: Actor) => Promise<void>): Activity => ({
  description,
  performAs: perform,
});

export const question = <T>(description: string, answer: (actor: Actor) => Promise<T>): Question<T> => ({
  description,
  answeredBy: answer,
});
