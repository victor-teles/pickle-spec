# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary Studio user is a QA professional or test author sitting with a local project: they browse Specifications, run a Scenario or a Specification, and diagnose failures and adaptations before the run is trusted.

Developers and CI operators use `pickle run` without Studio. Test leads reuse suites, execution target profiles, and plan promotion, but Studio UI is optimized for the authoring-and-diagnosis job first.

## Product Purpose

Pickle Spec is a local-first test automation and management platform. It covers the full lifecycle of Specifications: authoring, execution against an execution target, live result diagnosis, and explicit execution-plan promotion.

Success is that a team can keep Gherkin in Git, run the same Scenarios locally and in CI, and understand a failed or adapted result without leaving the project.

## Positioning

Feature files remain the source of truth. Collaboration and approval happen in Git and pull requests, not inside Studio.

Scenarios are independent of Stagehand and other adapters. Adaptive mode resolves actions while a Scenario runs and writes a candidate plan. Replay mode uses an approved, reviewable plan. Adaptations never silently replace that plan.

A neighboring runner could copy model-driven clicks. It could not truthfully claim Gherkin-as-source, adapter-neutral Scenarios, and explicit plan promotion in one local product.

## Operating Context

- `pickle studio` starts the local Studio on loopback and opens the configured project.
- `pickle run` is the non-interactive CI and scripting surface. It can export a self-contained HTML report.
- Specifications live as Gherkin feature files in the repository. Approved execution plans belong in Git under `.pickle/plans/`.
- Immutable test runs live under `.pickle/runs/<run-id>/` as an event stream, a materialized manifest, and separate test artifacts. They stay out of Git.
- Studio navigation uses Specifications, Runs, Plans, and Settings as stable primary areas. Specifications is the current working room; Runs, Plans, and Settings remain visible as a disabled product map.
- The current Studio slice lists Specifications, authors them through synchronized Structured and Source views, starts a scoped test run (one Specification, one Scenario, or all Specifications), streams live progress, and diagnoses results in the Scenario table, Needs attention list, and step timeline. Git, plan promotion, and history land in later slices.

## Capabilities and Constraints

- Domain language follows `CONTEXT.md`. Use Specification, Scenario, test run, test result, execution target, execution target profile, Adaptive mode, Replay mode, Adaptation, candidate plan, run event, test artifact, and Studio. Do not substitute Cucumber, Playwright, or “self-healing” vocabulary.
- Studio binds to `127.0.0.1`, requires a session token, and validates request origins. Remote access requires an explicit option and warning.
- Studio uses shadcn-owned Mira components (`base-mira`) backed by `@base-ui/react` primitives.
- The first version documents a future hosted synchronization path and contains no cloud API, hosted storage, or hosted authentication.
- Studio never pushes Git automatically. It must not duplicate repository permissions, comments, or approvals.
- Execution plans are per Scenario revision, execution target profile, plan-format version, and application revision. A plan does not transfer across profiles.
- Custom adapters are imported explicitly. The first version does not discover plugins dynamically.
- Mobile execution targets (Android Emulator, iOS Simulator) are in the product direction and out of the current Studio slice.
- The current package can replace public shapes without a compatibility layer; the repository has no external users yet.

## Brand Commitments

The product name is Pickle Spec. Voice is precise and technical: state what the system does, in the domain terms above, without marketing fluff.

No logo, illustration, or third-party brand system is binding beyond the name and that voice.

## Evidence on Hand

- Domain glossary: `CONTEXT.md`
- Architecture decisions: `docs/adr/`
- Product spec: GitHub issue #10
- Sample Specifications: `apps/example`
- Studio UI source: `packages/studio/src/`

There are no external customers, testimonials, benchmarks for marketing use, or press assets. Future work must not invent them.

## Product Principles

- Keep feature files and Git as the system of record; Studio is a local operator, not a second source of truth.
- Make diagnosis possible while a test run is still in progress; do not wait on a finished report file.
- Never change an approved execution plan, Specification, or remote repository without an explicit user action.
- Keep Scenarios adapter-neutral so the same behavior can run on web now and other execution targets later.
- Say exactly what happened: failed, adapted, cancelled, skipped, infrastructure error, or flaky — not a collapsed “broken test.”

## Accessibility & Inclusion

Studio must meet WCAG 2.2 AA, support complete keyboard navigation, honor reduced motion, and preserve focus during live updates.
