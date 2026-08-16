---
name: Pickle Spec Studio
description: Dark Spec Ledger — a clinical local instrument for diagnosing test runs.
colors:
  night-ledger: "oklch(0.145 0.012 250)"
  raised-plate: "oklch(0.18 0.012 250)"
  bone: "oklch(0.93 0.01 250)"
  ink: "oklch(0.145 0.012 250)"
  mute: "oklch(0.72 0.015 250)"
  hairline: "oklch(0.72 0.008 250 / 0.16)"
  well: "oklch(0.22 0.012 250)"
  brine-tint: "oklch(0.24 0.025 185)"
  brine-teal: "oklch(0.74 0.08 185)"
  brine-ink: "oklch(0.16 0.03 185)"
  plan-amber: "oklch(0.8 0.11 85)"
  plan-ink: "oklch(0.22 0.05 85)"
  failure-oxide: "oklch(0.7 0.14 32)"
  failure-ink: "oklch(0.16 0.03 32)"
  focus-ring: "oklch(0.72 0.008 250 / 0.4)"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  pill: "9999px"
spacing:
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.bone}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 0.5rem"
    height: "1.75rem"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "oklch(0.93 0.01 250 / 0.8)"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 0.5rem"
    height: "1.75rem"
  button-outline:
    backgroundColor: "oklch(0.72 0.008 250 / 0.08)"
    textColor: "{colors.bone}"
    rounded: "{rounded.md}"
    padding: "0 0.5rem"
    height: "1.5rem"
  button-destructive:
    backgroundColor: "oklch(0.7 0.14 32 / 0.2)"
    textColor: "{colors.failure-oxide}"
    rounded: "{rounded.md}"
    padding: "0 0.5rem"
    height: "1.75rem"
  button-passed:
    backgroundColor: "oklch(0.74 0.08 185 / 0.2)"
    textColor: "{colors.brine-teal}"
    rounded: "{rounded.md}"
    padding: "0 0.5rem"
    height: "1.5rem"
  badge-default:
    backgroundColor: "{colors.well}"
    textColor: "{colors.bone}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.mono}"
  badge-failed:
    backgroundColor: "oklch(0.7 0.14 32 / 0.2)"
    textColor: "{colors.failure-oxide}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.mono}"
  badge-adaptation:
    backgroundColor: "oklch(0.8 0.11 85 / 0.2)"
    textColor: "{colors.plan-amber}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.mono}"
  badge-passed:
    backgroundColor: "oklch(0.74 0.08 185 / 0.2)"
    textColor: "{colors.brine-teal}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.mono}"
  badge-running:
    backgroundColor: "{colors.brine-tint}"
    textColor: "{colors.bone}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.mono}"
  nav-active:
    backgroundColor: "{colors.brine-tint}"
    textColor: "{colors.bone}"
    rounded: "{rounded.md}"
    padding: "0.375rem 0.75rem"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.raised-plate}"
    textColor: "{colors.bone}"
    rounded: "{rounded.lg}"
    padding: "0.75rem 1rem"
---

# Design System: Pickle Spec Studio

## Overview

**Creative North Star: "The Spec Ledger"**

Studio is a bound technical ledger that happens to run on a screen. Feature files are the page; test results are the ink; an adaptation is a distinct mark, never a silent rewrite. The operator sits in a dark room with a local project, reading live state the way one reads a night-shift instrument — not a marketing dashboard.

The atmosphere is clinical lab, executed at the craft level of dark developer tools (Vercel, Cursor): near-black cool field, hairline plates, one light primary action, and color reserved for result state. Density is high. Chrome is thin. Empty space is leftover work, not a lifestyle.

**Key Characteristics:**
- Dark cool field with one-step raised plates, never a drop shadow
- Bone-white primary action; teal, amber, and oxide only name a test-result state
- Inter for UI, JetBrains Mono for measurements and resolved actions
- Compact 8px corners, 9px controls, hairline borders
- Status is a labeled chip, never a color-only dot

## Colors

A restrained night palette: cool neutrals plus one light action, with three semantic inks for failed, adapted, and passed.

### Primary
- **Bone**: The only large action fill. Used on "Start test run" so the operator can find the next move without scanning for teal.

### Secondary
- **Brine Teal**: Passed results and the selected nav tint. It is not the product accent for chrome.

### Tertiary
- **Plan Amber**: `passed-with-adaptation` chips. The ledger's distinct mark that a plan changed and still needs a human.

### Neutral
- **Night Ledger**: Canvas behind the whole Studio.
- **Raised Plate**: Header, cards, matrix, timeline entries.
- **Well**: Secondary fills and idle chips.
- **Hairline**: Thin light-gray borders and table rules.
- **Mute**: Secondary text on Night Ledger (must remain ≥4.5:1).

### Named Rules
**The Bone Rule.** The light fill is the primary action. Do not paint navigation, tables, or idle chips with Bone.

**The State Ink Rule.** Teal, amber, and oxide appear only on labeled result chips or a failed matrix cell. They do not tint the page.

## Typography

**Display Font:** Inter (with ui-sans-serif, system-ui)
**Body Font:** Inter (with ui-sans-serif, system-ui)
**Label/Mono Font:** JetBrains Mono (with ui-monospace)

**Character:** Inter carries the ledger at developer-tool density. JetBrains Mono is reserved for values — resolved actions, status chips, identifiers — not for atmosphere.

### Hierarchy
- **Headline** (600, 1.25rem, tight tracking): Project name in the header. There is no display size.
- **Title** (500, 1.125rem): Section titles such as "Test run".
- **Label** (500, 0.875rem): Table headers, timeline headings, attention items.
- **Body** (400, 0.875rem, 1.5): Activity lists, empty-state copy, nav items.
- **Mono** (500, 0.625rem): Status chips. Resolved-action lines stay JetBrains Mono at 0.75rem.

### Named Rules
**The Measurement Mono Rule.** Monospace is for data. Do not set headings, nav, or body copy in JetBrains Mono to look technical.

## Layout

A full-height column: header, then a single-row area nav, then a master-detail ledger. The left rail (16rem) lists Specifications. The main pane holds the selected Specification, its Scenario table (profile columns plus a per-row Run), Needs attention, and the step timeline. Padding is 1.5rem in the main stage, 0.75rem in the header, 0.25rem in the nav. Rhythm is 1rem inside a rail, 1.5rem between table and timeline.

There is no marketing container or max-width. Studio is an app shell. Specifications is the current room. Runs, Plans, and Settings remain in the area nav as a disabled product map.

## Elevation & Depth

No shadows. Depth is Night Ledger behind Raised Plate, separated by a 1px light-gray Hairline. Selected nav is a Brine Tint well, not a lift.

### Named Rules
**The Flat Ledger Rule.** Surfaces are flat at rest and in motion. Do not add drop shadows, glows, or stacked cards to fake hierarchy.

## Shapes

Mira density: small instrument corners, 0.5rem on plates and the Scenario table, `rounded-md` on buttons, pills only on status chips. Borders are 1px Hairline. No clipped hero shapes. Tables share the plate radius; inner rows use only a bottom hairline.

## Components

Quiet Mira instrument controls. Color names a result; geometry stays compact so the Scenario table can carry the screen.

### Buttons
- **Style:** shadcn Mira (`base-mira`). `text-xs/relaxed`, height 1.75rem default / 1.5rem small, `rounded-md`, no shadow. Pressed state scales to 0.98 in 100ms. Focus is a 1px current-color hairline, never a ring.
- **Primary:** Bone fill, Ink text. Hover is Bone at 80% opacity. Used for Run Specification on the selected file.
- **Outline:** Hairline border, translucent input fill. Used for pending and running matrix cells, per-Scenario Run, and Run all Specifications.
- **Passed:** Brine Teal tint and ink, with a Tick. Used for a passed matrix cell.
- **Adaptation:** Plan Amber tint and ink. Used for `passed-with-adaptation` matrix cells.
- **Destructive:** Failure Oxide tint and ink (not a solid fill). Used for a failed matrix cell and for Cancel during a live run.

### Chips
- **Style:** Mira pills, JetBrains Mono 0.625rem, height 1.25rem. Variants: Ready Well, failed Oxide tint, adaptation Amber tint, passed Teal tint, running Brine Tint.
- **State:** The chip text is the domain state word (`failed`, `passed-with-adaptation`, `running`) except idle, which reads Ready. Color never stands alone. A live run uses Beautiful UI’s Loading State Drive grid: a 3×3 pixel wavefront, a shimmering `running` label, and a mono elapsed timer in the header. Matrix cells carry the same grid beside the spelled state. A finished chip or matrix cell adds a Tick (Brine Teal, or Plan Amber for Adaptation) or a Cancel mark (Failure Oxide). `prefers-reduced-motion` freezes the grid and shimmer; the timer still ticks.

### Cards / Containers
- **Corner Style:** 0.5rem
- **Background:** Raised Plate
- **Shadow Strategy:** none (see Flat Ledger Rule)
- **Border:** 1px Hairline
- **Internal Padding:** 0.75rem–1rem

### Navigation
- Mira-sized text links: height 1.75rem, `text-xs/relaxed`, `rounded-md`. Active is Brine Tint with Bone text. Unavailable areas are Mute at 60% opacity, `aria-disabled`, and not in the tab order. No icons. Areas are Specifications, Runs, Plans, Settings.

### Specification list
Left rail, 16rem. Group label is 2rem tall at `text-xs`. Each Specification is a Mira sidebar menu item (`h-8`, `text-xs`, `p-2`) with the Scenario count in JetBrains Mono. The selected item is a Brine Tint well.

### Scenario table
Signature component: a bordered plate table for the selected Specification. Row headers are Scenario names; columns are execution target profiles, then a per-row Run. Before a run, profile cells read pending. A result cell is a small button whose label is the result state, with the Drive pixel grid while running and a Tick or Cancel mark when finished. The selected cell uses a stronger hairline, not a ring; the timeline follows the worst Needs attention cell until the operator pins one.

### Needs attention
Hidden until a failed, infrastructure-error, or Adaptation cell exists. Each row is a plate button with the Scenario name, a state chip, the profile, and “Open step timeline.”

### Step timeline
A vertical list of Hairline plates. Step intent in Sans; resolved actions in Mono; errors in Failure Oxide text; screenshots as bordered images, max height 16rem.

## Do's and Don'ts

### Do:
- **Do** keep the canvas dark and cool (Night Ledger) with one-step Raised Plates.
- **Do** put the next operator action on a Bone button (Run Specification), and swap it for Cancel while a test run is live.
- **Do** spell the test-result state on every chip and matrix cell, with the Drive pixel grid while running and a Tick or Cancel mark when the cell finishes.
- **Do** use JetBrains Mono for resolved actions and status, Inter for everything else.
- **Do** keep Mira density on controls (compact type, no shadow) and Hairline plates on the ledger.

### Don't:
- **Don't** add a tracked uppercase kicker above the project name.
- **Don't** introduce drop shadows, glass, or neon status dots.
- **Don't** use a focus ring on buttons. Focus is a 1px current-color hairline.
- **Don't** replace a spelled result state with a color-only icon.
- **Don't** spend Brine Teal on chrome or marketing blocks.
- **Don't** invent a second source of truth in the UI — feature files and Git remain off-canvas systems of record.
- **Don't** use Cucumber, Playwright, or "self-healing" visual language.
