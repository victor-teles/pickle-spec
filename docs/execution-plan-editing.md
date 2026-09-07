# Manual web interaction editing

Status: implemented for web cache drafts, revision 1, 2026-09-07. The
approved ownership and failure contract is [execution-plan ownership](execution-plan-ownership.md).
Studio visual conventions remain owned by [DESIGN.md](../DESIGN.md).

Studio keeps cache inspection read-only. A user starts a draft explicitly from
the current coordinated web cache entry. That action creates an immutable
`cache-capture` revision under `.pickle/plans/revisions`; opening or refreshing
the plan panel does not write authored files.

The first editing slice accepts one `ReplaceWebInteractionTarget` command for
`click`, `fill`, `type`, `hover`, or `select-option` in an action step. The
service validates the parent revision, exact Scenario step, instruction digest,
locator template, and required variables before publishing a child revision.
It preserves values, variables, checks, instruction count, order, scope, and
the assertion baseline. The active selection file is never written.

The Studio editor renders the Gherkin step, original target, candidate target,
and protected checks together. Invalid locator input stays local to the editor;
a stale parent or instruction digest reports a conflict without discarding the
typed value. Discard clears the local editor and leaves immutable history
intact. Save draft creates another revision and never activates it.

Navigation, waits, assertion locators and predicates, value changes, insertion,
deletion, reordering, mobile payloads, and sensitive input bindings are
unsupported in this slice. The UI names those limits instead of exposing raw
JSON repair. The next validation and activation operations remain ENG-07 and
ENG-08.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Replace exactly one web interaction locator | Implemented, verified | `packages/web/tests/unit/execution-cache/web-plan-projector.test.ts` |
| Preserve checks, values, variables, order, and parent bytes | Implemented, verified | Web transformer assertions and CLI draft persistence test |
| Reject stale instruction and unknown locator variables | Implemented, verified | Web transformer conflict and invalid-variable assertions |
| Reject assertion, wait, and unsupported operation edits | Implemented, verified | Protected instruction assertions and adapter kind guard |
| Capture and save immutable drafts | Implemented, verified | `packages/cli/tests/unit/studio/studio-execution-plans.test.ts` |
| Keep active selection unchanged | Implemented, verified | CLI test inspects the plan slot after capture and edit |
| Expose the plan beside Diagnostics in the Specifications bottom dock | Implemented, verified | `packages/studio/src/features/specifications/specifications-workbench-focus.tsx` and attached Studio preview; the right details rail no longer duplicates the plan |
| Render a contextual editor with discard and save controls | Implemented, verified | `packages/studio/src/features/execution-plans/execution-plan-editor.tsx`, `packages/studio/tests/unit/execution-plans/execution-plan-panel.test.tsx`, and attached Studio preview capture |
| Validate a candidate or activate it | Unsupported in ENG-06 | ENG-07 and ENG-08 own Replay validation and selection writes |

Verification run on this revision:

```text
web focused execution-plan tests: 7 passed
CLI focused Studio execution-plan tests: 6 passed
Studio execution-plan UI tests: 3 passed
root typecheck: 8 tasks passed
targeted Biome check: no errors; line-count warnings remain
```

## Interface review

Scope: the Specifications Scenario flow from profile selection through the
bottom-dock Plan tab, current cache inspection, explicit draft capture, locator
editing, save, and discard.
The review used the available `better-interface` domain skills, the existing
Mira primitives, [DESIGN.md](../DESIGN.md), source inspection, the editor SSR
test, and the attached Studio preview.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native Mira buttons and inputs, labels, field errors, focus styles, and the Studio accessibility tree | Clear for inspected states; live editor keyboard walk not verified |
| Layout | Responsive editor classes and attached preview resized to 320px | Clear; document and body scroll widths stayed at 320px |
| Writing | Draft, protection, error, save, and discard copy | Clear; unsupported operations and recovery action are explicit |
| Typography | DESIGN.md hierarchy, Mira typography, and responsive locator inputs | Clear; locator inputs use 16px on narrow viewports |
| Color | DESIGN.md semantic tokens and neutral Mira variants | Clear; no new color tokens or saturated accents |
| UI polish | Mira Card, Button, Input, Label, Badge primitives and compact spacing | Clear; no actionable findings in the inspected flow |

The attached preview had a current web cache entry. It verified the `Plan` tab
immediately to the right of `Diagnostics`, the profile inspection flow at
1280px, the responsive capture control at 320px, no horizontal overflow at
320px, and clicking `Start draft from cache` rendering the immutable draft
editor with the clearer locator form. Live typing, keyboard save/discard, 200%
browser zoom, and a real edit save response remain unverified. A formal
uncommitted-diff review is owned by the user-invoked `interface-review` skill;
this record is the focused screen and flow review requested for ENG-06.
