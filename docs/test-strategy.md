# Test strategy

## Scope

| In scope                                                                                          | Out of scope                                                |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Functional UI behaviour of the demo shop: auth, catalogue, cart, checkout                         | Load and performance testing of a public site we do not own |
| The shop's documented REST API                                                                    | Security testing beyond auth/authorisation checks           |
| Payment, webhook, subscription, e-mail and calendar _integration logic_, against local simulators | Real payment providers, real e-mail delivery                |
| Cross-browser behaviour (nightly)                                                                 | Mobile devices, visual and accessibility checks (planned)   |

## Risk assessment

Risk = likelihood of a defect × business impact. The ratings drive how many tests each area gets
and which suite they run in.

| Area                                                | Impact                  | Likelihood                       | Risk       | Response                                                                       |
| --------------------------------------------------- | ----------------------- | -------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| Double charge / duplicate order                     | Critical (money, trust) | Medium (retries, double clicks)  | **High**   | Idempotency, concurrent same-key, duplicate-checkout tests; smoke + regression |
| Webhook duplicates / reordering corrupt order state | Critical                | High (normal provider behaviour) | **High**   | Duplicate, concurrent duplicate, out-of-order, stale-failure tests             |
| Lost update on subscriptions                        | High (billing errors)   | Medium                           | **High**   | Concurrency tests with N parallel writers                                      |
| Checkout cannot be completed                        | Critical (revenue)      | Medium                           | **High**   | UI smoke + BDD smoke                                                           |
| Login / session broken                              | High                    | Low                              | Medium     | Smoke for valid login; regression for negative, session and logout             |
| Wrong totals in cart/checkout                       | High                    | Low                              | Medium     | Totals computed from API prices and compared with the UI                       |
| Lost or wrong transactional e-mail                  | Medium                  | Medium                           | Medium     | Recipient, content, link and single-send checks                                |
| Calendar double booking                             | Medium                  | Medium                           | Medium     | Overlap and update-overlap tests                                               |
| Catalogue search/filter wrong                       | Medium                  | Low                              | Low–Medium | UI results compared with API results                                           |

## Coverage priorities

1. **Integrity of money and orders**: exactly one charge, exactly one confirmation, state
   never regresses.
2. **Critical user journey**: log in → add to cart → checkout → confirmation.
3. **Contracts**: response shape and error semantics of every endpoint used.
4. **Negative and boundary input**: validation errors, auth failures, unsupported methods.
5. **Resilience**: behaviour under 5xx, network drops and delayed confirmation.

## Test levels

| Level                             | Share | Runs against   | Purpose                                                           |
| --------------------------------- | ----- | -------------- | ----------------------------------------------------------------- |
| Integration (`tests/integration`) | 58    | Local services | Deterministic, fast (about 4 s); most risk-heavy logic lives here |
| API (`tests/api`)                 | 21    | Public API     | Contract and negative coverage without UI cost                    |
| UI (`tests/ui`)                   | 26    | Public UI      | Only what needs a browser                                         |
| BDD (`features/`)                 | 6     | Both           | Readable acceptance scenarios for stakeholders                    |

The suite is deliberately not UI-heavy. UI tests do their setup through the API (account
creation) and get expected values from the API (catalogue data), so they assert UI behaviour
rather than hardcoded data.

## Smoke vs regression

- **Smoke (`@smoke`, 16 tests)**: one happy path per critical capability: login, search,
  product details, cart add/remove, checkout, API catalogue and account lifecycle, payment
  success, idempotent replay, duplicate webhook, subscription lifecycle, confirmation e-mail,
  calendar invite, plus the BDD checkout and payment outline. It answers "is the build worth
  testing further?"
- **Regression (`@regression`, 95 tests)**: everything else: negative paths, edge cases,
  concurrency and fault injection.
- The tags are mutually exclusive, so CI runs smoke and regression as two stages without
  running a test twice.

## Regression strategy

- Every PR runs the full Chromium regression after smoke passes.
- Nightly runs add Firefox and WebKit for UI and BDD tests. That catches browser-specific
  issues without slowing PRs.
- A bug fix comes with a regression test at the lowest level that reproduces it. For example,
  the calendar PATCH bug found during development (an omitted field reset to its default) is
  pinned by an assertion that fields left out of a PATCH are preserved.
- Known product defects that are not ours to fix are kept as `test.fail()` with a `known defect`
  annotation and the `@known-defect` tag. They document the behaviour and flag the fix.

## Test data management

- **Factories** (`src/data`) build valid objects. Tests override only the fields they care
  about, e.g. `buildOrder({ amount: 1000 })`.
- **Uniqueness**: `uniqueId()` combines the worker index, the time and random bytes. Users on the
  public site use `example.com` addresses. Simulator mail uses `e2e.example.test`.
- **Lifecycle**: the `registeredUser` fixture creates the account through the API and deletes it
  in teardown, which runs even after a failure. Tests that create extra accounts delete them in
  `finally`.
- **No shared fixtures data**: no test depends on another test's data or on execution order.

## Parallel execution

- `fullyParallel: true` in all projects.
- 3 workers by default, a limit set by the public site's rate limiting rather than the framework.
  `--workers=N` overrides it. Integration tests alone run comfortably with more.
- Fault injection is scoped per order ID, and calendars are per test, so a test that injects a
  fault cannot affect a parallel test.

## Flaky-test prevention

| Practice                         | Enforcement                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| No fixed sleeps                  | `playwright/no-wait-for-timeout` is an ESLint error; async effects use `expect.poll`-style polling (`pollUntil`)                |
| Web-first assertions             | `expect(locator).toHave…` with auto-retry; no manual `isVisible()` checks before acting                                         |
| Stable locators                  | `data-qa`/`id` first, then role + name; repeated elements scoped to their container                                             |
| No `force: true`                 | `playwright/no-force-option` is an ESLint error                                                                                 |
| No floating promises             | `@typescript-eslint/no-floating-promises`                                                                                       |
| Third-party noise removed        | Ad/analytics hosts blocked in the `context` fixture                                                                             |
| Modal overlays handled           | `AddedToCartModal.continueShopping()` waits until the modal is hidden                                                           |
| Environment instability isolated | Bounded, annotated retry only for the site's load-shedding responses                                                            |
| Retries cannot mask defects      | `retries: 0` for deterministic integration tests; 1 for public-site projects on CI only; retried passes are reported as _flaky_ |

## Release quality gates

A change is releasable when all of the following hold:

1. ESLint, Prettier and `tsc` pass with zero errors.
2. All API tests pass.
3. All smoke tests pass (any smoke failure blocks the regression stage).
4. All regression tests pass, or the only failures are documented `@known-defect` tests, which
   are expected to fail.
5. No test is reported _flaky_ in the integration project. Flaky UI tests are triaged before
   release: a `transient-aut-error` annotation points to the environment, anything else is
   treated as a defect.
