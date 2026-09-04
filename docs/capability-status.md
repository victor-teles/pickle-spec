# Capability and release evidence

ENG-01 inventory, inspected on 2026-09-04 at source revision
`1e4f24f6cb072d0bbf55f23588c5278696e62ea6`. The matrices and original test
results below describe that baseline. A subsequent authorized workflow fix is
recorded under [Release workflow follow-up](#release-workflow-follow-up).
Package manifests declare `1.0.2`; this audit does not establish what is
published on npm.

This reference qualifies the capabilities advertised in [README.md](../README.md)
and checked in [ROADMAP.md](../ROADMAP.md). Future roadmap items remain proposals.
[DESIGN.md](../DESIGN.md) owns Studio's visual conventions and tokens.

## ENG-01 acceptance

| Requirement | Delivered result | Acceptance evidence |
| --- | --- | --- |
| Resolve contradictory live-view and diagnostic status | Roadmap summary and Phase 2 both describe implemented browser frames, Browserbase embeds, device frames, and bounded web diagnostics. Live-target verification remains separate. | [Roadmap summary](../ROADMAP.md#where-the-platform-stands), [web evidence](#web-evidence), and [Studio evidence](#studio-evidence). |
| Split compound items | Follow mode, concurrent-target filmstrip, and picture-in-picture have separate roadmap entries and inventory rows. Follow is implemented; filmstrip and picture-in-picture are unsupported. Operator controls and web diagnostics are also split by operation. | [Roadmap Phase 2](../ROADMAP.md#phase-2-observable-execution-theater-weeks-514) and [shared capabilities](#shared-product-capabilities). |
| Produce a task-based matrix for all five targets | The two matrices below cover setup, assertions, artifacts, Replay, cancellation, CI, plan inspection, and plan editing for local web, attached CDP, Browserbase, Android Emulator, and iOS Simulator. | [Run matrix](#set-up-and-run-a-scenario) and [evidence and plan matrix](#watch-execution-and-inspect-evidence). |
| Record status, revision, evidence, and current design ownership | Every target cell carries an implementation status and an evidence link. The source revision appears above; executed checks and live-verification limits appear in the evidence register. DESIGN.md owns tokens. | [Status definitions](#evidence-status), [check results](#ci-and-release-evidence), and [DESIGN.md](../DESIGN.md). |

The [inventory acceptance tests](../tests/unit/scripts/capability-status.test.ts)
check target/task coverage, explicit statuses, evidence links, revision format,
separate roadmap entries, and the design reference. These are document-contract
checks. They do not turn an implemented capability into a verified live-target
claim. The source and behavioral evidence below support those distinctions.

## Evidence status

| Status | Meaning in this inventory |
| --- | --- |
| Implemented | A production path exists in the inspected revision. Limits and evidence links define its scope. |
| Verified | The named check passed in this audit. Its boundary matters; a controlled adapter or static-rendering test does not verify a live target. |
| Unsupported | The requested operation has no supported product path in this revision. A related lower-level mechanism does not supply it. |
| Unverified | This audit has no executed evidence for the stated claim. This does not mean the feature failed. |

All five real-target workflows are **unverified** in this audit. No application
revision, real-model run, attached browser session, Browserbase session, or
device run was exercised. The matrices use **Implemented** for source-backed
behavior; the evidence register identifies which controlled checks are
**Verified**. This avoids treating shared adapter tests as five live passes.

## Set up and run a Scenario

All targets require valid project configuration, a reachable application, and
the configured model credential for Adaptive execution. Complete cache-only
execution still needs the target, application state, runtime variables, and an
applicable cache entry. It does not need model inference.

| QA task | Local web | Attached CDP | Browserbase | Android Emulator | iOS Simulator |
| --- | --- | --- | --- | --- | --- |
| Check setup | Implemented. Doctor launches and closes local Chrome. [Setup evidence](#setup-evidence) | Implemented. Validates connection configuration; connectivity is unverified. [Setup evidence](#setup-evidence) | Implemented. Validates configuration; remote connectivity and authentication are unverified. [Setup evidence](#setup-evidence) | Implemented. Discovers a compatible booted Emulator through the Node worker. [Setup evidence](#setup-evidence) | Implemented. Discovers a compatible booted Simulator through the Node worker. Requires macOS/Xcode. [Setup evidence](#setup-evidence) |
| Execute assertions | Implemented. Adaptive verification and supported deterministic assertions. [Web evidence](#web-evidence) | Implemented through the shared web adapter; no live attachment proof. [Web evidence](#web-evidence) | Implemented through the shared web adapter; no live service proof. [Web evidence](#web-evidence) | Implemented through the mobile gateway and supported `.ad` assertions. [Mobile evidence](#mobile-evidence) | Implemented through the same mobile gateway and `.ad` assertions. [Mobile evidence](#mobile-evidence) |
| Replay a complete Scenario | Implemented. Direct stored browser operations with zero inference. [Replay evidence](#replay-evidence) | Implemented through the same web Replay path and CDP connection. [Replay evidence](#replay-evidence) | Implemented through the same web Replay path and remote connection. [Replay evidence](#replay-evidence) | Implemented. Materializes and runs a complete cached Agent Device script. [Replay evidence](#replay-evidence) | Implemented. Materializes and runs a complete cached Agent Device script. [Replay evidence](#replay-evidence) |
| Reuse a partial prefix | Implemented. Prefer-cache replays the head, then uses Adaptive execution; cache-only fails. [Replay evidence](#replay-evidence) | Implemented with the shared web prefix rules. [Replay evidence](#replay-evidence) | Implemented with the shared web prefix rules. [Replay evidence](#replay-evidence) | Unsupported. Mobile Replay requires a complete Scenario. [Replay evidence](#replay-evidence) | Unsupported. Mobile Replay requires a complete Scenario. [Replay evidence](#replay-evidence) |
| Cancel a Test run | Implemented. Run abort and browser cleanup. [Cancellation evidence](#cancellation-evidence) | Implemented. Abort/attachment cleanup path; live ownership behavior unverified. [Cancellation evidence](#cancellation-evidence) | Implemented. Shared abort/cleanup path; remote termination unverified. [Cancellation evidence](#cancellation-evidence) | Implemented. Worker cancellation protocol. [Cancellation evidence](#cancellation-evidence) | Implemented. Worker cancellation protocol. [Cancellation evidence](#cancellation-evidence) |
| Run in CI | Implemented CLI contract; live job unverified. Local Chrome and application provisioning required. [CI evidence](#ci-and-release-evidence) | Implemented CLI contract; live job unverified. Reachable CDP endpoint required. [CI evidence](#ci-and-release-evidence) | Implemented CLI contract; live job unverified. Service credentials required. [CI evidence](#ci-and-release-evidence) | Implemented CLI contract; live job unverified. Booted Emulator required. Smoke skips by default. [CI evidence](#ci-and-release-evidence) | Implemented CLI contract; live job unverified. macOS and booted Simulator required; no macOS CI job. [CI evidence](#ci-and-release-evidence) |

## Watch execution and inspect evidence

| QA task | Local web | Attached CDP | Browserbase | Android Emulator | iOS Simulator |
| --- | --- | --- | --- | --- | --- |
| Watch the selected live target | Implemented. CDP screencast frames. [Studio evidence](#studio-evidence) | Implemented. CDP screencast frames. [Studio evidence](#studio-evidence) | Implemented. Browserbase live-session iframe. [Studio evidence](#studio-evidence) | Implemented. Device frames through the worker. [Studio evidence](#studio-evidence) | Implemented. Device frames through the worker. [Studio evidence](#studio-evidence) |
| Inspect screenshots and action evidence | Implemented. Artifact policy controls capture. [Web evidence](#web-evidence) | Implemented through shared capture; live fidelity unverified. [Web evidence](#web-evidence) | Implemented through shared capture; live fidelity unverified. [Web evidence](#web-evidence) | Implemented. Gateway screenshots and resolved-action evidence. [Mobile evidence](#mobile-evidence) | Implemented. Gateway screenshots and resolved-action evidence. [Mobile evidence](#mobile-evidence) |
| Inspect recordings, traces, and diagnostics | Implemented. Structured activity, instrumented console/network, optional MP4. [Web evidence](#web-evidence) | Implemented through shared instrumentation; pre-attachment activity is not guaranteed. [Web evidence](#web-evidence) | Implemented through shared instrumentation; not a Browserbase recording import. [Web evidence](#web-evidence) | Implemented. Device logs, recordings, and traces depend on gateway support and policy. [Mobile evidence](#mobile-evidence) | Implemented. Device logs, recordings, and traces depend on gateway support and policy. [Mobile evidence](#mobile-evidence) |
| Inspect a readable execution plan before running | Unsupported. Cache metadata and executed evidence only. [Plan boundary](#execution-plan-boundary) | Unsupported. Same boundary. [Plan boundary](#execution-plan-boundary) | Unsupported. Same boundary. [Plan boundary](#execution-plan-boundary) | Unsupported. Same boundary. [Plan boundary](#execution-plan-boundary) | Unsupported. Same boundary. [Plan boundary](#execution-plan-boundary) |
| Edit, validate, activate, or roll back a durable plan | Unsupported. ENG-03 through ENG-08. [Plan boundary](#execution-plan-boundary) | Unsupported. ENG-03 through ENG-08. [Plan boundary](#execution-plan-boundary) | Unsupported. ENG-03 through ENG-08. [Plan boundary](#execution-plan-boundary) | Unsupported. ENG-17 extends approved maintenance to mobile. [Plan boundary](#execution-plan-boundary) | Unsupported. ENG-17 extends approved maintenance to mobile. [Plan boundary](#execution-plan-boundary) |

Live frames are transient. A completed run retains recorded evidence under its
artifact policy, not a replayable history of every streamed viewport frame.
Missing, not-requested, unsupported, and capture-failed evidence remain distinct.
An artifact reference alone does not establish that its bytes are retained or
that a portable export contains them.

## Shared product capabilities

These capabilities apply to the common runner, CLI, or Studio workflow. They
do not imply target-specific live verification.

| Advertised capability | Supported scope and evidence status |
| --- | --- |
| Gherkin Specifications, identities, tags, and sharding | Implemented. [Parser](../packages/spec/src/parsing/specification.ts), [identity](../packages/spec/src/identity/identity.ts), and [selection](../packages/spec/src/selection/selection.ts) own the contracts. Package unit result was reused by Turbo; no fresh user workflow claimed. |
| Scheduling, retries, flake marking, and immutable runs | Implemented. [Runner](../packages/runner/src) owns execution and persistence. Repository unit gate passed with cached runner results. Real-target retry behavior is unverified here. |
| CLI initialization, checks, migration, and target discovery | Implemented. [CLI entry](../packages/cli/src/cli.ts) composes commands. Fresh CLI unit suite passed; clean public-package installation is unverified. `check` validates project/configuration; `doctor` probes environment readiness within the limits above. |
| Specification catalog and Gherkin editing | Implemented in [Specifications](../packages/studio/src/features/specifications) and [documents](../packages/studio/src/features/documents). Fresh Studio unit suite passed; this audit did not drive Monaco or save a document in a browser. |
| Global Runs, routing, and command palette | Implemented in [Runs](../packages/studio/src/features/runs) and [Studio](../packages/studio/src/features/studio). Fresh route, run, and palette unit checks passed. Browser refresh and keyboard workflows are unverified here. |
| First-run onboarding and credential-free example | Implemented in [onboarding](../packages/studio/src/features/onboarding). Unit checks passed. The example does not prove access to a real application; the two-minute first-green target is unverified. |
| Shared evidence, time travel, and live timeline | Implemented. The [result inspector](../packages/studio/src/features/runs/result/result-inspector.tsx) uses shared live/completed projections. Fresh tests cover reconstruction, incomplete evidence, disconnection, and event loss. Human diagnosis success is unverified. |
| Follow and pin an investigation | Implemented in [live follow](../packages/studio/src/features/runs/result/live-result-follow.ts) and [inspection](../packages/studio/src/features/runs/result/live-result-inspection.ts). Verified by 19 inspection unit tests, including manual intervention, resume, and pinned later failures. Pausing follow does not pause execution. |
| Concurrent target filmstrip | Unsupported. [Viewport storage](../packages/studio/src/features/runs/result/live-result-inspection.ts) retains frames by target; the [inspector](../packages/studio/src/features/runs/result/result-inspector.tsx) displays a selected target. Roadmap Phase 2 follow-up. |
| Picture-in-picture | Unsupported. No product control in the inspected viewport flow. Roadmap Phase 2 follow-up. |
| Operator controls | Run-level cancel and investigation pin are implemented. Individual Scenario cancellation, pause-after-step, and on-demand evidence capture remain unsupported in the Studio flow. [Run detail](../packages/studio/src/features/runs/run-detail.tsx) exposes run-level cancellation. |
| Replay divergence explanation | Events and timeline evidence are implemented. A complete explanation of divergence, sealed prefix, and fallback is still pending ENG-09. A passed Adaptive fallback is not pure Replay. |
| Cache inspection, refresh, clearing, and eviction | Implemented. [Cache gateway](../packages/cli/src/studio/studio-cache.ts) exposes metadata and clear; [Settings](../packages/studio/src/features/settings/execution-cache-settings.tsx) presents them. The fresh CLI metadata test verifies payload exclusion. Durable authored plans are unsupported. |
| History, run retention, comparison, and selective rerun | Implemented in [runner results](../packages/runner/src/results) and [CLI archive commands](../packages/cli/src/run/run-archive-commands.ts). Runner unit results were cached; fresh CLI unit checks passed. Imported failure handoff remains unverified under ENG-11. |
| JSON, NDJSON, JUnit, HTML, archives, and Allure exports | Implemented by [output writers](../packages/runner/src/exports/outputs.ts). Allure is raw results, not a bundled renderer. HTML embeds available artifacts according to policy. Actual browser downloads and separate-workspace imports are unverified here, assigned to ENG-11. |
| Settings, credentials, Git integration, and custom adapters | Implemented in [Settings](../packages/studio/src/features/settings), [Git](../packages/studio/src/features/git), and [extensions](../packages/cli/src/extensions/extensions.ts). Custom adapters are explicit imports. Browser workflows and arbitrary third-party adapters are unverified here. |
| Compatible seven-package publication | Unsupported at the inventory baseline because the publish loop omitted `configuration`. The [workflow follow-up](#release-workflow-follow-up) corrects the loop. Actual publication and exact-version installation remain unverified under ENG-13. |
| AI authoring and repair | Optional [authoring extension hook](../packages/cli/src/extensions/extensions.ts) is implemented. Built-in authoring, coverage planning, durable plan repair, and autonomous repair policy remain unsupported. ENG-03 through ENG-08 and ENG-15 through ENG-18 own delivery. |
| Visual diffs, trends, impact selection, PR annotations, shard merging, physical-device provisioning, and hosted collaboration | Unsupported current product scope. These remain future roadmap work, with demand-driven scope in ENG-19. `compare` is not pixel diffing; sharding is not result merging. |

## Evidence register

### Setup evidence

[Web environment diagnostics](../packages/web/src/adapter/configuration/web-environment.ts)
launch a local browser but explicitly avoid remote connectivity checks.
[Mobile diagnostics](../packages/mobile/src/adapter/mobile-environment.ts) check
booted targets and required capabilities. [Doctor](../packages/cli/src/doctor/doctor.ts)
reports readiness and remediation after project validation.

Controlled tests cover [web probes](../packages/web/tests/unit/adapter/configuration/web-environment.test.ts),
[mobile probes](../packages/mobile/tests/unit/adapter/mobile-environment.test.ts),
and [doctor](../packages/cli/tests/unit/doctor/doctor.test.ts). Passing these tests
does not validate a configured credential against its provider.

### Web evidence

[Stagehand factory](../packages/web/src/adapter/automation/stagehand-factory.ts)
selects launch, CDP attach, or Browserbase. [Live execution](../packages/web/src/adapter/session/web-live-session.ts)
maps outcomes to verification and failed expected/actual messages.
[Page instrumentation](../packages/web/src/evidence/web-evidence-script.ts)
collects console, fetch/XHR, resource, and browser activity in a bounded buffer.
[Collection](../packages/web/src/evidence/web-evidence.ts) reports truncation and
collection failures. This is not HAR or a Playwright trace archive.

[Recording](../packages/web/src/evidence/web-recording.ts) samples screenshots at
2 fps and uses local `ffmpeg` for MP4 encoding. A live frame stream and a retained
recording are separate capabilities. Configured redaction does not establish
that arbitrary secrets visible inside screenshot or video pixels are removed.

Controlled [artifact tests](../packages/web/tests/unit/adapter/web-adapter/artifacts.test.ts)
cover capture policy, before/after evidence, and failures.
[Factory tests](../packages/web/tests/unit/adapter/automation/stagehand-factory.test.ts)
cover connection branches, including mocked remote connections.
[Direct-browser tests](../packages/web/tests/unit/adapter/automation/direct-browser.test.ts)
cover the supported deterministic assertion vocabulary. These are not real
application or model evaluations.

### Mobile evidence

[Mobile adapter](../packages/mobile/src/adapter/mobile-adapter.ts) owns the worker
boundary; [mobile documentation](../packages/mobile/README.md) states platform,
Node runtime, artifact policy, and smoke prerequisites. Controlled
[gateway tests](../packages/mobile/tests/unit/agent-device/agent-device-gateway.test.ts),
[script tests](../packages/mobile/tests/unit/agent-device/mobile-ad-script.test.ts),
and [viewport tests](../packages/mobile/tests/unit/agent-device/agent-device-viewport.test.ts)
exercise shared behavior. They do not prove both platform tools produce usable
artifacts on a real device run.

### Replay evidence

[Runner cache contracts](../packages/runner/src/execution-cache/execution-cache.ts)
bind entries to project, Scenario revision, profile, configuration fingerprint,
application revision, adapter, and cache schema. Missing application revision
disables cache use. Refresh replaces disposable cache entries.

[Web public Replay tests](../packages/web/tests/unit/execution-cache/web-public-replay.test.ts)
exercise SQLite and cache-only zero-inference execution with controlled browser
operations. [Web lifecycle tests](../packages/web/tests/unit/execution-cache/lifecycle/replay.test.ts)
cover Replay behavior. [Mobile public cache tests](../packages/mobile/tests/unit/adapter/mobile-adapter.execution-cache.test.ts)
and [agent-device Replay tests](../packages/mobile/tests/unit/agent-device/agent-device-replay.test.ts)
exercise complete scripts without model inference. [Mobile cache validation](../packages/mobile/tests/unit/execution-cache/mobile-execution-cache.test.ts)
rejects partial prefixes. These tests do not prove assertion intent preservation
for human edits, which ENG-03 and ENG-07 must define and verify.

### Cancellation evidence

[Web lifecycle tests](../packages/web/tests/unit/adapter/web-adapter/lifecycle.test.ts)
and [pool tests](../packages/web/tests/unit/adapter/session/web-pool.test.ts)
exercise abort and cleanup. [Mobile adapter tests](../packages/mobile/tests/unit/adapter/mobile-adapter.test.ts)
and [worker tests](../packages/mobile/tests/unit/worker/worker-runtime.test.ts)
exercise cancellation across the worker protocol. Real provider termination,
device cleanup timing, and side effects already performed are unverified.

### Studio evidence

[Viewport rendering tests](../packages/studio/tests/unit/runs/result/result-inspector.test.tsx)
verify frame markup and constrained Browserbase iframe permissions.
[CDP transport tests](../packages/web/tests/unit/adapter/automation/live-viewport.test.ts)
use a local protocol stub, not a live browser.
[Live inspection tests](../packages/studio/tests/unit/runs/result/live-result-inspection.test.ts)
verify follow, pin, diagnostics, event loss, and live/persisted reconstruction.
[Timeline tests](../packages/studio/tests/unit/runs/result/result-evidence-timeline.test.tsx)
and [time-travel tests](../packages/studio/tests/unit/runs/result/time-travel-inspection.test.ts)
cover shared evidence. None establishes real viewport fidelity or accessibility
of the complete rendered workflow.

### Execution-plan boundary

The [Studio cache contract](../packages/studio/src/features/execution-cache/execution-cache.contracts.ts)
contains only metadata inspection and clearing. Its [CLI gateway](../packages/cli/src/studio/studio-cache.ts)
does not expose adapter payloads. The [gateway test](../packages/cli/tests/unit/studio/studio-cache.test.ts)
checks that payloads and runtime variable names do not leak into inspection.
The [Gherkin editor](../packages/studio/src/features/documents/specification-editor.tsx)
edits Specifications. The result inspector displays executed actions. Neither
provides durable plan drafts, validation, activation, rollback, or repair.

### CI and release evidence

[CI configuration](../.github/workflows/ci.yml) separates quality/unit gates
from integration/E2E jobs. [Root scripts](../package.json) and
[CLI scripts](../packages/cli/package.json) define the actual lanes.
[Release validation](releasing.md) distinguishes packed artifacts from
provisioned smokes. The [Studio browser suite](../packages/cli/tests/e2e/studio/studio.test.ts)
exists but was not run for this inventory.

Source inspection of the publish workflow at the inventory baseline confirmed
two gaps. Its loop had six package directories while release package definitions
contained seven. It neither ran integration/E2E nor verified their CI results
on the release revision. The [workflow follow-up](#release-workflow-follow-up)
corrects those omissions; package validation alone did not catch them.

| Command executed in this audit | Result and boundary |
| --- | --- |
| `bun run lint` | Passed, 27 existing warnings, no fixes. |
| `bun run typecheck` | Passed, 8 tasks; 6 reused Turbo cache results. |
| `bun run test` | Passed, 9 script tests and 7 package tasks; 5 package tasks reused Turbo cache results. Fresh Studio suite passed 148 tests; fresh CLI unit suite passed 91 tests. No browser E2E or live target certification. |
| `cd packages/web && bun run test:unit` | Verified, 24 files and 110 tests passed without Turbo cache reuse. Controlled adapters and protocol stubs. |
| `cd packages/mobile && bun run test:unit` | Verified, 12 files and 50 tests passed without Turbo cache reuse. Controlled gateway and worker behavior. |

Integration/E2E, Replay performance, package packing, clean installation of a
published version, and provisioned target smokes were not run in this inventory.
Their current results remain unverified; commands in a policy are not results.

## Follow-up ownership

| Gap | Owner and exit evidence |
| --- | --- |
| Repeatable real application assertions and reset state | ENG-02. Separate changed targets from incorrect business outcomes. |
| Readable and durable execution-plan maintenance | ENG-03 through ENG-08; mobile extension in ENG-17. |
| Complete failure and Replay explanation | ENG-09. Exercise live and persisted failures without relabeling mixed execution as Replay. |
| Setup recovery and remote readiness limitations | ENG-10. Reproduce gaps with configured targets; a configuration check is not authentication proof. |
| Portable CI failure handoff | ENG-11. Inspect actual downloads and imports in a separate workspace. |
| Keyboard, screen reader, 320px, 200% zoom, and live-update stability | ENG-12. Rendered workflow evidence is required. |
| Real-target and exact release-artifact verification | ENG-13. Include attached CDP and Browserbase recipes, OS, application revision, and actual artifacts. |
| Incomplete publication loop and missing integration/E2E publication gates | Corrected by the authorized [workflow follow-up](#release-workflow-follow-up). ENG-13 still requires actual release and installation evidence. |
| Human setup time and diagnosis success | ENG-14. Agent checks are not participant research. |
| Filmstrip, picture-in-picture, individual Scenario cancellation, manual capture, pause-after-step | Separately scoped Roadmap Phase 2 items. ENG-01 does not implement them. |

ENG-01 closes the inventory, not the release gates or the later engineering
tasks. The workflow follow-up does not publish packages or certify a release.

## Interface review

The better-interface review covers the reader's path from the capability links
in README and roadmap to this inventory's status legend, task matrices,
evidence, and follow-up ownership. This is a documentation review, not a review
of Studio screens or a branch-wide interface audit. Repository guidance was
available in the supplied AGENTS.md, local CLAUDE.md, and DESIGN.md. Studio uses
TanStack Start, Rsbuild, Tailwind, and shadcn Mira on Base UI; this inventory
does not change those systems or define replacement design tokens.

All six domain skills were loaded. The applicable source checks ran in their
prescribed order.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Markdown heading hierarchy, descriptive links, written status labels and definitions | Clear for document semantics. Keyboard, screen reader, and rendered table navigation not reviewed. |
| Layout | Reading order from scope to legend, tasks, evidence, and follow-ups; separate execution and evidence matrices | Clear for document organization. 320px, 200% zoom, RTL, and rendered table overflow not reviewed. |
| Writing | Claims checked against the linked implementation; cache metadata, execution plans, live frames, recordings, and verification boundaries named separately | Clear. No remaining actionable wording finding in the reviewed document flow. |
| Typography | No documentation renderer, styles, or font rules changed | Not reviewed. Font metrics, wrapping, truncation, and text resize require a rendered destination. |
| Colors | Roadmap now delegates current tokens to DESIGN.md; status meaning is written | Clear for token ownership and written meaning. Rendered contrast not reviewed. |
| UI polish | No product controls or motion changed | Not reviewed. Hover, focus, active, loading, empty, and error states in Studio are outside this document flow. |

No actionable interface findings within the inspected document semantics,
organization, and writing. Verification included reading the complete document
flow, inspecting cited production paths, and checking local Markdown links and
heading anchors with Bun. `git diff --check` passed. Repository checks and their
limits are recorded above.

**Approve** for the inspected documentation coverage only. This verdict does
not approve rendered Studio design, accessibility, or complete QA workflows.
ENG-12 retains those checks, including empty, loading, error, and narrow-width
states, before the manual-maintenance release can be verified.

## Release workflow follow-up

After the inventory, the user authorized fixing its release-workflow findings.
The working changes based on the revision above add `configuration` first in
the publish loop and run `bun run test:integration` and `bun run test:e2e`
before release preparation and publication. The workflow runs all gates on the
checked-out release revision. Failure stops the job; these steps do not use
`continue-on-error`.

The existing [release acceptance suite](../tests/unit/scripts/release-acceptance.test.ts)
now compares the YAML publish list with `releasePackageDirectories` and checks
that both gates precede preparation and publication. The two regressions failed
against the original workflow and passed after the fix. No dependency, public
API, storage contract, or Studio UI changed. The interface review above remains
limited to documentation; this workflow fix has no rendered design to review.

| Follow-up command | Result |
| --- | --- |
| `bunx --bun vitest run --configLoader runner --experimental.viteModuleRunner=false --experimental.nodeLoader=false --config vitest.scripts.config.ts tests/unit/scripts/release-acceptance.test.ts` | Passed, 7 tests. Before the fix, 2 of these tests failed. |
| `bun run lint` | Passed with 27 existing warnings. |
| `bun run typecheck` | Passed, 8 tasks using Turbo cache results. |
| `bun run test` | Passed, 11 script tests and 7 cached package tasks. |
| `bun run test:integration` | Passed, 148 CLI tests including confidentiality, 10 mobile tests, and 10 web tests. |
| `bun run test:e2e` | Full rerun passed, 125 CLI tests and 2 CLI skips; the 2 provisioned mobile tests skipped. The first run timed out in the reduced-motion Diagnostics check. |
| `cd packages/cli && bunx --bun vitest run --configLoader runner --experimental.viteModuleRunner=false --experimental.nodeLoader=false --config vitest.e2e.config.ts tests/e2e/studio/studio.test.ts -t 'reduced-motion users can review core results on a smaller screen'` | Passed in isolation, 1 test and 29 filtered skips. No Studio code changed between the failed full run, isolated pass, and successful full rerun. The intermittent timeout remains a reliability observation for ENG-12. |
| `bun run release:check` | Passed, validated 7 packages at version `1.0.2`. This packs and checks artifacts without publishing. |
| `bun run benchmark:replay` | Passed, controlled web and mobile p50/p95 gates. |

Actual GitHub release-job execution, npm publication, exact public-package
installation, and provisioned mobile smoke tests remain unverified. The
baseline matrices above retain their original evidence scope.
