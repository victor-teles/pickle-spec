# Studio accessibility verification

Studio targets WCAG 2.2 Level AA for its supported local workflows. Run the
automated browser seam before release, then complete this manual checklist in
Chrome at desktop and 390 px widths.

## Automated checks

- Run `bun test packages/cli/src/studio.test.ts` from the repository root.
- Confirm the Axe scan reports no WCAG 2 A, 2 AA, 2.1 A, 2.1 AA, or 2.2
  AA violations in Specifications, Runs, Plans, and Settings.
- Confirm the keyboard, reduced-motion, responsive-result, live-update, and
  large-fixture browser tests pass.

## Manual WCAG 2.2 AA checklist

Verified on 2026-08-18 with Chrome on macOS, at 1440 x 900 and 390 x 844.

- [x] Tab and Shift+Tab reach Studio navigation, Specification selection and
  run controls, Runs actions, Plans actions, Settings fields, and dialogs in a
  logical order.
- [x] Enter and Space activate links, buttons, checkboxes, and dialog actions;
  Escape closes dialogs and returns focus to the trigger.
- [x] Every keyboard target has a visible focus indicator that is not obscured.
- [x] Headings, landmarks, tables, lists, statuses, alerts, fields, and controls
  expose a useful accessible name and role.
- [x] Text, controls, result states, and focus indicators remain distinguishable
  without relying on color alone and meet AA contrast in light and dark themes.
- [x] At 390 px, the page does not introduce document-level horizontal scroll;
  wide Scenario and result data stays within labelled internal scroll regions.
- [x] At 200% zoom, controls and result evidence remain operable without content
  loss or overlap.
- [x] With reduced motion enabled, Studio presents no animation or smooth
  scrolling, while running state remains available as text.
- [x] New live results do not move the active control or reorder the attention
  list while it contains keyboard focus.
- [x] Large Specification, run-history, and result collections remain reachable
  with Home, End, arrow, and scroll keys while rendering a bounded DOM window.

Record the browser, operating system, viewport, failed item, and reproduction
steps here when a future release does not pass the checklist.
