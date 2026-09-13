# Capability and release evidence inventory

Source audit: 2026-09-13, source revision `bc5a824317665739cf2d2a4c0ec2aeeec2c7ee8c`.
This inventory restores the missing roadmap/release evidence entry point. It is
not a certification of the published `1.0.2` packages. Test outcomes and remaining
acceptance work are in the [QA record](roadmap-qa-ux-review.md).

| Capability                                                      | Source evidence                                                                                              | Verification boundary                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Specification parsing, selection, runner and evidence           | `packages/spec`, `packages/runner`; package tests                                                            | Source present; application behavior needs target acceptance.                                                                                   |
| Web and mobile execution                                        | `packages/web`, `packages/mobile`; integration and opt-in smoke suites                                       | Local web, CDP, Browserbase, Android, and iOS each need separate live evidence.                                                                 |
| Studio catalog, editing, runs, history, settings, git           | `packages/studio/src/features`; `packages/cli/tests/e2e/studio`                                              | Static rendering and controlled browser suites do not certify live adapters.                                                                    |
| Onboarding and accessible investigation                         | `packages/studio/tests/unit/onboarding`; `packages/cli/tests/e2e/support/studio-hardening-suite.ts`          | Tests exist for accessibility, focus, smaller screens, and large collections. Human acceptance remains pending.                                 |
| Canvas/list Plan inspection and direct locator editing          | `packages/studio/src/features/execution-plans`; `packages/cli/src/studio/studio-execution-plans.ts`          | Save checks applicability, input shape, revision/digest, and writer lease, then publishes the cache entry. It does not itself run the Scenario. |
| Draft revisions and validation infrastructure                   | `packages/runner/src/execution-plans`; `packages/cli/tests/e2e/acceptance/execution-plan-validation.test.ts` | Separate from direct Save. No claim here of a complete user-facing activation/rollback/eviction-survival workflow.                              |
| Packaging and release workflow                                  | `scripts/release-packages.ts`; `.github/workflows/publish.yml`                                               | Pack acceptance and registry installation are separate gates. Source versions do not prove registry availability.                               |
| AI authoring, repair, visual diff, trends, hosted collaboration | Future milestones in [ROADMAP.md](../ROADMAP.md)                                                             | Not certified by this audit; do not advertise as delivered based on the roadmap.                                                                |

## Target qualification

No provisioned target was exercised as part of this source audit. Record exact
OS, runtime, target/provider version, application revision, credential readiness,
run ID, and artifact path for every claimed supported combination.

- Local Chrome: follow the web smoke procedure in [Release validation](releasing.md).
- Attached CDP and Browserbase: verify connection, execution, evidence, and failure
  recovery separately; configuration checks alone do not establish connectivity.
- Android Emulator and iOS Simulator: explicitly enable provisioned smoke checks;
  their default skipped state is not acceptance. Ubuntu CI does not certify iOS.
- Recordings: verify with and without `ffmpeg`; an unavailable optional recording
  must be explained and must not erase other evidence.

## Release decision

Pending. Complete the required checks, primary QA journey, advertised target
smokes, artifact-install check, claim audit, and owner sign-off. Treat candidate
changes after this revision as requiring relevant retests.

## Set up and run a Scenario

Each cell records release verification, not absence of implementation. All target
acceptance remains unverified in this review.

| QA task                                               | Local web                                   | Attached CDP                                | Browserbase                                 | Android Emulator                            | iOS Simulator                               |
| ----------------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Setup and target readiness                            | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) |
| Run meaningful assertions                             | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) |
| Replay a complete Scenario                            | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) |
| Run in CI                                             | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) |
| Inspect execution plan before running                 | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) |
| Edit, validate, activate, or roll back a durable plan | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) |

## Watch execution and inspect evidence

Each cell records release verification, not absence of implementation. All target
acceptance remains unverified in this review.

| QA task                             | Local web                                   | Attached CDP                                | Browserbase                                 | Android Emulator                            | iOS Simulator                               |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Screenshots and action evidence     | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) |
| Recordings, traces, and diagnostics | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) |
| Cancel a Test run                   | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) | Unverified ([scope](#target-qualification)) |
