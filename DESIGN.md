---
name: Pickle Spec Studio
description: Compact dark test operations workspace for authoring Specifications and inspecting evidence.
colors:
  canvas: "oklch(0.1709 0.002 286.18)"
  rail: "oklch(0.205 0.002 286.18)"
  surface: "oklch(0.193 0.002 286.18)"
  surface-raised: "oklch(0.225 0.003 286.18)"
  foreground: "oklch(0.985 0 0)"
  body: "oklch(0.87 0 0)"
  muted: "oklch(0.68 0 0)"
  muted-soft: "oklch(0.52 0 0)"
  border: "oklch(1 0 0 / 0.08)"
  border-strong: "oklch(1 0 0 / 0.14)"
  hover: "oklch(1 0 0 / 0.045)"
  active: "oklch(1 0 0 / 0.075)"
  semantic-error: "oklch(0.704 0.191 22.22)"
  semantic-success: "oklch(0.723 0.158 149.58)"
typography:
  title:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  section:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "normal"
  caption:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.04em"
    textTransform: uppercase
  mono:
    fontFamily: "'JetBrains Mono Variable', monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.75rem"
spacing:
  xxs: "0.25rem"
  xs: "0.5rem"
  sm: "0.75rem"
  base: "1rem"
  md: "1.25rem"
  lg: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 0.75rem"
    height: "2rem"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "0.4375rem 0.75rem"
    height: "2rem"
  badge:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.body}"
    rounded: "{rounded.md}"
    padding: "0.1875rem 0.4375rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "1rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 0.75rem"
    height: "2rem"
---

# Design System: Pickle Spec Studio

## Overview

**Creative North Star: “The Test Operations Desk”**

Studio is a compact desktop tool for moving between Specifications, running Scenarios, and reading evidence. It should feel immediately operational: persistent navigation, dense comparison surfaces, restrained hierarchy, and controls sized for frequent use.

The visual language is a near-black workspace with a subtly lighter rail, white-alpha borders, and very small state deltas. Brand character lives in the Pickle Spec wordmark and precise interaction behavior; product screens do not borrow landing-page scale, decorative gradients, or editorial pacing.

Key characteristics:

- Near-black canvas with a slightly lighter navigation rail.
- Inter carries every application heading, label, control, table, and paragraph. JetBrains Mono is reserved for code, paths, identifiers, timestamps, and measurements.
- 32px controls, 32–36px navigation rows, 36–40px data rows, and 8–12px radii.
- White-alpha fills and borders create hierarchy without obvious panels or shadows.
- Hover and active states use small neutral changes over 75ms; no ornamental movement.
- Success green and error red appear only with a written state or recovery message.

## Color rules

**The Neutral Hierarchy Rule.** Use lightness and white-alpha layers to distinguish canvas, rail, selected navigation, controls, and raised surfaces. Do not introduce a saturated brand accent.

**The State Rule.** Green means a spelled successful result. Red means a spelled failed or destructive state. Color never stands alone, and passing, failing, running, cache, and execution-mode labels remain distinct concepts.

**The Contrast Rule.** Required text uses Foreground or Body. Muted is for secondary metadata; Muted Soft is only for disabled or truly optional content.

## Typography

Studio uses application typography, not editorial display typography. Inter carries the complete UI with small, clear weight changes. JetBrains Mono carries machine-shaped content.

Hierarchy:

- Specification or screen title: 20px Inter, 600, tight tracking.
- Section title: 15px Inter, 600.
- Body and table content: 13–14px Inter, 400.
- Control label: 13px Inter, 500.
- Badge: 11px Inter, 600, compact uppercase.
- Code and measurement: 12px JetBrains Mono.

## Layout

Studio is a full-height app shell. The top bar is 44px tall and holds the wordmark, project name, global areas, and run state. Specifications uses a 16rem master rail and a flexible detail pane.

The detail header is a compact 76–92px work bar: title and path on the left, contextual navigation and actions aligned to the right or immediately below. It has no atmospheric art. Primary work begins within 16–20px of the header.

Desktop gutters are 20px; mobile gutters are 12px. Major regions are separated by 20–24px, and cards use 12–16px internal padding. Tables remain dense and horizontally scroll inside their own surface.

Below 1024px the master rail stacks above the detail pane. Global navigation stays labeled, and dense data retains horizontal scrolling instead of shrinking into unreadable columns.

## Depth and material

The canvas is `oklch(0.1709 0.002 286.18)`. The rail is slightly lighter, and raised surfaces differ by only a few lightness points. Default surfaces use a 1px white-alpha border and no shadow. Menus and dialogs may use a soft black shadow because they float above the application.

Do not add atmospheric gradients, glow, glass, hard offset shadows, gradient borders, or nested cards.

## Components

### Buttons

All buttons are shadcn Mira primitives. Default controls are 32px high with 13px labels and 10px corners. Primary actions use a near-white fill with dark text. Outline controls use a white-alpha border; ghost controls use neutral hover and active fills. Color transitions complete in 75ms. Pressed controls do not scale.

### Badges and results

Badges are 20px high with 8px corners, compact uppercase text, and subtle fills. Ready and running remain neutral. Passed and failed use tinted semantic fills with written labels and the existing result mark.

### Navigation

Global and contextual navigation use ghost buttons with 32px rows and 8–10px corners. Selected navigation uses the Active neutral fill. The Specification rail keeps names and Scenario counts aligned without pills.

### Tables and evidence

Tables use 36–40px rows, 12px text, and quiet row hover. Cards, timelines, editor wells, and evidence panels share the same dark surface family. Dense diagnostic values remain mono; titles and explanations remain sans.

### Gherkin editor

The editor is a dark document well using the `pickle-studio-dark` Monaco theme. Foreground carries keywords and source, muted neutrals carry comments and secondary tokens, and semantic colors are not used as syntax decoration. Selection, suggestions, scrollbars, focus, and caret use the same dark palette.

### Empty, loading, and error states

Empty states use direct product language and the next available action. Loading skeletons mirror the compact shell. Error messages name the problem and preserve the recovery action; red is never the only signal.

## Motion

Motion is quiet and functional. The live-run pixel wave remains the only authored state moment. Hover and active transitions affect color and border over 75ms using the standard UI ease. Dialogs use a short 120ms fade and scale. `prefers-reduced-motion` removes shimmer and animated transitions while timers and written states continue updating.

## Do and don’t

Do:

- Keep navigation and action labels visible.
- Keep the most important available action as the only high-contrast filled control.
- Prefer compact rows and direct grouping over large empty zones.
- Theme selection, focus, scrollbars, dialogs, loading, and Monaco from the same dark palette.
- Keep every result, execution mode, and cache outcome written in domain language.

Don’t:

- Use landing-page typography, decorative gradients, atmospheric blooms, or oversized whitespace.
- Turn every surface into a floating card.
- Add saturated color to navigation, syntax, or decorative chrome.
- Use animation to attract attention to stable controls.
- Invent cloud, collaboration, or approval concepts that are not part of the local-first product.
