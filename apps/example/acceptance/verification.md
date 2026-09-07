# ENG-02 acceptance evidence

Verified on 2026-09-04 (America/Sao_Paulo), against
`9fae3f69f5550054c63e0ecfd5c2d96b4436e9b0` plus the ENG-02 working-tree files.
Environment: Bun 1.4.0 and local Google Chrome 152.0.7977.76 on macOS.

The [acceptance tests](../../../packages/cli/tests/e2e/acceptance/checkout-acceptance.test.ts)
run the public runner and web adapter with real Chrome interactions and a
temporary SQLite cache. The [browser fixture](../../../packages/cli/tests/e2e/acceptance/checkout-browser.ts)
uses a controlled action/assertion compiler. Reported Adaptive `inferenceCount`
counts those compiler calls; it does not indicate provider inference.

## Acceptance results

All rows use the same unchanged [Scenario](checkout.feature). `Failed` below
means the intended application failure was observed and the acceptance test
passed.

| Case                                              | Application revision label   | Observed result                              | Evidence                                                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original cold run                                 | `original`                   | Passed; Adaptive, cache miss                 | All nine steps passed, including quantity 1, $29.99, and one completed order                                                                                                             |
| Original repeat                                   | `original`                   | Passed; Replay, cache hit, inference count 0 | Fresh browser context completes exactly one independent order; Replay rejects compiler calls and model credentials                                                                       |
| Revision-only cache miss                          | `original-unseeded-revision` | Failed with `cache-miss`; inference count 0  | Same original application, URL, Scenario, and cache; only the declared revision changes. No adapter browser launch occurs                                                                |
| Changed target with original interaction          | `changed-target`             | Failed at `I start checkout`                 | `No element matches #start-checkout`; real PNG screenshot retained                                                                                                                       |
| Changed target with repaired interaction          | `changed-target`             | Passed; Adaptive, cache miss                 | Only the checkout selector changes to `#review-order`; all assertions remain fixed                                                                                                       |
| Repaired target repeat                            | `changed-target`             | Passed; Replay, cache hit, inference count 0 | Reuses the repaired path from its own revision's cache                                                                                                                                   |
| Business regression with the same repair          | `business-regression`        | Failed at the order-summary assertion        | Quantity is 1, but the actual total is $39.99. The expected $29.99 is unchanged; PNG signature and artifact metadata verified                                                            |
| Authentication, persistence, reset, and isolation | `original`                   | Passed                                       | Invalid login rejected; completed order survives reload; another live browser context starts signed out with an empty basket; reset returns the first context to signed-out, empty state |

The controlled compiler's `CompilerTarget` selects one checkout locator. It
cannot select a different assertion map. Separate temporary caches keep stale
and repaired cases independent; no cache entry is transplanted across
application revisions.

## Recorded revisions

The application revision is SHA-256 of the HTML bytes, a NUL separator, and the
revision label. The special `original-unseeded-revision` label tests cache-key
applicability; it does not claim a fourth application variant.

| Revision label               | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `original`                   | `f3895e362b555f8474eaf39bc0a7220cb61e5cf60feec752105b7a3c486dcd8a` |
| `changed-target`             | `823df939d288487d7e2195235d7618eeb43293433bbd76219b118f3805d1a71c` |
| `business-regression`        | `47263b8773df3cb386a190dc9da584367f1948135cfb48314356ac58ed7fb532` |
| `original-unseeded-revision` | `530f9c7e76dc415165a579f9e9f1f2e7bba9adc0be4a026a726885f3603062bb` |

The shared Scenario revision, computed by the public `scenarioRevision` API, is
`55c3d154230326e99a1d15d455136e1791323ff0b49724b4ec25a4129a267cd9`.
Every generated run record includes both revisions, result state, execution
mode, cache outcome, inference count, and any failure message or screenshot.

Run the [documented command](README.md#run-the-checks) to regenerate
`.audit/eng02/acceptance-evidence.json` and case-scoped failure PNGs. These are
local generated artifacts. This document records the inspected snapshot;
changed fixture bytes produce new hashes on the next run.
The seven run outcomes and revisions matched across independent invocations.
Both retained failure PNGs matched their reported byte
sizes and PNG signatures.

## Verification commands

| Command                                                                                                                                   | Result                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run --cwd packages/cli test:e2e tests/e2e/acceptance/checkout-acceptance.test.ts`                                                    | Five tests passed; repeated with fresh temporary caches. Final focused run: 15.31 seconds                                                                              |
| `PICKLE_ENG02_OUTPUT_DIR="$PWD/.audit/eng02-repeat" bun run --cwd packages/cli test:e2e tests/e2e/acceptance/checkout-acceptance.test.ts` | Five tests passed; separate report and PNGs retained                                                                                                                   |
| `bun run test`                                                                                                                            | Passed: 14 script tests and seven package tasks; six package tasks used the Turborepo cache                                                                            |
| `bun run typecheck`                                                                                                                       | Passed: eight package tasks; seven used the Turborepo cache                                                                                                            |
| `bun run lint`                                                                                                                            | Passed with 27 existing file-length warnings; no new warnings                                                                                                          |
| `bun run test:e2e`                                                                                                                        | Final rerun: all five ENG-02 tests passed; CLI total 129 passed, 1 failed, 2 skipped. Existing Studio editor test timed out; downstream mobile command was not reached |
| `git diff --check`                                                                                                                        | Passed                                                                                                                                                                 |

The first full E2E run exposed a 30-second limit on the new test that performs
both cold and Replay Scenarios. Both Scenarios eventually passed, but the test
had already timed out. The two multi-Scenario tests now have explicit,
60-second limits, and adapter disposal runs in `finally`.

That run also timed out in the existing Studio reduced-motion test while
waiting for `Payment was declined` in Diagnostics. The exact isolated retry
passed: `bun run --cwd packages/cli test:e2e tests/e2e/studio/studio.test.ts -t
'reduced-motion users can review core results on a smaller screen'`.

The full rerun passed the acceptance tests with their corrected limits. It
timed out in a different existing Studio test, `Studio keeps the workbench
focused until Edit opens Gherkin with autocomplete`: its `Edit Specification`
button detached while Playwright was attempting the click. The final full-suite
log is `.audit/eng02-e2e-final.log`. This is an unresolved full-suite verification
limit; ENG-02 does not change Studio editor code or tests.
Its exact isolated rerun passed (one test, 29 skipped, 9.26 seconds):

```sh
bun run --cwd packages/cli test:e2e tests/e2e/studio/studio.test.ts -t 'Studio keeps the workbench focused until Edit opens Gherkin with autocomplete'
```

## Interface review

The better-interface review covered this fixture's complete login-to-order
flow, including invalid login, the empty basket, disabled checkout, order
summary, confirmation, and reset. It uses native HTML, system fonts, and a
light theme. Repository AGENTS.md and [DESIGN.md](../../../DESIGN.md) were
inspected; DESIGN.md governs Studio, whose components are outside this fixture.

| Domain        | Evidence inspected                                                                                                                        | Result                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Accessibility | Keyboard-only login, recovery, add, checkout, and order; focus movement; accessibility trees; axe WCAG A/AA checks across rendered states | Clear for inspected checks                        |
| Layout        | Screenshots and DOM widths at 320px and 1280px; 200% CSS zoom and RTL login layout                                                        | Clear; no horizontal overflow in inspected states |
| Writing       | Labels, invalid-login recovery instructions, reset action, product and order summaries                                                    | Clear                                             |
| Typography    | Rendered 16px inputs, heading hierarchy, wrapping at narrow width and magnification                                                       | Clear                                             |
| Colors        | Rendered text/control contrast checks through axe, visible focus, explicit disabled treatment                                             | Clear                                             |
| UI polish     | Empty, disabled, focused, error, checkout, and completed states; no animation or color-only status                                        | Clear                                             |

No actionable interface findings remain in the inspected flow. The review
corrected low-contrast focus styling, added login recovery and focus transfer,
and made disabled checkout visually distinct. Final browser inspection found
zero axe violations in eight captured states. Screenshots and accessibility
trees are retained locally under `.audit/eng02-review/`.

Native browser zoom and a screen-reader audio walkthrough were not verified;
CSS zoom and accessibility-tree inspection are the recorded evidence. No
loading state exists in this synchronous fixture. Remote browsers, native
mobile, model inference, and production Stagehand execution remain outside
this acceptance proof.

Verdict: **Approve** for the inspected fixture flow and stated coverage.
