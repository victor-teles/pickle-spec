<!-- Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 -->

# Design QA

## Inputs

- Reference: `/Users/victormesquita/.t3/userdata/attachments/ec86edfa-b971-4ced-a11c-6a9a4c8a2c9a-fd01ef6f-3b50-47a1-9904-2956ad7183ea.png`
- Implementation: `design/qa/after-workbench.png`
- Combined comparison: `design/qa/reference-vs-implementation.png`
- State: active Run All with one focused running Scenario and completed work retained in the queue
- Desktop viewport: 1586 x 992 CSS pixels
- Reference dimensions: 1586 x 992 pixels
- Implementation capture dimensions: 3024 x 1890 pixels at browser display density
- Comparison normalization: both captures scaled to 1586 x 992 before horizontal composition

## Comparison

The old scenario table is no longer the Specifications home. A shared workbench now serves idle browsing, single-Scenario runs, single-Specification runs, and Run all. The global header and local action bar lead into a nested Specification/Scenario rail, a dominant browser preview, a lower evidence dock, a dedicated details rail, and a run summary when a run exists. Queue groups, focus selection, status marks, timing, timeline rows, evidence counts, and live viewport content all use real run data.

Desktop uses shadcn Resizable for the left rail, preview/evidence split, and right rail. Each auxiliary region can also be hidden and restored from the action bar. Narrow screens begin with the browser preview as the focused surface and expose the rail, evidence dock, and details panel through the same toggles.

The reference includes controls and data that the current Studio contracts do not expose. The implementation intentionally omits Run selected, concurrency selection, browser navigation chrome, future pending steps, retry limits, and network request totals. It does not simulate these features.

## Iterations

1. The first card-based batch workspace failed visual parity. Onboarding consumed the top of the page, the preview was subordinate, evidence overflowed, and the right metadata area was squeezed.
2. The Specifications home was rebuilt as one operational workbench. The final comparison has no blocking hierarchy, overlap, clipping, or readability differences.
3. The first narrow implementation stacked all four work areas and made each unusably short. The corrected behavior opens only the preview below 1280px and lets authors reveal and resize the other panels when needed.

## Browser verification

- Ran the real 11-test Run All flow in the collaborative browser.
- Confirmed another completed Scenario can be selected while the next Scenario continues running.
- Confirmed the selected Scenario changes the timeline and details without leaving `/`.
- Confirmed live preview, queue, evidence dock, details rail, and run summary are simultaneously visible on desktop.
- Confirmed cancellation resolves to a finished workspace with `Back to Specifications` and failure rerun controls.
- Confirmed a real single-Scenario run stays in the workbench, completes successfully, and exposes its six timeline steps and 13 artifacts.
- Confirmed the left rail, bottom evidence dock, and right details rail independently hide and restore.
- Confirmed a keyboard resize on the left separator changes its width.
- Confirmed 320, 375, 414, and 768px layouts open on the focused preview with panel reveal controls, zero document-level horizontal overflow, and no wrapped buttons.
- Confirmed the 1280 x 800 layout restores the complete three-column workbench and its nested horizontal evidence split with zero document-level horizontal overflow.
- Confirmed no browser console errors in the inspected active-run state.

## Severity audit

- P0: none
- P1: none
- P2: the implementation uses recorded browser frames instead of inventing browser address-bar controls that the current Studio evidence contract cannot operate.

final result: passed
