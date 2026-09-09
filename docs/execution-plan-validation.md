# Candidate validation

ENG-07 adds full-Scenario validation of a saved web candidate through the
existing Replay runner and Studio run workflow. Validation never writes the
active selection or generated execution cache. Activation remains ENG-08.

In the Scenario’s Plan tab, save the locator edit and choose **Review for
validation**. Compare the baseline, candidate, and original Specification;
record why the target preserves the intended behavior. Confirm the review and
reset the application to the Scenario’s starting state before choosing
**Validate candidate**. Pickle records this explicit human attestation; it does
not reset arbitrary applications. The acceptance fixture uses a fresh browser
context for each execution.

Validation executes every Scenario action, including actions that submit forms
or change data. Studio labels these side effects before execution. Cancellation
uses the existing run cancellation endpoint and cannot undo completed actions.
Run evidence remains available through Runs.

The service resolves one complete Scenario and target, loads the immutable
candidate and its assertion baseline, and permits only the supported interaction
locator changes from ENG-06. It rejects partial plans, unsupported adapters,
missing inputs, changed checks, and stale applicability before opening a target.
Replay executes once with no retry, inference, Adaptive fallback, cache lease,
cache lookup, or cache publication.

A passing receipt binds the revision, full execution key, keyed input snapshot,
assertions, explicit intent review, validator version, and persisted result.
The snapshot covers resolved configuration and source contents, Specification,
selected Examples inputs, application revision, target inputs, and runtime
bindings. Local HMAC protects sensitive inputs; raw secrets and plain secret
hashes are not stored in the receipt.

The service rechecks applicability and Git HEAD after execution. Failed,
cancelled, timed-out, or stale executions receive no passing receipt. Terminal
validation heads are serialized under the existing plan-slot lock; a later
failure for the same basis supersedes earlier success. Status verifies current
inputs, review, receipt, and persisted result. A newly edited revision requires
another review and validation.

Reviews, receipts, validation heads, and the private HMAC key live under
`.pickle/runtime/plans`. Immutable candidates remain under
`.pickle/plans/revisions`. Validation results and Scenario-started events carry
the exact `PlanUse` in schema v3, including after persistence and archive
export/import. Ordinary schema-v2 history remains readable and ordinary runs
continue writing v2.

The approved types and ownership rules are in
[execution-plan ownership](execution-plan-ownership.md).

## Verification

The Chrome acceptance fixture uses the real web Replay adapter with a
controlled automation factory that rejects inference. It verifies:

- corrected checkout target: all nine steps pass with a receipt;
- business regression: the original `$29.99` assertion fails against `$39.99`;
- cancellation before launch and during execution: no passing receipt;
- timeout after a previous success: the same basis now reports failure;
- result delivery rejects after passing actions: no passing receipt;
- a further locator edit: the previous review cannot validate the new revision;
- changed execution configuration: the prior receipt is no longer current;
- every outcome: cache metadata and active selection remain unchanged;
- reopened run evidence: exact v3 provenance, with no cache or fallback events.

Studio browser coverage verifies the review and reset gates, visible comparison,
revision changes clearing the review form, and the existing locator editor’s
keyboard and responsive behavior. Storage and schema tests cover publication
concurrency, immutable content, foreign-project rejection, and v2/v3 archives.

Commands:

```sh
bun run lint
bun run typecheck
bun run test
bun run --cwd packages/cli test:e2e tests/e2e/acceptance/execution-plan-validation.test.ts tests/e2e/studio/execution-plan-editor.test.ts
```

Run the build-backed root tests and Studio browser tests sequentially: both
can prepare the local Studio distribution. This fixture proof does not exercise
a remote browser provider or mobile candidate validation.

On 2026-09-09, root lint, typecheck, and tests passed. The acceptance service
suite passed seven Chrome tests; the Studio editor suite passed two browser
tests. A mounted Studio flow with a controlled gateway also verified the
validated state, revision reset, and cancellation through the empty 204
response. That UI check supplements the real Replay service tests; it does not
claim a remote provider run.
