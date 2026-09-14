# Stability, UX, and launch readiness review

Reviewed 2026-09-13 at `bc5a824317665739cf2d2a4c0ec2aeeec2c7ee8c`.
Scope: roadmap reconciliation, source/test inventory, local automated QA, and a
launch acceptance plan. No publication, outreach, or real-provider execution is
implied. [ROADMAP.md](../ROADMAP.md) owns priorities and milestone completion.

## Findings

| Priority            | Finding and evidence                                                                                                                                                                                                     | Required outcome                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 release process  | `package.json` pins Bun 1.4.2; both `.github/workflows/ci.yml` and `publish.yml` use 1.3.11. This is confirmed configuration drift, not proof of a CI failure.                                                           | S1: agree and validate one release toolchain, then align both workflows.                                                                                          |
| P1 claim accuracy   | The previous roadmap linked to absent `capability-status.md` and `roadmap-competitive-review.md`; launch copy also linked to an absent QA review.                                                                        | Restored inventory and QA review; removed unsupported competitive-baseline claims from the active roadmap. Do not infer release readiness from old checked boxes. |
| P1 plan maintenance | The previous roadmap said plan editing was unsupported. `execution-plan-panel.tsx` calls Save; `savePlan` in the CLI publishes directly to cache with concurrency checks. Separate revision/validation code also exists. | Advertise the exact locator-edit scope only after QA. Do not equate a save with validated activation, rollback, or durable authored storage.                      |
| P1 verification     | `studio-hardening-suite.ts` includes accessibility, focus, responsive, and large-collection tests; mobile smoke suites are opt-in.                                                                                       | Run existing suites before adding redundant coverage. Record skipped provisioned tests separately from passing controlled tests.                                  |
| P1 release UX       | Existing launch material describes manual maintenance as wholly proposed and relies on older phase/engineering references.                                                                                               | Reconcile current behavior and replace stale gate references with this roadmap.                                                                                   |
| P1 packaging review | No root license file was found in the initial source inventory. Package metadata/legal readiness remains unverified.                                                                                                     | Release owner confirms intended terms and package contents; do not invent or apply a license during a roadmap review.                                             |

The lifecycle, redaction, recovery, usability, and portability scenarios below are
risk-based acceptance requirements, not claims that each contains a known defect.
The review does not recommend replacing current direct editing with a new storage
model without observing needs and approving the contract.

## Executable QA session

Use an isolated project, synthetic credentials/data, a known application revision,
and the exact release candidate. Capture command output and failed-step artifacts.
For each row record passed/failed/blocked, run or screenshot, defect, owner, and retest.
All rows remain pending until actual execution evidence is recorded.

| ID    | Actions                                                                                                                                                                      | Pass condition                                                                                                                                                | Coverage / roadmap                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| QA-01 | Follow README from a clean project; run init/doctor/Studio; inspect demo, then run a real assertion. Repeat with missing/invalid credentials.                                | Demo is clearly distinct; first real assertion is meaningful; blocked setup gives a recoverable next action. Record setup and ready-to-green times.           | Onboarding unit and CLI browser tests; U1.            |
| QA-02 | Break the application expectation; run; inspect failure, source, screenshots, diagnostics, and retry history; refresh the deep link.                                         | Failure remains a failure and identifies the correct step/profile; evidence and selection survive refresh.                                                    | Studio routing/result suites; U2.                     |
| QA-03 | Run Adaptive, applicable Replay, then cache-only with an empty cache and a diverged target.                                                                                  | Outcomes and inference counts match each mode; miss/divergence never silently passes or invokes forbidden fallback.                                           | Cache integration / Replay gate; S5, U3.              |
| QA-04 | Cancel a running run; interrupt its process; disconnect browser/provider; reopen Studio.                                                                                     | Cancellation and interruption are truthful; no false success or indefinitely active run; historical evidence stays inspectable.                               | Run integration / Studio controlled browser seam; S3. |
| QA-05 | Edit a locator in list and canvas; try invalid input; abort save transport; retry; edit concurrently in a second tab; reload; rerun.                                         | Input survives failed save, stale writes cannot overwrite current data, successful edit persists across reload, and actual Scenario outcome is checked.       | Plan editor E2E; U4.                                  |
| QA-06 | Record a saved edit, clear/evict its cache in the isolated fixture, inspect again, and compare old run evidence.                                                             | UI and documentation accurately describe edit retention/loss; historical evidence is not rewritten. Durable retention is a separate feature gate if promised. | Plan/cache integration plus manual session; U4, F4.   |
| QA-07 | Rerun only a failed Scenario/profile while another result updates.                                                                                                           | Correct selection/configuration, distinct new run, original evidence retained; pinned investigation does not jump.                                            | Studio follow/rerun suites; U5.                       |
| QA-08 | Export HTML and archive; transfer to a fresh workspace; import and inspect without the original project.                                                                     | Failure can be explained and artifacts resolve; missing optional evidence is labeled.                                                                         | CLI export/import plus independent workspace; U6.     |
| QA-09 | Complete the core loop with keyboard only, at 200% zoom and 390px width, with reduced motion; use list instead of canvas.                                                    | Controls reachable and named, focus visible/restored, no essential content clipped, no status conveyed only by color.                                         | Axe/hardening suites plus manual browser QA; U7.      |
| QA-10 | Run login plus a state-changing journey twice with isolated data; expire auth and retry.                                                                                     | Repeatable state, meaningful assertions, actionable expired-auth failure, no secret disclosure.                                                               | Live primary web acceptance; F1–F2.                   |
| QA-11 | Insert synthetic secret canaries into credential-bearing URLs and supported input channels; inspect live/stored/exported evidence. Attempt forbidden origins/artifact paths. | Canaries are absent where redaction is required; untrusted access rejected without losing useful diagnostics.                                                 | Confidentiality and Studio security suites; S4.       |
| QA-12 | Install packed release set in clean project; exercise CLI/Studio and CI recipe. After authorized publishing, repeat exact registry install.                                  | All seven artifacts interoperate; correct exit codes/JUnit; version and dist-tag verified separately after publication.                                       | Release acceptance; S6, F3, L5.                       |
| QA-13 | Repeat pass/failure/evidence/cancel on each advertised target and with recording dependencies absent.                                                                        | Independent target evidence; skips and optional capture failures reported explicitly.                                                                         | Provisioned web/mobile/remote runs; L3.               |

## Pilot and launch decisions

Have five new testers attempt QA-01, QA-02, QA-05, QA-07, and QA-08. Observe
without coaching first; record every intervention and completion time. Ask them
to explain why the test failed and whether a saved locator has been validated.
Target four independent completions out of five before broadening the preview.
Check reuse on another day within seven days; do not replace this with downloads.

Stop release for false passes, secret exposure, lost edits, broken installation,
or a broken advertised primary path. Defer advanced authoring, repair, analytics,
and hosted collaboration. Assign real owners before sign-off; none are invented here.

## Local QA results

Environment: macOS, Bun 1.4.2, source revision above plus this documentation diff.
The initial checkout had no installed dependencies. Frozen installation succeeded
with network access after the sandbox attempt failed DNS resolution. Root unit
fixtures needed access beyond the sandbox for temporary installation subprocesses;
Chrome also failed to launch in the initial sandbox browser attempt.

| Check                                            | Result | Evidence and boundary                                                                                                                               |
| ------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                  | Passed | Locked dependencies installed; manifest and lockfile unchanged.                                                                                     |
| `bun run lint`                                   | Passed | Oxlint and Oxfmt; changed Markdown formatted with the existing formatter.                                                                           |
| `bun run typecheck`                              | Passed | Eight Turbo tasks; cache misses.                                                                                                                    |
| `bun run test`                                   | Passed | 734 tests: 14 script tests plus 720 across seven packages. Six package results reused from local Turbo cache; Studio rebuilt and tested.            |
| `bun run test:integration`                       | Passed | 179 tests across confidentiality, CLI, mobile, and web controlled suites.                                                                           |
| `bun run test:e2e`                               | Failed | CLI: 151 passed, two failed, two skipped. Both failures reproduced in isolation; details below. Separate mobile run: two provisioned tests skipped. |
| `bun run release:check`                          | Passed | Validated seven package artifacts at source version 1.0.2; not a registry installation test.                                                        |
| `bun run benchmark:replay`                       | Passed | Controlled web and mobile latency gates; not live-provider performance or dollar-cost proof.                                                        |
| Local documentation links and `git diff --check` | Passed | All local link targets in the five changed documents resolve. Inventory anchor checks also pass in script tests.                                    |

Full command logs for this local session are at
`/tmp/pickle-launch-{install,lint,types,tests,integration,e2e,release,benchmark}.log`.
These are temporary local evidence; the release owner must retain candidate logs
in the release record before sign-off. Initial failures were resolved by restoring
the documentation contract and running fixtures with the required environment access.

No real model/target smoke, human keyboard/visual session, external-project pilot,
or exact registry-version installation has passed in this review. Those gates remain
pending even when controlled automated checks pass.

## Browser acceptance failures

The full CLI E2E run completed with 151 passed, two failed, and two skipped tests
(27 passed files, two failed files, one skipped file). Chrome ran successfully
outside the sandbox. The root command stopped before the mobile package suite.

1. `packages/cli/tests/e2e/studio/studio.test.ts:659`: the cache-refresh case
   timed out waiting for a visible running result on the initial run. It had not
   reached the replacement-publication assertions. Investigate transient-state
   synchronization and actual visible progress; do not report proven cache corruption.
2. `packages/cli/tests/e2e/acceptance/execution-plan-validation.test.ts:445`:
   the initial baseline returned `failed` instead of `validated`, before the
   injected timeout. The fixture uses a 250ms step budget. Inspect baseline evidence
   and timing before changing either runtime behavior or the timeout assertion.

Both failures block S2 until resolved or explained with a reproducible retest.
The roadmap review does not weaken either test or alter runtime code to obtain green.

Isolated retest: both selected cases failed again at the same assertions (two
failed, 35 intentionally filtered/skipped). Log:
`/tmp/pickle-launch-e2e-retest.log`. These are reproducible local failures;
the underlying product-versus-fixture cause remains unresolved.

The mobile package E2E command was also run separately: both provisioned device
smokes skipped because their opt-in environment flags were absent. Log:
`/tmp/pickle-launch-mobile-e2e.log`. No device certification follows from that exit code.

Next engineering work, in dependency order:

- **S6:** complete clean-package recovery acceptance for the named candidate.
- **U1–U7 / L3:** execute the primary real-target and manual acceptance session,
  then collect external pilot evidence before release sign-off.

## Required-gate engineering retest

Retested 2026-09-13 on Linux at
`966dc8f52fb9c709d975780102af913898fb49ec` plus the two test-fixture fixes,
whose code-only patch SHA-256 is
`313107a07255a2adeabc41d39cf38bc7edf9c681c17240ba0040271474044d5e`, using Bun
1.4.2 and Google Chrome 153.0.8010.36. This supersedes the S2 browser failure
status above, but not the remaining provisioned-target or manual QA gaps.

QA-B1 passed in isolation five consecutive times and again in the complete CLI
E2E suite. No product defect was reproducible, so runtime behavior was not changed.
QA-B2 was a fixture defect: its 250ms per-step deadline included normal real-browser
Replay operations and evidence capture, allowing the baseline to expire before the
injected delay. The fixture now allows 2 seconds for baseline work and injects a
3-second delay; the negative run still reports an infrastructure error with zero
inferences and leaves receipts, cache state, and plan selection unchanged.

The first complete E2E retest exposed an unrelated fixture dependency on host Git
configuration: inherited mandatory commit signing prevented its synthetic initial
commit. The fixture now disables signing in its isolated repository. Its focused
retest and the complete E2E rerun pass without changing Studio commit behavior.

| Check                           | Result | Retest evidence and boundary                                                                                       |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `bun install --frozen-lockfile` | Passed | Exact Bun 1.4.2; 645 installs checked with no changes.                                                             |
| `bun run lint`                  | Passed | Oxlint type-aware checks and Oxfmt passed. An invalid concurrent run raced the Studio build; serial retest passed. |
| `bun run typecheck`             | Passed | Eight Turbo tasks passed.                                                                                          |
| `bun run test`                  | Passed | Script and all seven package suites passed.                                                                        |
| `bun run test:integration`      | Passed | CLI, mobile, and web controlled integration suites passed.                                                         |
| `bun run test:e2e`              | Passed | CLI: 153 passed, two skipped. Mobile: two provisioned device smokes skipped because opt-in flags were absent.      |
| `bun run release:check`         | Passed | Seven package artifacts validated together at source version 1.0.2; no registry installation was attempted.        |
| `bun run benchmark:replay`      | Passed | Controlled web and mobile p50/p95 ratio gates passed.                                                              |

S2 is complete for the required controlled gates. The four skipped provisioned
cases are recorded skips, not target certification. Live target evidence remains
owned by L3, and exact registry installation remains a post-publication release-owner
step.

## Run lifecycle and recovery verification

Verified 2026-09-14 on Linux with Bun 1.4.2 at
`7d79a03c7d84fd0959f4d2170d03671779844d9e` plus the S3 code and test patch,
whose code-only SHA-256 is
`5fa84790931fce45b7b65501d82b3949c442020d1b38c95b0fe3097db3997d09`.

QA-04 now covers the complete controlled lifecycle boundary. Existing tests prove
explicit Studio cancellation, browser cleanup after cancellation, and interactive
SIGINT recovery with partial persisted/exported evidence. Added CLI integration
cases inject a provider deadline and browser disconnect, assert both retry attempts,
exit code 1, an `infrastructure-error` result, and a finalized manifest. The added
Studio browser case terminates Studio during an active run, restarts it, and verifies
that the run is no longer active, is finalized as `cancelled`, and remains inspectable
from history. Abrupt-exit coverage completes one Scenario, holds another, sends
`SIGKILL`, and restarts Studio. Studio records ownership before execution starts,
atomically claims only runs whose owner process exited, preserves completed evidence,
and finalizes the abandoned run as `infrastructure-error` rather than a false pass.
Concurrent recovery leaves a live owner's run untouched.

| Check                                                                                                 | Result | Evidence and boundary                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `bun run test:integration:main -- tests/integration/run/run-live.test.ts`                             | Passed | Seven controlled CLI lifecycle tests, including timeout, disconnect, SIGINT, and finalization.                             |
| `bun run test -- tests/unit/studio/studio-history.test.ts`                                            | Passed | Five history cases, including live-owner preservation and atomic abandoned-run recovery.                                   |
| `bun run test:e2e -- tests/e2e/studio/studio.test.ts -t "Studio (shutdown finalizes\|restart marks)"` | Passed | Two Chrome restart/history cases covering graceful cancellation and abrupt-exit infrastructure failure; 30 cases filtered. |

S3 is complete for controlled lifecycle and recovery behavior. Live-provider and
provisioned-target qualification remains owned by L3. A hard process kill cannot run
application cleanup, so restart truthfully records an infrastructure error rather
than graceful cancellation.

## Evidence integrity verification

Verified 2026-09-14 on Linux with Bun 1.4.2 at
`7d79a03c7d84fd0959f4d2170d03671779844d9e` plus the S4 code and test patch,
whose code-only SHA-256 is
`b55d86344904f829671a2768b045f538dfc52ebb19d086661957f6198e281e3b`.

QA-11 now covers the controlled evidence-integrity boundary. The confidentiality
integration injects unique runtime canaries into successful and deliberately failing
adapter evidence and removes provider credentials before execution. It requires all
five requested exports to exist with meaningful result content, then checks live
NDJSON output, process logs, messages, actions, diagnostics, traces, persisted events
and manifests, cache databases, and every export. It imports successful and failed
archives into isolated projects and rescans the imported runs. Existing archive tests
reject corrupt schemas, inconsistent identifiers,
unfinished runs, traversal, missing/orphan/invalid payloads, and immutable-run
overwrites without mutating the destination. The Studio browser test verifies local
session authentication, untrusted-origin rejection, token removal, and security
headers.

Artifact-path review found a real defect: lexical containment allowed a symlink under
one project's artifact directory to resolve to another project's file. Studio now
fails closed on unresolved paths, opens without following the leaf symlink, verifies
the opened file's device and inode against its canonical in-project path, and streams
from that validated file descriptor. Regression tests cover direct cross-project,
file and directory symlinks, dangling targets, path replacement, and request-level
responses while normal live captures remain readable.

| Check                                                                                                                                                                                                                              | Result | Evidence and boundary                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test:integration:confidentiality`                                                                                                                                                                                         | Passed | Successful and failing canaries across live output, returned evidence, storage, five required exports, two imports, and isolation. |
| `bun run test -- tests/unit/server/studio-artifact-path.test.ts`                                                                                                                                                                   | Passed | Six artifact sandbox tests, including request-level directory/dangling symlinks and replacement denial.                            |
| `bun run test -- tests/unit/exports/archive/import-safety.test.ts tests/unit/exports/archive/artifact-validation.test.ts tests/unit/exports/archive/payload-validation.test.ts tests/unit/results/store/artifact-identity.test.ts` | Passed | Four files and 14 corrupt-input, immutable-storage, and artifact-integrity cases.                                                  |
| `bun run test:e2e -- tests/e2e/studio/studio.test.ts -t "Studio protects the local session token and rejects untrusted origins"`                                                                                                   | Passed | One Chrome local-session security case; 30 unrelated cases intentionally filtered.                                                 |

S4 is complete for controlled text evidence, storage, exports/imports, and local
Studio access. This does not claim visual redaction of arbitrary pixels inside target
screenshots or qualify a provisioned target; those require target-specific acceptance
under L3.

## Replay correctness verification

Verified 2026-09-13 on Linux with Bun 1.4.2 at
`7d79a03c7d84fd0959f4d2170d03671779844d9e` plus the S5 code and test patch,
whose code-only SHA-256 is
`81e7384a4f5aae1412c44cc6e4f30ff1b2ae0752cef4c07d52e3d66f658c08bb`.

QA-03 covers Replay correctness from lifecycle contracts through a real Chrome
checkout. The browser acceptance proves a cold Adaptive pass and zero-inference
cache hit, cache-only misses after either application revision or target profile
changes without launching a browser, locator failure and repaired Replay, and a
meaningful business assertion that remains failed after the locator repair. Runner lifecycle
tests prove cache miss/hit policy, cache-only divergence without forbidden fallback,
prefer-cache fallback, and a Replay infrastructure retry in a fresh session with one
final flaky result. The CLI integration verifies Adaptive, Replay, refresh,
cache-only, divergence fallback, and uncacheable outcomes at the public NDJSON
boundary. Web target tests verify configuration changes alter its cache fingerprint.

The controlled web performance fixture now rejects runs whose cache outcome or
inference count is wrong, matching the existing mobile benchmark contract. The
combined performance gate therefore measures only valid Adaptive refreshes and
zero-inference Replay hits.

| Check                                                                                                                                                                                                              | Result | Evidence and boundary                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test:e2e -- tests/e2e/acceptance/checkout-acceptance.test.ts`                                                                                                                                             | Passed | Five Chrome cases covering hit, identity misses, locator failure/repair, and meaningful application pass/failure outcomes.      |
| `bun run test -- tests/unit/execution-cache/lifecycle/replay-fallback.test.ts tests/unit/execution-cache/lifecycle/cache-policy.test.ts tests/unit/execution-cache/lifecycle/prefix-and-scenario-sessions.test.ts` | Passed | Three files and 13 lifecycle cases, including fallback, cache-only denial, and Replay retry with mode/inference assertions.     |
| `bun run test:integration:main -- tests/integration/workspace/workspace.test.ts -t "runs Adaptive, Replay, refresh, and explicit CI cache-only through the local Execution cache"`                                 | Passed | One CLI policy-matrix case; 49 unrelated cases intentionally filtered.                                                          |
| `bun run test -- tests/unit/execution-cache/web-execution-cache.test.ts`                                                                                                                                           | Passed | Eight web cache serialization and target-configuration fingerprint cases.                                                       |
| `bun run test:integration -- tests/integration/benchmarking/web-benchmark-cli.test.ts`                                                                                                                             | Passed | Seven controlled web benchmark entrypoint cases.                                                                                |
| `bun run benchmark:replay`                                                                                                                                                                                         | Passed | Web p50/p95 ratios 0.314/0.376; mobile 0.528/0.684. Both adapters passed their configured limits with validated Replay results. |

S5 is complete for controlled adapters and the synthetic real-browser checkout.
Live-provider and provisioned-target correctness remains part of L3 rather than this
controlled release-candidate gate.

## Packaging and recovery verification

Verified 2026-09-14 on macOS 27.0 with Bun 1.4.2 at
`81188724a61d807cd62536b681da32aad94f8788` plus the S6 code, metadata, license,
and documentation patch. The implementation and license patch SHA-256 is
`aa900a83a6cc31295abfbfe38b0a51e52cb2558b12e3c57d684d5523f82fe1d4`.

QA-12 now has a prepublication package gate. The gate packs and installs all seven
packages in a clean temporary project with local tarball overrides. It imports every
public entry point, runs the installed CLI, starts packaged Studio, and requests its
built HTML. It imports a schema-version 2 archive, exports it with the candidate, and
imports the result into a second isolated project. CI and the publish workflow run
this gate before publication.

The repository and every package now use the MIT license. Each package artifact
contains the license text and declares its description, homepage, source directory,
and supported Bun version. Release validation rejects missing or inconsistent
metadata. The release guide documents dist-tag rollback, exact-version installation,
archive import, and Studio inspection for previous-version recovery.

| Check                                                                                                                                                                                               | Result | Evidence and boundary                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bun run release:check`                                                                                                                                                                             | Passed | Seven lockstep artifacts include validated metadata, MIT declarations, license text, export maps, and internal dependency versions. |
| `bun run release:install-check`                                                                                                                                                                     | Passed | Clean tarball installation, all public imports, CLI 1.0.2, packaged Studio HTML, and two-project archive handoff passed.            |
| `bunx --bun vitest run --configLoader runner --experimental.viteModuleRunner=false --experimental.nodeLoader=false --config vitest.scripts.config.ts tests/unit/scripts/release-acceptance.test.ts` | Passed | Nine workflow, toolchain, versioning, package-set, and prepublication-install policy cases passed.                                  |
| `bun run lint`                                                                                                                                                                                      | Passed | Oxlint type-aware checks and Oxfmt passed.                                                                                          |
| `bun run typecheck`                                                                                                                                                                                 | Passed | Eight Turbo typecheck tasks passed.                                                                                                 |

S6 is complete for packed source artifacts and documented recovery. Exact
registry-version and dist-tag installation remains a post-publication release-owner
operation. No npm publication or dist-tag change occurred during this verification.
