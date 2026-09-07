# Readable execution plans

Status: implemented and functionally verified. The final native 200% zoom
design check remains blocked by the available browser automation environment.

ENG-04 adds read-only inspection of the current web execution cache. It follows
the ownership decision in [Execution-plan ownership](execution-plan-ownership.md).
Studio uses the existing Mira components and [DESIGN.md](../DESIGN.md).

## Inspect a plan

1. Open **Specifications** and select a Scenario.
2. In the details sidebar, find **Readable execution plan** and choose
   **Inspect** for a configured web profile.
3. Read the actions under each Gherkin step. Targets, checks, variable references,
   and redacted input values appear beside the action.
4. Expand **Applicability details** to inspect the cache identity and revision.

From a run result, open **Plan**. A recorded failed step receives focus only when
its index, keyword, and text match the current Scenario. A mismatch is stated
explicitly. A failure in the uncached tail focuses that tail.

The publication run identifies the source of the current cache entry. It does
not establish which bytes a historical attempt used. Timeline and artifact
inspection remain available in the existing result view.

## Interpret the result

| Result | Meaning and next action |
| --- | --- |
| Current cached plan | Parsed web instructions match the current Scenario, profile, adapter schema, and target configuration. Inspect the grouped actions and applicability before relying on the plan. |
| Uncached tail | Only a prefix has cached actions. The remaining Gherkin steps are listed separately; the prefix is not a complete Replay plan. Run Adaptive to produce the missing actions. |
| No cached plan | No entry is available for this selection. Run the Scenario in Adaptive mode to create one. |
| Incompatible plan | Retained content does not match the selection or valid Gherkin step roles. Run Adaptive for the current Scenario and profile. |
| Unsupported adapter | The profile does not use the built-in web payload format. Inspect existing run evidence or choose a built-in web profile. |
| Multiple application revisions | Choose an explicitly listed stored revision. Inspection does not change the configured application revision or activate that entry. |
| Deployment unverified | No current application revision was resolved. A stored plan can be read, but its applicability to the current deployment is unverified. |
| Load failure | Retry the read. No mutation is performed. |

## Ownership and boundaries

- Runner owns the presentation contract in
  `packages/runner/src/execution-plans/execution-plan-display.ts`.
- Web parses and projects its native instructions in
  `packages/web/src/execution-cache/web-plan-projector.ts`. Literal fill, type,
  selection, and value-check inputs are redacted. Variable references remain
  visible. Credential-bearing URLs are sanitized before the response reaches
  Studio.
- CLI resolves the project, Scenario, profile, application revision, and cache
  entry in `packages/cli/src/studio/studio-execution-plans.ts`. Coordinated reads
  check the payload and publication metadata without recording a cache hit.
- Studio exposes a typed read function and a shared panel under
  `packages/studio/src/features/execution-plans`.

This view does not create a durable plan revision, edit instructions, validate a
candidate, activate an entry, or run Replay. Those workflows remain separate
action-plan items. Mobile and custom adapter payloads are unsupported.

## Verification

Evidence date: 2026-09-04. Source revision:
`9fae3f69f5550054c63e0ecfd5c2d96b4436e9b0` plus the uncommitted ENG-04 changes
listed above and their tests. This record does not describe the baseline commit
alone.

| Status | Check | Evidence |
| --- | --- | --- |
| Verified | Web projection, variable preservation, input and URL redaction, Gherkin-role validation | `bun run --cwd packages/web test:unit tests/unit/execution-cache/web-plan-projector.test.ts`: 5 passed. |
| Verified | Read-only cache access, partial coverage, revision selection, incompatible and unsupported states, legacy web profile, invalid variables | `bun run --cwd packages/cli test:unit tests/unit/studio/studio-execution-plans.test.ts`: 5 passed. |
| Verified | Existing cache confidentiality integration | `bun run --cwd packages/cli test:integration:confidentiality`: 1 passed. |
| Verified | Repository tests | `bun run test`: 14 script tests and all 7 package tasks passed, including 148 Studio tests. Five package tasks used Turbo cache. After the final interface fixes, `bun run --cwd packages/studio test` rebuilt Studio and passed all 148 tests again. |
| Verified | Types and lint | `bun run typecheck`: all 8 tasks passed. `bun run lint`: passed with 28 warnings, including one new file-length warning on the cohesive inspection service. |
| Verified | Real Studio browser acceptance | The CLI Vitest E2E command below passed 3 tests in installed Chrome. Covers complete, partial, absent, unsupported and incompatible states; Retry after an aborted request; response/body secret exclusion; unchanged cache metadata; keyboard-only entry at 320px; Axe; full application-revision visibility; and persisted failed-step focus with a visible cue. |
| Unverified | Native 200% browser zoom and ambiguous-revision selection through the UI | The browser zoom shortcut did not change browser metrics; native computer automation failed to start. Revision selection is covered by service tests, but its complete UI interaction was not exercised. |
| Unsupported | Mobile and custom adapter payload inspection | Explicit unavailable response; no payload is projected. |
| Unverified | Live provider inference, new Replay execution, and historical payload provenance | The inspection tests use seeded native cache entries and a persisted failed result. They do not execute an external application or establish historical plan bytes. |

Browser command, run from `packages/cli` (the same invocation as `test:e2e`):

```sh
bunx --bun vitest run --configLoader runner --experimental.viteModuleRunner=false --experimental.nodeLoader=false --config vitest.e2e.config.ts tests/e2e/studio/execution-plan.test.ts
```

An initial root run encountered missing built assets and a server startup
timeout. The exact affected server tests passed on rerun (6 tests). A separate
root attempt hit the existing release-package test's five-second timeout during
concurrent checks. The final root command passed with those checks serialized;
no test timeout or assertion was weakened.

## Rendered interface review

The `better-interface` review covered accessibility, layout, writing, typography,
color, and UI polish across Scenario and failed-result inspection. Desktop and
320px Chrome views were inspected. Axe reported no violations in the complete
320px case; the other states were exercised functionally and visually.

Resolved findings:

- The failed step now has a persistent selection ring and a written
  **Recorded failed step** cue, including after pointer navigation.
- The narrow details pane receives 40% of the workbench instead of 20%.
  At 320×800 it measured 269px high; the final check remained reachable through
  its scroll container, with no document overflow.
- Operation rows use spacing within the owning Gherkin Card instead of nested
  bordered cards. Status copy no longer duplicates card chrome.
- Long application revisions wrap fully, and Gherkin keywords are separated
  from their step text.

No actionable finding remains in the exercised states. Formal design approval
is withheld until native 200% browser zoom is verified. The headless shortcut
left zoom metrics unchanged, and the native fallback failed with
`Sky Computer Use native pipe startup failed`. A manual screen-reader session
and ambiguous-revision selection/reset are also unverified.

Local review evidence is retained in `.audit/eng04/interface-review.md`,
`.audit/eng04/browser-final.log`, and
`.audit/eng04/browser-screenshots/{complete-desktop,partial-desktop,complete-320px,failed-step-focus}.png`.
