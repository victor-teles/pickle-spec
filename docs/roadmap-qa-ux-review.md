# Roadmap review: QA workflows, usability, reach, and simplicity

Reviewed on 2026-09-04. This is a proposed revision strategy for
[ROADMAP.md](../ROADMAP.md), not a replacement roadmap or an implementation
status certification. The companion [launch and growth plan](launch-and-growth.md)
turns the adoption priorities into release and distribution work.

## Recommendation

Finish the everyday QA loop before expanding autonomous authoring and repair:
connect a real application, write a meaningful assertion, run it, understand a
failure, maintain the generated interactions, rerun the affected scenario, and
give a teammate useful evidence.

The roadmap is strong on inspectable execution and source ownership. It is less
specific about the work that makes a QA practitioner return tomorrow. Prioritize
authentication, repeatable test data, assertion quality, failure recovery, and CI
handoff ahead of picture-in-picture, broad exploration, and autonomous repair.
Feature reach should mean more real journeys successfully tested with the same
few concepts, rather than more modes and dashboards.

## Findings by impact

### High: completion status is internally inconsistent

The platform summary at ROADMAP.md line 16 says live target video and web traces
are absent. Lines 60–63 mark browser viewing, device mirroring, diagnostics, and
time-travel inspection complete. Neither statement establishes which targets and
artifact types have passed a real release test.

The unchecked follow-mode item at line 66 also combines existing behavior with
future work. The inspected [live follow model](../packages/studio/src/features/runs/result/live-result-follow.ts)
already selects failing attempts, preserves a pinned location, and follows
timeline entries. That proves implementation exists, not that picture-in-picture
or the full user journey is complete.

Split compound items and attach a release revision, supported target list, and
verification link to each completed capability. Distinguish implemented,
verified on a real target, and planned. Reconcile the summary only after that
inventory. Do not restart features merely because their checkbox is stale.

### High: QA needs ownership of the generated execution plan

A QA engineer's feedback, relayed by the project owner, identifies a missing
workflow: AI produces cached interactions, and a human must be able to edit and
maintain them, with autonomous repair available when appropriate. This is one
qualitative signal, not a measured demand rate, but it directly affects whether
a team can maintain a suite after its first successful run.

Use execution plan for the ordered actions and checks used by Replay. The
coverage plan in Phase 3 describes what to test; the execution plan describes
how a Scenario runs. Keep the Gherkin Specification as the source of expected
behavior. Editing a click target must not silently change what the test asserts.

Promote execution-plan inspection and manual maintenance into the core QA loop.
Provide one workflow with two ways to prepare a change: the QA engineer edits
an interaction, or AI proposes a repair. Both use the same diff, validation,
version history, and activation rules. Autonomous application can follow later
through explicit project policy and bounded attempts.

The proposed interaction is:

1. Open the execution plan from a Scenario or failing step. Show ordered actions
   grouped by Gherkin step, with targets, non-secret inputs, checks, and the
   evidence used to generate them. Explain complete and partial cached paths.
2. Edit supported action fields directly, or insert, remove, and reorder
   supported interactions. Offer contextual controls for targets and inputs;
   do not require QA to edit SQLite or an opaque adapter payload. Label any
   unsupported operation and explain the available recovery path.
3. Alternatively, request an AI repair for the failing interaction. Show its
   proposed changes and evidence. Preserve a manual path that needs no model
   credentials for editing or Replay validation.
4. Validate the candidate against the affected Scenario from a known initial
   state. Keep the original expected outcomes. An isolated action preview is
   useful feedback, but cannot establish that the Scenario still works.
5. Activate only the validated revision, recording the human or AI author,
   change diff, source run, and validation result. Keep the previous revision
   available for rollback. Existing runs retain their original evidence.

Human edits are authored work. They must survive cache eviction and must not be
silently overwritten by Cache refresh. Before implementation, decide how durable
repository-owned plan revisions produce disposable runtime cache entries, how
refresh reconciles edits, and how changes to the Specification, application,
profile, or adapter invalidate applicability. Reuse existing cache eligibility
rules. This review proposes the requirement without selecting a new storage
format or changing the current cache contract.

Start with inspection and manual editing, then AI-assisted repair through that
same workflow. Autonomous repair must obey the same validation gate, preserve
assertions, stop on uncertain or repeated failures, and retain a rollback path.
A real application regression stays failed. Changes to expected behavior belong
in an explicit Specification review, not interaction repair.

### High: first green is too weak an activation criterion

Phase 1 measures two minutes only after credentials and target access are ready.
That excludes much of the likely setup friction. A passing example also does
not establish that someone can test their own application or detect a defect.

Keep the two-minute ready-to-example goal as a diagnostic metric. Add total
setup time, blocked and abandoned attempts, first real-application assertion,
and a deliberate failure that the user can explain. Separate credential-free
demonstration from successful Adaptive execution and applicable Replay.

The [onboarding model](../packages/studio/src/features/onboarding/first-run-onboarding-model.ts)
has explicit empty, blocked, ready, running, failed, and complete states. Use
those states as the starting point for a journey audit instead of adding another
onboarding system. No timing or user completion rate was measured in this review.

### High: repeatable QA setup is buried in a large authoring phase

Phase 3 line 81 bundles authentication, setup, data, variables, and reusable
journeys. These are prerequisites for testing ordinary logged-in applications,
including manually authored Specifications. They should not depend on a coverage
planner or built-in generation.

First document and verify what existing configuration and Gherkin support.
Then close observed gaps for login, data isolation, cleanup, and state reset.
Extract reusable flows only after two actual scenarios need the same behavior.
A payment journey needs an explicit expected result and controlled test data
before it needs an agent-generated plan.

### High: failure diagnosis and CI arrive too late

Phase 4 line 101 makes diagnosis without rerunning an exit criterion. Phase 5
line 110 delays cache-only CI guidance and archived-failure handoff. These are
core adoption tasks for a QA tool, even when repair and suite analytics are absent.

Move basic diagnosis and a single-run CI recipe into launch readiness. Existing
[CLI exports, selective reruns, and cache rules](../README.md) provide a starting
point. Show expected versus observed behavior, the relevant step and artifact,
application revision, execution mode, and a useful next action. Missing evidence
must have an explicit reason. Keep unknown causes unknown.

Basic CI use should not wait for PR annotations, shard merging, or a hosted
service. Verify one failed CI run exported, downloaded, imported, and understood
in local Studio without access to the original workspace.

### Medium: the roadmap lacks a usable feature-reach boundary

Web and mobile adapter names do not answer which journeys a QA team can trust.
The README already records meaningful asymmetry: web can replay a stored prefix,
while mobile Replay requires a complete Scenario. A parity promise hides that
important difference.

Publish a task-based support matrix before broad launch. For local web, attached
CDP, Browserbase, Android Emulator, and iOS Simulator, record authentication,
isolation, assertions, uploads/downloads where applicable, live viewing,
artifacts, Replay, cancellation, and CI setup. Each cell needs a status and a
reproducible example. Use unsupported and unverified distinctly. Audit existing
support before adding functionality. Keep physical devices and hosted
collaboration explicitly outside the initial release promise.

### Medium: authoring and operator features need smaller contracts

Phase 2 combines follow mode, pinning, filmstrip, picture-in-picture, capture,
and cancellation. Phase 3 adds planning, generation, preview, semantic review,
project knowledge, reusable state, health analysis, and autocomplete.

Start with one selected scenario and one evidence inspector. Explain Run,
Replay, and Cache refresh where users choose them. Put advanced diagnostics
behind the failing step; preserve the selected evidence while new events arrive.

For authoring, start with an editable template, clear assertion guidance, and
full-scenario validation. A step preview must explain its initial state, setup,
side effects, and whether it changed the live application. A green isolated step
must not imply a green scenario. Keep generated drafts and acceptance when AI
is added, but require the full planner only for workflows that need exploration.

### Medium: accessibility and recovery are absent from release gates

The existing gates cover security and portability but do not establish keyboard
completion, focus recovery, zoom, readable narrow layouts, or streaming behavior.
Add keyboard and screen-reader checks for selecting, running, inspecting,
cancelling, and exporting. Verify focus after dialogs, failures, and rerenders.
Live updates must not steal focus or continuously flood announcements.

Also test invalid credentials, missing targets, stale live connections, cancelled
runs, unavailable artifacts, and unsaved edits. Every blocked state should say
what happened, preserve useful work, and expose the next supported action.

### Medium: visual guidance and scheduling have drifted

ROADMAP.md line 41 names Bone, teal, oxide, and amber. Current
[DESIGN.md](../DESIGN.md) specifies neutral hierarchy, near-white primary
controls, and written green/red result states. Refer to DESIGN.md as the visual
source of truth rather than repeating tokens in the roadmap.

The overlapping week ranges have no start date, capacity, or estimates. Replace
them with ordered milestones and dependencies until the remaining work is sized.
Watching a run is useful, but the share of watched runs is not a success measure
by itself. An efficient team may need to watch fewer runs.

## Proposed sequence

These are recommendations for the next roadmap revision, not new delivery dates.

| Milestone | Work to include | Exit evidence |
| --- | --- | --- |
| 1. Trust the release | Reconcile status, support matrix, installation, setup recovery, evidence availability | Exact release installed outside the monorepo; every advertised target has recorded real-target proof |
| 2. Complete the QA loop | Meaningful assertions, authenticated example, isolated data, failure explanation, manual execution-plan maintenance, selective rerun, export and basic CI | External users repair a changed interaction through a validated plan revision; a seeded regression remains failed |
| 3. Grow useful coverage | Templates, needed shared setup, manual Specification health, smallest draft/review/validate flow | A user adds a second independent journey and can explain its expected results |
| 4. Reduce maintenance | Compatible visual comparison, evidenced classification, visible quarantine, AI-assisted and policy-controlled autonomous plan repair | Known app regressions remain failures; every accepted change has source and validation evidence |
| 5. Scale proven usage | Trends, PR annotations, shard merging, agent workflows, change-impact experiments | Returning projects demonstrate a specific bottleneck and the change improves it |

Continue using the current shared runner and evidence contracts throughout.
Read-and-run MCP can move earlier if active coding-agent users demonstrate that
it is their adoption blocker. It should not delay the human QA loop.

Defer picture-in-picture, a concurrent-target filmstrip, broad autonomous
exploration, physical devices, and hosted collaboration until observed use makes
them necessary. Keep safe cancellation, live/completed evidence consistency, and
explicit Replay divergence in the near-term scope.

## QA acceptance session

Recruit five external QA practitioners or developers with testing responsibility.
Use their own small applications when access permits. Record assistance,
completion, elapsed time, and blockers for each task. The following thresholds
are proposed planning gates, not measured product performance or statistical
proof of market readiness.

| Task | Acceptance check |
| --- | --- |
| Install and connect | Four of five reach a ready target without maintainer intervention; report total setup time and all failed attempts |
| Write and run | Four of five create a real assertion and explain why it passed; record time separately from example completion |
| Detect a regression | A seeded incorrect application outcome fails every time in the test fixture; no fallback weakens the assertion |
| Diagnose | Four of five identify the seeded cause within five minutes from persisted evidence without rerunning |
| Repeat | Eligible scenarios Replay without inference; misses, partial prefixes, and divergence are explained accurately |
| Maintain interactions | Four of five locate and edit a changed interaction without raw cache editing, validate the Scenario with unchanged assertions, and activate the revision; record time and assistance |
| Preserve ownership | A validated manual change survives cache eviction; refresh exposes conflicts rather than overwriting it; rollback restores the previous plan revision |
| Reject an unsafe repair | A candidate that skips or weakens the failed assertion cannot be activated as an interaction repair; failed validation leaves the active revision unchanged |
| Recover | An invalid credential or disconnected target gives a usable recovery path without losing edits |
| Hand off | A second person opens the exported failure and identifies the failed expectation without the author's help |
| Return | At least three projects run again on a different day within seven days; assisted and unassisted returns stay separate |

Run the core journey with keyboard alone, at 200% zoom, and at a narrow viewport.
Inspect long names, large histories, unavailable artifacts, and concurrent events.
A walkthrough or DOM check is not evidence that these sessions passed.

For diagnosis measurements, use an explicit case set covering application
regression, assertion defect, setup/data failure, infrastructure failure, and
Replay divergence. Report correct answers and denominators by cause. The
roadmap's 80% target should not be reported against only easy example failures.

## Simplicity rules for the revision

- Keep the existing navigation. Put new actions beside the task that needs them.
- Show one clear primary action and progressively disclose advanced controls.
- Keep Scenario result, execution mode, and cache outcome distinct, with short explanations.
- Separate local Studio links from portable reports; a localhost URL is not a teammate-sharing mechanism.
- Reuse the same failed-step evidence for live viewing, history, reruns, and exports.
- Prefer a documented existing configuration path before creating a new wizard or abstraction.
- Add a feature only with a named QA task, an observed gap, and a completion check.

## Evidence and limits

The execution-plan maintenance requirement incorporates QA feedback supplied by
the project owner after the initial review. It is proposed product work; no plan
editor, durable revision format, or repair workflow was implemented or verified.

This review read the roadmap, README, DESIGN.md, release policy, onboarding
model, and live follow implementation. It did not run Studio, test a published
package, provision execution targets, or conduct usability interviews. Gaps in
the roadmap are not automatically missing runtime features.

The earlier [competitive review](roadmap-competitive-review.md) remains historical
context. Current [Playwright documentation](https://playwright.dev/docs/test-agents)
was checked on 2026-09-04 and describes planner, generator, and healer roles.
That supports treating AI authoring as an existing competitive capability; it
does not establish demand, quality, or a reason to match every feature before
launch. The priority choices above are product judgments to test with users.
