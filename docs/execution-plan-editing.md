# Editing execution plans

The Studio Plan tab edits the current web execution plan directly. There is no
separate draft, capture, or activation step. Select an action in the React Flow
canvas to edit its locator and optional match number inside the node. Save
change updates the plan used by subsequent Replay runs. Cancel restores the
saved fields.

Canvas controls support pan, zoom, Fit, Arrange, and fullscreen. Dragging steps
changes their temporary display positions; execution order stays fixed. List
view exposes the same node fields without panning. Switching views and reloading
are disabled while an unsaved change is open. Reload reads the persisted plan.

Only action locators for click, fill, type, hover, and select-option are editable.
Checks, values, navigation, waits, and sensitive input bindings retain their
existing protections. Selecting a protected action reveals its details inside
the node. Saving does not execute browser actions or validate the Scenario.

## Persistence and conflicts

The Studio gateway's `save` operation validates the current project, profile,
application revision, Gherkin step, instruction digest, and locator variables.
It compares both the cache revision and the serialized source digest with the
version the editor loaded. A writer lease and compare-and-swap publication
protect against concurrent recordings and edits. Successful saves persist in the
same coordinated cache entry that Replay reads.

Stale edits, busy writers, invalid fields, and failed saves keep the typed values
in the form and display an error. Cancel and reload to resolve a stale version;
retry after a busy writer finishes. Publication preserves other instructions,
checks, required variables, and the recorded source-run metadata.

Existing immutable revisions and the programmatic candidate-validation APIs
remain available for existing callers. Direct Studio editing neither creates
these revisions nor requires their review/activation workflow, and it does not
delete existing history.

## Verification

- `packages/cli/tests/unit/studio/studio-execution-plans.test.ts` covers direct
  publication, reopening, unchanged fields, stale revisions and digests,
  competing writers, and invalid variables.
- `packages/cli/tests/e2e/studio/execution-plan-editor.test.ts` covers editing
  inside nodes, save recovery, reload persistence, keyboard focus, fullscreen,
  canvas layout controls, accessibility, and the narrow list layout.
- `packages/cli/tests/e2e/studio/execution-plan.test.ts` covers inspection,
  redaction, unavailable plans, and failed-step focus.
