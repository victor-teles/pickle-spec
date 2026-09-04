# AI engineering action plan

Created on 2026-09-04. This backlog translates the
[QA and UX review](roadmap-qa-ux-review.md) and
[launch and growth plan](launch-and-growth.md) into assignable engineering tasks.
It includes the QA request to inspect, manually edit, and autonomously repair
AI-generated execution plans. Task status is recorded in the backlog below.
This document does not certify features, authorize publication, or start
implementation.

## Delivery outcome

A QA engineer can connect an application, run a meaningful Scenario, diagnose a
failure, correct a generated interaction, validate the correction, and reuse the
accepted plan through Replay. Human edits survive cache eviction and refresh.
AI-assisted and autonomous repair use the same validation and activation rules.

Keep these concepts distinct:

| Concept | Responsibility |
| --- | --- |
| Specification | Gherkin intent and expected business outcomes |
| Coverage plan | Proposed journeys and risks to test; deferred from the first delivery |
| Execution plan | Ordered interactions and checks mapped to Specification steps |
| Execution cache | Disposable runtime entries for applicable execution paths |
| Plan revision | Proposed durable authored change, with provenance and validation |

Plan revision storage and APIs are design work in ENG-03. They are not existing
contracts. A passing run alone cannot prove that an edited assertion preserved
intent; interaction repair must also protect the original checks.

## How to execute a task

Assign one engineer or coding agent to a task ID. Read the relevant implementation,
tests, local AGENTS.md, and 10x-coder skill before changing code. The module lists
below are entry points, not permission to rewrite every listed package.

Start with the requested outcome, non-goals, smallest expected file set, and
proof. Inspect existing behavior before adding it. A task can close as already
implemented only with acceptance evidence at the current revision.

Deliver a focused change with its task ID, acceptance results, exact commands,
revision, and remaining limitations. Record unavailable credentials or devices as
blocked verification. Do not substitute mocks for real-target claims. Update the
checkbox only when the stated exit checks pass.

Respect repository approval rules for new public APIs, storage/wire formats,
dependencies, or destructive operations when the active implementation request
has not authorized them. Complete a concrete design proposal first. This backlog
is a planning artifact, not blanket approval for those changes.

## Ordered backlog

Priority P0 covers the core QA loop and manual maintenance. P1 covers expanded
repair and target reach. P2 requires evidence from returning users. Dependencies
are task IDs; independent tasks may be assigned separately after their shared
contracts are settled. No delivery dates or effort estimates are assumed.

| Done | ID | Priority | Task | Depends on |
| --- | --- | --- | --- | --- |
| [x] | ENG-01 | P0 | Reconcile capability status and release evidence | None |
| [ ] | ENG-02 | P0 | Create a repeatable QA acceptance fixture | ENG-01 |
| [ ] | ENG-03 | P0 | Decide execution-plan ownership and contracts | ENG-01 |
| [ ] | ENG-04 | P0 | Expose a readable execution plan | ENG-03 |
| [ ] | ENG-05 | P0 | Persist durable drafts and revisions | ENG-03 |
| [ ] | ENG-06 | P0 | Add manual web interaction editing | ENG-04, ENG-05 |
| [ ] | ENG-07 | P0 | Validate a candidate without activating it | ENG-02, ENG-05, ENG-06 |
| [ ] | ENG-08 | P0 | Activate, roll back, and preserve edited plans | ENG-07 |
| [ ] | ENG-09 | P0 | Explain failures and Replay divergence | ENG-01, ENG-02 |
| [ ] | ENG-10 | P0 | Fix first-run and setup recovery gaps | ENG-02 |
| [ ] | ENG-11 | P0 | Prove CI failure handoff and exports | ENG-02, ENG-09 |
| [ ] | ENG-12 | P0 | Verify accessible, stable QA workflows | ENG-08, ENG-09, ENG-10, ENG-11 |
| [ ] | ENG-13 | P0 | Complete manual-maintenance release verification | ENG-12 |
| [ ] | ENG-14 | P0 | Prepare pilot and launch evidence assets | ENG-13 |
| [ ] | ENG-15 | P1 | Generate an AI repair proposal | ENG-08, ENG-09 |
| [ ] | ENG-16 | P1 | Add bounded autonomous repair policy | ENG-15 |
| [ ] | ENG-17 | P1 | Extend plan maintenance to mobile | ENG-08 |
| [ ] | ENG-18 | P1 | Close second-journey authoring gaps | ENG-14, pilot feedback |
| [ ] | ENG-19 | P2 | Scope later capabilities from observed demand | ENG-14, return-use evidence |

ENG-01 is complete. Continue with ENG-02 and ENG-03. The critical maintenance
path is ENG-03 through ENG-08. Diagnosis, onboarding, and CI work can advance
alongside that path without inventing alternative plan contracts.

## P0 task details

### ENG-01: Reconcile capability status and release evidence

Entry points: [ROADMAP.md](../ROADMAP.md), [README.md](../README.md),
[DESIGN.md](../DESIGN.md), [release policy](releasing.md), and the owning Studio
features and adapter tests discovered from them.

Work:

- Resolve the contradictory live-view and diagnostic status statements.
- Split compound items such as follow mode, filmstrip, and picture-in-picture.
- Produce a task-based matrix for local web, attached CDP, Browserbase, Android
  Emulator, and iOS Simulator. Cover setup, assertions, artifacts, Replay,
  cancellation, CI, and plan inspection/editing.
- Record implemented, verified, unsupported, or unverified with revision and
  evidence. Link to DESIGN.md rather than copying obsolete color tokens.

Done when every advertised capability has a supported scope and evidence status.
No feature implementation belongs in this inventory task. Turn discovered gaps
into the relevant task below or a separately scoped follow-up.

Completed on 2026-09-04. The [capability and release evidence inventory](capability-status.md)
records the audited revision, five-target task matrices, source and test
evidence, exact verification results, and follow-up ownership. README, roadmap,
and release policy now distinguish implemented behavior from live verification.
The [four-criterion acceptance map](capability-status.md#eng-01-acceptance)
links each requirement to its delivered result and evidence.
Live-target, published-package, and rendered accessibility evidence remain
unverified; inventory completion does not close those later release gates.

### ENG-02: Create a repeatable QA acceptance fixture

Entry points: `apps/example`, existing web/runner test fixtures, and the documented
quick-start examples under `apps/docs`.

Work:

- Extend an existing small application with an authenticated journey, isolated
  synthetic data, a meaningful assertion, and a known reset path.
- Provide separate reproducible variants for a changed interaction target and
  a genuine incorrect business outcome. Preserve the original expectation.
- Include clean setup, repeat run, failure evidence, and cache-only outcomes.
  Use existing test infrastructure and avoid introducing a new fixture service.

Done when the original Scenario passes, the target-change variant fails in the
expected place, and the business-regression variant stays failed after an
interaction-only repair. Record application and Scenario revisions for each.
Prove two runs do not contaminate each other's data.

### ENG-03: Decide execution-plan ownership and contracts

Read [cache contracts](../packages/runner/src/execution-cache/execution-cache.ts),
[web instruction schema](../packages/web/src/execution-cache/web-cache-schema.ts),
[mobile cache implementation](../packages/mobile/src/execution-cache/mobile-execution-cache.ts),
and [Studio cache gateway](../packages/cli/src/studio/studio-cache.ts).

Work:

- Write a focused design decision describing durable repository-owned revisions
  and their relationship to disposable cache entries. Specify actual proposed
  types and lifecycle operations, with examples for one edited web interaction.
- Define step identity, supported operations, draft/validated/active states,
  author attribution, source and validation runs, and rollback behavior.
- Define compatibility with existing caches and immutable historical runs,
  including what happens when a new plan format is unavailable or unsupported.
- Preserve cache applicability across project, Scenario revision, profile,
  configuration fingerprint, application revision, and adapter schema.
- Decide how edits, refresh, eviction, branches/worktrees, concurrent writers,
  invalidation, and validation-to-activation races behave.
- Protect assertion semantics: reject removal, weakening, or bypass of checks
  through interaction repair. Treat uncertain equivalence as requiring explicit
  Specification review. A target edit is not automatically semantically safe.
- Specify a no-inference path for complete supported plans. Partial plans must
  explain why complete Replay validation is unavailable instead of silently
  invoking a model.

Done when the design contains concrete contracts, failure cases, migration
behavior, and acceptance examples, and required contract approval is recorded.
Avoid a generic workflow engine or a second action language. Use adapter-owned
representations and the smallest shared contract the actual callers require.

### ENG-04: Expose a readable execution plan

Entry points: `packages/studio/src/features/execution-cache`,
`packages/studio/src/features/runs/result`, the CLI Studio gateway, and adapter
cache parsers. Follow ENG-03's approved ownership.

Work:

- Project parsed actions into a read-only view grouped by Gherkin step.
- Show action target, variable references, checks, source evidence, applicability,
  and any uncached tail. Redact secrets before returning data to the UI.
- Open this view from the Scenario and failing-step context, using Mira controls.
- Handle absent, incompatible, or unsupported plans with an explicit next action.

Done when a QA user can identify the failed interaction and its Scenario step
without reading raw payloads. Verify complete and partial web paths, unsupported
payloads, and secrets in inputs. This task adds no mutation endpoint.

### ENG-05: Persist durable drafts and revisions

Entry points: the approved domain owner from ENG-03, runner cache coordination,
and CLI project composition. Keep storage outside presentation components.

Work:

- Implement draft creation, validated revision persistence, history lookup, and
  conflict detection under the approved format.
- Keep authored revisions independent of cache eviction and cache clearing.
- Parse untrusted files at the boundary; preserve variable references instead of
  storing bound secrets. Prevent project-path escape.
- Preserve existing user edits and reject stale writes. Recover from interrupted
  writes without publishing incomplete revisions.

Done when restart, eviction, concurrent edits, malformed input, and interrupted
writes preserve the last valid state. Existing cache-only projects continue to
work without creating authored plans automatically.

### ENG-06: Add manual web interaction editing

Entry points: the execution-plan feature from ENG-04/05 and web cache schema.

Work:

- Add contextual fields for supported navigation, locator, and input operations.
  Support insertion, deletion, and reordering where the approved semantics allow.
- Show the candidate diff beside its Gherkin step and original checks.
- Keep assertion changes outside interaction repair. Explain unsupported edits.
- Preserve unsaved work and provide discard and save-draft actions. Saving a
  draft must not change active execution.

Done when the ENG-02 changed-target interaction can be edited without model
credentials or raw cache editing. Verify invalid locators/variables, protected
checks, keyboard interaction, and navigation with unsaved changes.

### ENG-07: Validate a candidate without activating it

Entry points: runner Scenario execution, adapter Replay, and existing Studio run
requests. Extend approved contracts rather than introducing another runner.

Work:

- Run the affected complete Scenario against a known reset state using the exact
  candidate revision. Preserve the original Specification and expected outcomes.
- Bind the validation result to the candidate digest and all applicability inputs.
- Keep candidate execution isolated from active cache publication. Failed,
  cancelled, timed-out, or subsequently edited candidates cannot become active.
- Label side effects before validation. Model-free validation must fail clearly
  when a candidate is incomplete or unsupported, with no Adaptive fallback.

Done when a corrected target validates, a business regression fails, and editing
a candidate after validation invalidates its validation status. Prove the active
plan/cache remains unchanged after every unsuccessful validation outcome.

### ENG-08: Activate, roll back, and preserve edited plans

Entry points: plan persistence, runner cache selection/coordination, and Studio
plan history. Use ENG-07's exact validation binding.

Work:

- Activate a validated revision atomically only if its applicability and baseline
  still match. Record revision attribution in runs through the approved contract.
- Materialize applicable runtime entries from accepted plans without requiring
  model inference. Do not weaken existing cache key checks.
- Preserve authored plans through eviction/clear. Make refresh produce a candidate
  or conflict for edited plans instead of overwriting them silently.
- Add rollback to an eligible earlier revision. Require revalidation when its
  target or other applicability inputs have changed.

Done when edit → validate → activate → Replay → evict → Replay succeeds for the
fixture with zero inference in the supported path. Verify refresh conflict,
stale activation, rollback, application revision change, and unchanged historical
run evidence. Finish this vertical workflow before adding AI repair.

### ENG-09: Explain failures and Replay divergence

Entry points: `packages/studio/src/features/runs/result`, existing run events,
and live/completed evidence projections.

Work:

- Show expected/observed evidence, failing step, execution mode, applicable cached
  prefix, and the reason for missing artifacts.
- Reuse `replay-diverged` and `adaptive-fallback-started`; explain when fallback
  occurred and when partial side effects prevented safe continuation.
- Keep the selected evidence stable as live events arrive. Link to a selective
  rerun and, once available, the relevant plan interaction.

Done when seeded application, setup, infrastructure, and Replay failures have
consistent live and persisted explanations. Unknown causes remain unknown;
a passed fallback is not mislabeled as pure Replay. Prove refreshed deep links.

### ENG-10: Fix first-run and setup recovery gaps

Entry points: `packages/studio/src/features/onboarding`,
`packages/cli/src/studio/studio-project.ts`, and existing readiness/run ownership.

Work:

- Walk through empty project, missing target, invalid credentials, first failure,
  and successful completion. Fix only reproduced gaps.
- Separate credential-free demonstration from testing a real application.
- Preserve edits and target selection during recovery. Explain when Run may use
  inference and when cache-only execution cannot proceed.

Done when the fixture can move from blocked to ready to completed using the
existing readiness flow. Record total setup time and assistance, including failed
attempts. Human timing targets require ENG-14 participant evidence.

### ENG-11: Prove CI failure handoff and exports

Entry points: existing CLI run/export/import commands, Studio artifact viewing,
`docs/releasing.md`, and existing CI workflows.

Work:

- Add or repair one documented CI recipe for cache-only behavior and output
  preservation on failure, using existing export formats.
- Verify the actual downloaded HTML and archive bytes in a separate workspace.
- Keep report actions beside the run that produced them. Distinguish local deep
  links from portable files and explain missing or retained artifacts.

Done when a deliberate CI failure remains a failed job while its evidence can be
downloaded, imported, and understood without the original workspace. No hosted
sharing service, PR annotation framework, or shard merging is part of this task.

### ENG-12: Verify accessible, stable QA workflows

Entry points: the UI changed by ENG-04–11, DESIGN.md, and existing Studio browser
coverage. Search/add registry primitives before creating controls.

Work:

- Exercise select, run, cancel, inspect, edit, validate, activate, rollback, export,
  and recovery by keyboard. Inspect screen-reader labels and live announcements.
- Check focus after dialogs and updates, 200% zoom, a narrow viewport, long names,
  missing artifacts, and concurrent run events.
- Fix reproduced overlap, focus loss, inaccessible controls, and unexpected
  selection changes. Preserve one clear primary action per context.

Done when the rendered workflow passes these checks with recorded viewport and
interaction evidence. Unit tests alone do not close this task.

### ENG-13: Complete manual-maintenance release verification

Entry points: [Release validation](releasing.md), existing package tests,
`scripts/release-packages.ts`, and `scripts/replay-performance-gate.ts`.

Work:

- Run focused regression tests, then required repository and release gates.
- Verify the ENG-01 workflow follow-up on the release revision. The corrected
  loop includes all seven packages and runs integration/E2E before publication;
  actual publication and clean installation still require release evidence.
- Verify the installable artifacts outside the monorepo. Verify the exact public
  package after publication is separately authorized and performed.
- Run the full fixture on real advertised targets and capture revision, OS,
  application revision, inference behavior, and result artifacts.
- Verify compatibility for projects without authored plans and historical exports.

Done when the release evidence identifies which claims have live proof and which
remain unavailable. A blocked target cannot be marked verified. Publication is a
separate owner action; package packing is not evidence of registry availability.

### ENG-14: Prepare pilot and launch evidence assets

Entry points: ENG-02's fixture, verified release evidence, and the launch plan.

Work:

- Prepare the tested quick start, maintenance walkthrough, portable failure report,
  support matrix, and release limitations using one exact version.
- Prepare a five-participant session script covering setup, diagnosis, manual
  editing, validation, rollback, and repeat use.
- Create a simple local results template with project alias, assistance, timings,
  completion, blockers, and seven-day follow-up status. No hosted telemetry.
- Hand the materials to the product/launch owner for recruitment and publication.

Engineering delivery is done when another engineer can reproduce the assets.
Product acceptance remains pending until real participants meet the companion
review's criteria. Never fabricate sessions or treat an agent walkthrough as user
research. Engineering can prepare outreach drafts, but must not send them without
authorization.

## P1 and P2 task details

### ENG-15: Generate an AI repair proposal

Depends on ENG-08 and ENG-09. Use existing configured model integration and the
same plan draft, diff, validation, and activation operations as manual editing.

- Supply only relevant redacted evidence and supported operations to the model.
- Produce a structured candidate scoped to the failing interaction. Reject
  unsupported operations and assertion changes at the boundary.
- Show the proposed diff and rationale grounded in observable evidence. Retain
  human acceptance and the full Scenario validation requirement.
- Handle invalid output, unavailable credentials, cancellation, and provider
  failure without changing the active plan or losing a manual draft.

Done when a real model proposes a valid correction for the changed-target case,
the candidate passes the same validation, and the business-regression case stays
failed. Report controlled tests and real-model evidence separately. No private
chain-of-thought is stored or displayed.

### ENG-16: Add bounded autonomous repair policy

Depends on ENG-15. Write the concrete project-policy proposal first and obtain
any required configuration-contract approval before implementation.

- Default automatic activation off. Define permitted scope, maximum attempts,
  cancellation, retry/cost limits where measurable, and attribution.
- Route automatic activation through ENG-08. Stop on uncertain intent, stale
  validation, repeated failures, or a broad shared outage.
- Keep every failed attempt visible and every accepted revision recoverable.
  Do not quarantine tests or change expected behavior implicitly.

Done when policy-off prevents automatic activation, limits stop the loop, an
outage does not trigger repeated suite-wide repair, and every accepted repair has
a diff and exact validation evidence. Reuse the same seeded regressions as ENG-15.

### ENG-17: Extend plan maintenance to mobile

Depends on ENG-08. Entry points: mobile execution-cache and agent-device Replay.

- Map supported mobile operations into the existing plan interaction workflow.
- Preserve application launch identity, variable handling, and the mobile
  complete-Scenario Replay requirement. Do not imply partial-prefix parity.
- Verify manual editing, validation, activation, and rollback on provisioned
  Android Emulator and iOS Simulator targets, recording each separately.

Done when target-specific evidence supports each advertised editing operation.
Unsupported operations remain explicit. No physical-device work is included.

### ENG-18: Close second-journey authoring gaps

Depends on ENG-14 and actual pilot feedback. Entry points: Specification editing,
existing syntax, configuration, and example setup.

Select the most frequent observed blocker, then implement one bounded improvement:
a template, assertion diagnostic, repeated setup extraction, or draft-generation
step. Reuse existing mechanisms before introducing shared-flow syntax. Any new
public authoring contract needs a concrete proposal under repository rules.

Done when a participant adds a second meaningful journey without maintainer
operation and can explain the expected result. Broad coverage planning and
grounded autocomplete are not automatic dependencies.

### ENG-19: Scope later capabilities from observed demand

Depends on ENG-14 and evidence of returning projects. Deliver scoped issue briefs,
not a batch implementation, for the highest demonstrated needs:

| Candidate | Evidence needed before implementation | Required acceptance direction |
| --- | --- | --- |
| Visual comparison | Users cannot diagnose a visual regression with current artifacts | Compatible baselines and deliberate visual changes produce understandable differences |
| Classification and quarantine | Repeated ambiguous failures or flakes block useful CI | Provenance, explicit override, visible ownership/expiry, no false green |
| Trends and suite health | Returning teams cannot prioritize failing or slow Scenarios | Explainable measures from existing history, with missing data explicit |
| Read-and-run MCP | Coding-agent users are blocked by manual handoffs | Same readiness, run, result, and artifact contracts as CLI/Studio |
| AI coverage planning | Users cannot identify or author their next useful journey | Approved plan, traceable draft, validated Scenario, unchanged review ownership |
| Change-impact selection and shard merging | Measured CI duration or scale bottleneck | Explained selection/merge, full-suite fallback, regression comparison |

Each brief needs the observed problem, smallest scope, owners, dependencies,
contract decisions, and proof. Keep picture-in-picture, filmstrip, physical
devices, and hosted collaboration deferred until their own need is demonstrated.

## Verification and handoff record

Use the narrowest existing Vitest suite through Bun for each changed behavior.
Run `bun run lint`, `bun run typecheck`, and `bun run test` from the root as
required by repository instructions. Follow the release guide for
`bun run release:check`, `bun run benchmark:replay`, dependency installation, and
provisioned smoke commands. Read current package scripts before selecting a
focused command; do not assume `bun test` is equivalent.

Attach this record to each completed task:

```text
Task ID:
Revision:
Changed files and why:
Acceptance checks: passed / failed / blocked, with evidence
Exact commands and results:
Real target / controlled fixture / rendered UI evidence:
Public or storage contract decisions, if applicable:
Remaining limitations and dependent tasks:
```

For this document, local paths and the current cache/schema/gateway entry points
were inspected. No backlog task was executed, no new public contract was selected,
and no runtime or launch claim was verified.
