---
name: Pickle Spec Studio
description: Editorial test journal — a warm, precise workspace for authoring Specifications and reading test evidence.
colors:
  primary: "#292524"
  primary-active: "#0c0a09"
  ink: "#0c0a09"
  body: "#4e4e4e"
  muted: "#66615b"
  muted-soft: "#a8a29e"
  hairline: "#e7e5e4"
  hairline-soft: "#f0efed"
  hairline-strong: "#d6d3d1"
  canvas: "#f5f5f5"
  canvas-soft: "#fafafa"
  surface-card: "#ffffff"
  surface-strong: "#f0efed"
  gradient-mint: "#a7e5d3"
  gradient-peach: "#f4c5a8"
  gradient-lavender: "#c8b8e0"
  gradient-sky: "#a8c8e8"
  gradient-rose: "#e8b8c4"
  semantic-error: "#dc2626"
  semantic-success: "#15803d"
typography:
  display:
    fontFamily: "'EB Garamond Variable', 'Times New Roman', serif"
    fontSize: "2.25rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.025em"
  section:
    fontFamily: "'EB Garamond Variable', 'Times New Roman', serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  body:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.01em"
  label:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  caption:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.08em"
    textTransform: uppercase
  mono:
    fontFamily: "'JetBrains Mono Variable', monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.75rem"
  xl: "1rem"
  pill: "9999px"
spacing:
  xxs: "0.25rem"
  xs: "0.5rem"
  sm: "0.75rem"
  base: "1rem"
  md: "1.25rem"
  lg: "1.5rem"
  xl: "2rem"
  section: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0.625rem 1.25rem"
    height: "2.5rem"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0.5625rem 1.1875rem"
    height: "2.5rem"
  badge:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.625rem"
  card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "1.5rem"
  input:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1rem"
    height: "2.75rem"
---

# Design System: Pickle Spec Studio

## Overview

**Creative North Star: “The Editorial Test Journal”**

Studio makes an executable Specification feel like a carefully edited working document. The feature file is the manuscript, Scenarios are its sections, and test evidence is the annotated record of what actually happened. The interface is quiet enough to read for hours but structured enough to operate quickly.

The visual world is a warm off-white editorial canvas with near-black ink, white sheets, fine rules, and generous but deliberate space. Soft pastel atmospheric blooms provide the only non-semantic brand color. This is an operator surface, not a marketing page: editorial character appears in titles, pacing, material, and transitions while controls remain direct and data stays dense.

Key characteristics:

- Warm off-white canvas and white paper surfaces; never a developer-tool dark canvas.
- EB Garamond is the bundled open-source display substitute for licensed Waldenburg Light. Inter carries UI copy; JetBrains Mono carries paths, code, identifiers, and measurements.
- Near-black pill actions, transparent outlined secondary actions, and pill badges.
- Pastel mint, peach, lavender, sky, and rose appear only as atmospheric decoration.
- Success green and error red appear only with a written state or recovery message.
- Hairline rules and one restrained hover shadow tier provide depth.

## Color rules

**The Ink Action Rule.** The near-black fill identifies the most important available action. Do not introduce a saturated product accent or fill navigation with semantic color.

**The Atmospheric Color Rule.** Pastel gradient tokens belong only to soft radial blooms behind headings or in empty decorative space. Never use them as button fills, text color, table status, or syntax highlighting.

**The Semantic State Rule.** Green means a spelled successful result. Red means a spelled failed or destructive state. Color never stands alone, and passing, failing, running, cache, and execution-mode labels remain distinct concepts.

**The Reading Contrast Rule.** Body copy uses Body or Ink on Canvas/Card. Muted copy uses Muted, never Muted Soft, when it carries instructions or other required information.

## Typography

Display type is editorial, restrained, and light in impression. EB Garamond’s lightest available variable cut is used at 400; never synthesize bold display headings. Display tracking stays between -0.015em and -0.025em.

Inter carries navigation, controls, labels, tables, and prose at 400/500. Body text receives subtle positive tracking for the editorial cadence. JetBrains Mono is reserved for Gherkin, file paths, identifiers, timestamps, resolved actions, and measurements.

Hierarchy:

- Project/specification display: 36px Garamond, 400, 1.0 line height.
- Section title: 24px Garamond, 400, 1.2 line height.
- Card title: 18px Inter, 500.
- Body: 16px Inter, 400, 1.5 line height.
- Compact table/control label: 14–15px Inter, 500.
- Badge: 12px Inter, 600, uppercase, 0.08em tracking.
- Code and measurement: 12–13px JetBrains Mono.

## Layout

Studio remains a full-height app shell. The 64px top bar contains the Pickle Spec wordmark, local project name, global areas, and the current run state. Below it, Specifications uses an 18rem master rail and a flexible detail pane.

The selected Specification begins with an editorial heading band. A restrained atmospheric bloom sits behind its right edge without carrying content. Scenarios and History share a pill-shaped contextual switcher. Primary run actions stay together on the right and wrap as one group.

The detail pane uses 32px desktop gutters and 16px mobile gutters. Major regions are separated by 32px. Cards use 16–24px internal padding. Tables remain dense enough for comparison but give every interactive row a 40–44px target.

On viewports below 1024px the master rail stacks above the detail pane. The top bar preserves global navigation, drops the project subtitle first, and never turns into an icon-only mystery menu. Horizontal data tables scroll inside their own surface.

## Depth and material

Canvas is `#f5f5f5`; cards and form controls are white. Default cards use a 1px Hairline border with no shadow. Hoverable cards may use the single shadow tier `0 4px 16px rgba(0, 0, 0, 0.04)`. Dialogs may use a larger neutral shadow because they interrupt and protect focus.

Do not add glass, neon glow, hard offset shadows, nested cards, or gradient borders.

## Components

### Buttons

All buttons are shadcn Mira primitives with pill geometry. Primary actions are 40px-high Ink pills with white text. Outline buttons are transparent with Hairline Strong borders. Small table controls may be 32px high. Pressed controls scale to 0.98 over 100ms; reduced motion removes the transform. Focus uses a 2px Ink outline with a 3px offset.

### Badges and results

Badges use compact uppercase Inter. Ready uses Surface Strong, running uses Ink, passed uses a pale success tint with green text, and failed uses a pale error tint with red text. Every state remains spelled out and may include the existing Mira result mark or loading grid.

### Navigation

Global and contextual navigation use ghost or Surface Strong pill buttons. Active navigation is neutral; it never borrows green, red, or atmospheric pastel color. The Specification rail uses 44px rows, generous truncation behavior, and an explicit Scenario count.

### Scenario table

The Scenario matrix is the signature white paper surface: 16px corners, a Hairline outline, editorial row spacing, and no decorative tint. Profile results are labeled buttons. A selected result gains a stronger neutral border. The table remains horizontally scrollable and keeps Scenario names readable before profile columns.

### Cards, timelines, and evidence

Settings groups, run summaries, evidence panels, and timeline entries use the same white sheet family rather than inventing sub-themes. Dense diagnostic values remain mono; titles and explanations remain sans. Screenshot and video evidence keeps its own aspect ratio inside a bordered neutral frame.

### Gherkin editor

The editor is a white document well using the `pickle-editorial` Monaco theme. Ink carries keywords and source, Muted carries comments and secondary tokens, and no pastel or semantic color is used as syntax decoration. Focus, selection, suggestions, scrollbars, and the caret follow the same neutral palette.

### Empty, loading, and error states

Empty states use direct product language and the next available action. Loading skeletons mirror the final editorial shell rather than flashing a different chrome. Error messages name the problem and preserve the recovery action; red is never the only signal.

## Motion

Motion is quiet and functional. The existing live-run pixel wave remains the authored state moment. Hover and surface transitions use the shared exponential ease-out and complete in 150–200ms. The atmospheric bloom is static. `prefers-reduced-motion` removes shimmer, transforms, and animated transitions while timers and written states continue updating.

## Do and don’t

Do:

- Use the bundled editorial serif for page and section titles.
- Keep the most important action as the one Ink-filled pill.
- Let white space separate tasks while keeping tables and evidence operationally dense.
- Keep every run state, execution mode, and cache outcome written in domain language.
- Theme selection, focus, scrollbars, dialogs, loading, and editor chrome from this palette.

Don’t:

- Reintroduce a dark developer-tools canvas.
- Add a tracked kicker above a heading.
- Use pastel blooms inside controls, tables, status chips, or syntax.
- Bold display copy or replace the serif with a system display face.
- Use icons without labels for primary navigation or run state.
- Invent cloud, collaboration, or approval concepts that are not part of the local-first product.
