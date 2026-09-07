# QA acceptance fixture

This fixture extends the example project with a local synthetic checkout for
ENG-02. One [Scenario](checkout.feature) runs against three variants of
[the same application](index.html). The expected quantity, total, and completed
order count stay unchanged.

| Variant               | Interaction target       | Order total | Expected result                                                                      |
| --------------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------ |
| `original`            | Original checkout target | $29.99      | Pass                                                                                 |
| `changed-target`      | Renamed checkout target  | $29.99      | Fail at checkout with the original interaction; pass after changing only that target |
| `business-regression` | Renamed checkout target  | $39.99      | Fail the original $29.99 assertion after the same interaction repair                 |

The repair belongs to the acceptance test's controlled action compiler. It does
not edit the Scenario or implement durable execution-plan editing.

## Run the checks

From the repository root, install the locked dependencies:

```sh
bun install --frozen-lockfile
```

Use local Google Chrome, as required by the existing CLI browser suite. The
fixture requires no model API key, external account, or network application.
Browser request interception serves its static HTML at an isolated test origin.

Run the acceptance checks:

```sh
bun run --cwd packages/cli test:e2e tests/e2e/acceptance/checkout-acceptance.test.ts
```

Run that command again to repeat the proof with a new temporary SQLite cache and
fresh browser contexts. The suite also performs cold and cache-only runs within
one invocation. Intentional application failures are asserted test outcomes;
the test command succeeds only when they fail at the expected steps.

The command writes `.audit/eng02/acceptance-evidence.json` and real PNG failure
screenshots under `.audit/eng02/<case-name>/`. The report records application
and Scenario revisions for each run. Set `PICKLE_ENG02_OUTPUT_DIR` to retain a
separate evidence directory for another invocation. These generated files are
ignored by Git; the temporary cache is removed after testing.

## Inspect the application

Open `index.html` in a browser. Sign in with `acceptance_user` and `pickle_pass`;
these credentials and all order data are synthetic. Add the backpack, start
checkout, inspect the quantity and total, and place the order.

Append `?variant=changed-target` or `?variant=business-regression` to the file URL
to inspect either variant. Select **Reset acceptance data** before starting a
new manual journey. Reset clears authentication, basket, completed orders, and
form input for that tab. Each automated Scenario gets a fresh browser context
and page; it does not share session storage with another run.

## What this proves

The tests use the public runner, web adapter, and SQLite Execution cache. A
controlled compiler resolves the fixture's fixed steps; Playwright performs
real navigation, input, clicks, DOM assertions, and screenshots. Unsupported
instructions fail explicitly. Replay forbids compiler calls.

This fixture verifies local browser behavior and cache orchestration. Provider
inference, Stagehand's production instruction executor, remote browser targets,
mobile targets, and durable plan activation are outside this fixture's proof.

The fixture uses native HTML controls. Studio's interface conventions remain in
[DESIGN.md](../../../DESIGN.md); this application does not duplicate Studio's
color tokens or components.

See [the recorded acceptance results](verification.md) for the verified revision,
case matrix, and interface review.
