# Pickle Spec roadmap

Reviewed on 2026-09-13 against `bc5a824317665739cf2d2a4c0ec2aeeec2c7ee8c`.
Required-gate validation was updated on 2026-09-13 against
`966dc8f52fb9c709d975780102af913898fb49ec` plus the test-only patch identified
in the QA record.
This roadmap prioritizes stability, everyday QA usability, and a credible launch.
The [review and QA record](docs/roadmap-qa-ux-review.md) contains findings,
source references, checks attempted, and executable acceptance scenarios.
The [capability inventory](docs/capability-status.md) separates implementation
from verification. No milestone is certified complete by this review.

## Product direction

Make this loop dependable: configure an application, write a meaningful Gherkin
Scenario, run it, understand a failure, correct an interaction, rerun, and share
the evidence. Start with a web technical preview; qualify mobile and remote
browser environments individually before advertising them as verified.

Keep four principles:

1. Repository files own test intent and expected behavior.
2. Autonomous actions expose tool activity, outcomes, model identity, and evidence;
   they never require private chain-of-thought.
3. Applicable Replay reuses a recorded path without model inference. Cache misses,
   divergence, fallback, and application failures must remain distinguishable.
4. A saved interaction is not a validated Scenario. Repairs must not weaken an
   assertion to hide an application regression.

Studio follows [DESIGN.md](DESIGN.md) and its shadcn Mira primitives. Prioritize
clear next actions, keyboard access, recoverable errors, and readable evidence
before adding more panels or controls.

## Current baseline

The repository contains specification parsing/selection, runner scheduling and
stored evidence, web and mobile adapters, CLI commands and exports, and Studio
catalog/editor/runs/history/settings/git surfaces. Studio has routing, onboarding,
command-palette, evidence-inspection, and execution-plan code with controlled tests.
Their presence is implementation evidence, not a current release acceptance result.

The Plan tab provides canvas/list inspection and direct web locator saves with
revision/digest conflict checks and a writer lease. Separate draft and validation
infrastructure exists. The current Save action does not establish full-Scenario
validation, activation, rollback, or preservation of that edit after cache eviction.
See the inventory before using “editable plans” or “validated repairs” in copy.

- [x] Follow mode: implemented causal following and pinned investigation; live-target acceptance remains pending.
- [ ] Concurrent target filmstrip: multiple live targets in one UI.
- [ ] Picture-in-picture: a target view outside the inspector pane.

These three checkboxes describe implementation scope only.

The former week-based phases are replaced by evidence-based milestones. Existing
features must pass the gates below; they do not need to be rebuilt. Advanced
features remain in the backlog and do not block a focused technical preview.

## Current release blockers

The required quality, integration, browser, package, and controlled Replay gates
pass on the recorded candidate. The earlier browser failures were resolved as a
fixture timeout-budget defect and a transient-state failure that cleared repeated
retests; the full retest also made Git fixtures independent of inherited signing policy.
Provisioned target evidence and external pilot acceptance remain open. This
candidate is not launch-ready on current evidence; see the QA record for details.

## Milestone 0: Reproducible release candidate

**Priority P0.** Establish an exact artifact and a trustworthy quality baseline.

- [x] **S1 — Reproducible toolchain.** Bun `1.4.2` is the supported release
      runtime in `package.json`, CI, and publish workflows. Release acceptance
      verifies frozen installation, and a regression test enforces alignment.
- [x] **S2 — Required quality gates.** Pass lint, typecheck, unit, integration,
      browser E2E, release-package acceptance, and Replay performance checks from
      [Release validation](docs/releasing.md). Record failures and skipped tests.
- [x] **S3 — Run lifecycle and recovery.** Verify cancellation, interrupted runs,
      provider timeout, browser disconnect, restart, and reconnect. No run may remain
      falsely active or be reported as passed because evidence delivery stopped.
- [x] **S4 — Evidence integrity.** Verify redaction across stored files, live events,
      logs, exports, and imports using synthetic canaries. Check artifact access,
      local-session security, corrupt input handling, and cross-project isolation.
- [x] **S5 — Replay correctness.** Exercise hit, miss, divergence, fallback,
      changed application/profile, retry, and cache-only failure. Assert meaningful
      application outcomes as well as execution mode and inference counts.
- [ ] **S6 — Packaging and recovery.** Install the seven packed packages in a clean
      project; run the CLI and built Studio; test archive handoff. Verify license and
      package metadata, and document previous-version recovery before distribution.

Exit: all required checks pass on the named candidate; no open blocker causing
false passes, lost user edits, leaked secrets, broken installation, or unusable
primary web execution. Environmental skips are not passes. Exact registry-install
verification remains a separate post-publication step owned by the release owner.

## Milestone 1: Complete the everyday QA workflow

**Priority P1; preview gate for the primary web journey.** Build on current UX.

- [ ] **U1 — First successful assertion.** Verify a clean README path, ready/blocked
      onboarding states, credential-free demonstration, and real application setup.
      Separate demo completion from a real run; errors identify the failing prerequisite
      and offer a useful recovery action. Measure setup and ready-to-green separately.
- [ ] **U2 — Understand a failure.** From a failed run, reach the failed step,
      expected outcome, target state, diagnostics, retry history, and source location.
      Preserve selection while other results arrive; deep links survive refresh.
- [ ] **U3 — Explain Replay divergence.** Show the divergence step, reused prefix,
      reason, and whether Adaptive fallback occurred. Use existing runner events;
      do not imply a cache-only run silently switched to inference.
- [ ] **U4 — Maintain an interaction.** Verify canvas and list locator editing,
      validation errors, protected operations, unsaved-change behavior, save failure,
      concurrent writers, and reload persistence. Explain what Save affects and let
      QA rerun the Scenario to verify the outcome. Report cache-clear behavior honestly.
- [ ] **U5 — Repeat a focused test.** Verify failed-Scenario/profile rerun preserves
      selection and configuration; retain the original evidence and identify the new run.
- [ ] **U6 — Share a diagnosis.** Export a deliberate failure and inspect/import it
      in a second isolated workspace without access to the originating project.
      Missing optional recordings must not prevent diagnosis.
- [ ] **U7 — Accessible investigation.** Verify keyboard-only navigation, focus
      restoration, labeled controls, result states beyond color, zoom, smaller screens,
      reduced motion, and a large catalog/run. Automated accessibility checks supplement
      hands-on use. Canvas functionality needs an equivalent usable list path.

Exit: the core acceptance session in the QA record passes. Proposed pilot target:
at least four of five new testers finish setup → assertion → deliberate failure →
diagnosis → focused rerun → evidence handoff without maintainer intervention.
Record assistance and individual timings; this is a learning gate, not market proof.

## Milestone 2: Features that improve adoption

Prioritize observed pilot blockers over expanding the surface. Reuse existing
contracts where possible; design review precedes new public APIs or durable formats.

| Order | Feature                                      | Acceptance before marking complete                                                                                                                                                                            |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1    | Authenticated setup and repeatable test data | A documented login/setup path runs twice with isolated data, handles expired auth, and leaves secrets out of evidence. Inventory existing support before introducing a flow abstraction.                      |
| F2    | Better assertions and Specification health   | QA sees ambiguous actions or missing outcomes and can add a meaningful assertion; an intentionally broken application still fails.                                                                            |
| F3    | CI handoff                                   | One runnable CI recipe has correct exit codes, JUnit output, cache-only behavior, and a portable failure that opens locally.                                                                                  |
| F4    | Plan maintenance beyond the cache            | Decide from observed needs whether durable authored revisions are required. If built, verify review, full-Scenario validation, activation, rollback, eviction survival, and historical provenance end to end. |
| F5    | Visual comparison                            | Compare compatible screenshots/regions, explain unavailable or incompatible baselines, and review intentional baseline changes. Extend existing comparison surfaces.                                          |
| F6    | Simple suite health                          | Show pass/flake rate, duration, cache usage, inference count, and measured cost where available. Define denominators and missing-data behavior.                                                               |
| F7    | Reusable flows and project knowledge         | Reuse authentication/data/journeys with parameters and repository-owned terms; show dependency impact and preserve behavior when shared flows change.                                                         |

F1–F3 should advance when they remove primary-workflow blockers. F4–F7 follow
pilot evidence. A feature's usefulness does not automatically make it a launch gate.

## Milestone 3: Technical preview and launch

Use the [launch and growth plan](docs/launch-and-growth.md) for assets, ownership,
and rollout. Keep the date unset until the primary journey passes.

- [ ] **L1 — Claim audit.** Quick start, website, package README, demo, roadmap,
      and support matrix describe the same candidate and limitations. Repair broken
      documentation links; remove claims unsupported by acceptance evidence.
- [ ] **L2 — Demonstration package.** One synthetic example shows a meaningful pass,
      deliberate failure, diagnosis, and applicable Replay, with a portable report.
- [ ] **L3 — Support matrix.** Record OS, runtime, browser/device/provider, test app,
      revision, and evidence for each advertised environment. Local Chrome evidence
      does not certify attached CDP, Browserbase, Android, or iOS.
- [ ] **L4 — Pilot.** Observe five external projects. Log version, task, assistance,
      blocker, time, diagnosis accuracy, and return on another day within seven days.
- [ ] **L5 — Release operation.** Assign release and support owners; review known
      issues and recovery instructions. After authorized publication, verify the exact
      registry version/dist-tag in a clean project before broad promotion.

Technical preview requires Milestones 0 and 1 for its advertised scope and explicit
limitations for everything else. Broader launch requires repeated external use,
resolved repeated blockers, and support capacity. Publication and outreach are
owner actions, not side effects of editing this roadmap.

## Later capabilities

Retain these from the earlier roadmap without committing dates:

- Execution controls: individual Scenario cancellation, manual evidence capture,
  safe pause-after-step, concurrent target filmstrip, and picture-in-picture.
  Follow-mode pause must remain distinct from suspending execution.
- Agent integration: read-and-run local MCP for readiness, run control, events,
  results, and artifacts; add authoring and maintenance operations over shared contracts.
- Planned authoring: coverage exploration, approved plan-to-draft generation,
  built-in authoring, selected-step preview, semantic review, grounded autocomplete,
  and observed journey/variant coverage. Preserve source and exploration provenance.
- Guarded maintenance: evidence-based failure classification with override,
  bounded repair proposals, full validation, suite circuit breaker, quarantine
  with owner/expiry, and explicit delivery policy. Never heal application regressions.
- Scale: deeper trends and suite-health ranking, explained change-impact selection
  with full-suite fallback, PR annotations, shard merging, remote-target parity,
  and physical devices when the adapter supports them.
- Hosted collaboration: decide only after local workflows demonstrate repeat use;
  synchronization, access control, audit logs, and multi-user review remain future scope.

## Measurement and completion

Record exact candidate, environment, command/session, outcome, skipped cases,
artifact location, defect, retest, and responsible owner for every gate.
Use `passed`, `failed`, `blocked`, or `not run`; keep implementation status separate.

Track first-green timing, correct failure diagnosis without rerun, failed-step
evidence completeness, successful maintenance and rerun, Replay eligibility/hits,
inference count, and seven-day repeat use. Initial aspirations remain two minutes
from ready prerequisites to first green and 80% diagnosis without rerun; neither
has been measured here. Measure plan-to-passing time only when built-in authoring
exists, and repair/selection safety only when those features are available.
