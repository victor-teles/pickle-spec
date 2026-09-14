# Uncommitted code review and Studio polish

Scope: all tracked modifications and five untracked source/test files over
`dc37ea8bb6b34553eea5f8bf5448efbb32f858fe`. No staged changes were present.
Reviewed onboarding, completed-run navigation, Replay projection, focused reruns,
plan save messaging, archive acceptance, accessibility changes, tests, and docs.

Verdict: **REQUEST CHANGES**. Two correctness findings remain. The scoped UI
polish below is implemented; it does not change rerun or cache contracts.

## Findings

### P2 — Selected-result rerun expands to all Examples rows

Location: `packages/studio/src/features/runs/run-attempts.tsx:170`.

For an Outline with multiple Examples rows, the selected attempt identifies a row,
but the new action sends only the Scenario ID and profile. The CLI passes these
to `selectRerunResults`, whose filter has no row identity. Selecting one row therefore
reruns the other rows too, contrary to the new button label and exact-result claim.
This can repeat state-changing tests the user did not select.

Reproduction through the existing selector: a manifest containing `row-1` and
`row-2` for the same Scenario/profile, filtered by the action's Scenario/profile,
returns both rows. The added duplicate-name test covers separate Scenario IDs,
not multiple Examples rows.

Fix direction: carry the complete result identity through rerun selection and
test two Examples rows on one profile. If preserving the current contract, label
the action as a Scenario/profile rerun and disclose that it includes every row.

### P2 — Missing prefix metadata is reported as first-step divergence

Location: `packages/studio/src/features/runs/result/replay-divergence.ts:74`.

`prefixStepCount ?? 0` treats absent metadata as evidence that no steps replayed.
However, `attemptCacheUse` returns `uncacheable` before the partial-hit branch,
and `cacheFields` omits the prefix count for that outcome. A Scenario can replay
two steps, diverge, complete through Adaptive with a non-cacheable action, and
reach this projector without a prefix count. The card then names step 1 and says
no steps replayed even though divergence occurred at step 3.

Reproduction through the existing cache policy and projector: an entry with
`prefixStepCount: 2`, three Scenario steps, one inference, and
`uncacheableReason: non-deterministic-action` produces an uncacheable attempt
without the count; the projector returns `stepIndex: 0` and `stepCount: 0`.

Fix direction: preserve or derive the actual Replay boundary from authoritative
evidence. When it is unavailable, show an unknown boundary rather than inventing
step 1. Add coverage for mixed Replay ending in an uncacheable outcome.

## Implemented polish

- The Replay card uses its container width to choose a stacked or three-column
  layout; narrow desktop panels no longer inherit the wide viewport layout.
- Long unbroken step text wraps without clipping, with more readable line height
  and consistent spacing between the three explanation sections.
- The card has a named region and an instance-specific heading ID.

Factory's layout and interaction guidance informed these changes. Existing Mira
components and semantic color tokens are retained. No dependencies were added.

## Verification

- PASS: Studio production build and nine focused Replay/run-detail tests.
- PASS: root lint and typecheck (eight tasks; Turbo emitted cache IO warnings).
- PASS: isolated rendered component with built Studio CSS at a 1280px viewport,
  in a 300px panel, and at 390px and 320px viewports. Wide layout has three
  columns; narrow layout has one. At 320px, document scroll width is 320px.
- PASS: final component Axe scan, zero violations and zero incomplete checks.
- PARTIAL: all three Studio browser files ran: 38 passed, two failed. The
  cache-refresh case timed out waiting for a transient running state; the new
  portable-diagnosis case received a failed export response. Running those two
  cases together in isolation passed (two passed, 32 filtered). This establishes
  intermittent failures, not a clean full-suite pass or a confirmed baseline.
  The new export case waits for `Now running (0)`, which is a queue count rather
  than a durable run-finalization barrier, and its error omits HTTP status/body.
  Use a terminal persisted run condition and retain response diagnostics when
  investigating this failure. Both execution-plan browser files passed in full.

The visual preview uses controlled component data; it does not establish an
end-to-end real-provider Replay journey. Screen readers and physical devices
were not exercised. The removed macOS `/tmp` equality test was explicitly
requested earlier; this review did not restore it or remove other coverage.
