---
target: studio page
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-16T14-10-19Z
slug: packages-studio-src-frontend-tsx
status: superseded by ADR-0012
---
Method: dual-agent (A: e5528ae4-8eb2-444a-b6e7-08b365227a31 · B: 1e786e82-a26e-4006-aa88-2b6b865fb2f5)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Badge + activity names; no run id, counts, or busy state |
| 2 | Match System / Real World | 3 | Domain terms solid; `idle` and “later Studio slice” leak system-speak |
| 3 | User Control and Freedom | 1 | No cancel/stop; Start stays armed; no deselect |
| 4 | Consistency and Standards | 3 | Ledger tokens hold; attention rows are unlabeled text vs matrix state buttons |
| 5 | Error Prevention | 2 | Double-start allowed; stub nav looks like real destinations |
| 6 | Recognition Rather Than Recall | 2 | Empty matrix until run; suite/profile not shown before Start |
| 7 | Flexibility and Efficiency | 1 | No shortcuts, filters, or rerun-this-Scenario |
| 8 | Aesthetic and Minimalist Design | 3 | Flat Night Ledger is coherent; empty attention + stub nav waste chrome |
| 9 | Error Recovery | 2 | Step message in oxide; no next action; screenshot alt is `kind` only |
| 10 | Help and Documentation | 1 | One empty-state sentence; Adaptation undefined |
| **Total** | | **20/40** | **Acceptable** |

Cognitive load: **5/8 failures** (high). Fail: single focus, hierarchy, one thing at a time, minimal choices, progressive disclosure. Pass: grouping, working memory, idle chunking. Decision points >4: four area links (three stubs) plus Start; matrix cells scale with Scenarios × profiles.

## Design Specificity Verdict

**LLM assessment:** The diagnosis instruments are authored for Pickle Spec: Scenario × execution-target-profile matrix, labeled `failed` / `passed-with-adaptation` / `running` chips, Bone “Start test run,” Needs attention ordered failed-then-adapted. Domain language is clean. The shell is still interchangeable dark-tool chrome — four equal nav labels, shadcn button/badge, an `idle` chip, a hollow plate table. A neighboring runner could wear this frame unchanged. Specificity lives in the matrix and Adaptation mark, not yet in the ledger as a bound instrument (no run identity, no ink-on-page density).

**Deterministic scan:** CLI `detect.mjs` exit 2, **1 finding**: `overused-font` (Inter) at `packages/studio/src/index.html:11`. DESIGN.md pins Inter as the Spec Ledger UI face; this is a brief override, not a backlog item. Overlay on the live idle page logged `[impeccable] No anti-patterns found.` A first sandboxed Studio load showed empty `#root` (asset chunks 401); that is an evidence artifact, not a product P0. Overlay “clean” on that blank load is a false negative.

**Visual overlays:** Injection succeeded on a critique-only Studio instance. The overlay reported no anti-patterns. Critique servers were stopped after capture; no user-visible overlay remains in a live tab.

## Overall Impression

The Spec Ledger look is in place: Night Ledger field, Bone CTA, labeled state chips, hairline plates. Operate diagnosis is still hollow. First useful paint is an empty Runs room. The timeline latches onto whoever started first, so a payment failure can sit in a mute Needs attention list while the operator watches the wrong Scenario. The single biggest opportunity is to make the live run a steered instrument: one current area, one armed control, selection that follows the worst cell until the operator pins otherwise.

## What's Working

- **Target matrix is the signature.** Scenario rows, profile columns, state spelled on the cell — not color-only dots. This is the product, not a generic dashboard table.
- **Needs attention sorts failures first.** Failed and infrastructure-error before Adaptation, matching the diagnosis job.
- **Palette and type follow the ledger.** Bone action, Inter UI, JetBrains Mono on measurements, no shadows, chips not unlabeled dots.

## Priority Issues

- **[P1] Timeline does not follow failures.** `selectCell` keeps the first started Scenario; a later payment failure only appears as `{name} {state}` in Needs attention. Diagnosis ends on the wrong page of the ledger. **Fix:** Default selection = worst attention cell; pin only on explicit click; highlight the selected matrix cell. **Suggested command:** `$impeccable shape` (selection model) then `$impeccable layout`

- **[P1] No exit from a live run.** Start remains the only control; a second click resets the view. **Fix:** Swap to a destructive Cancel while `running`; disable a second start; `aria-busy` on the run region. **Suggested command:** `$impeccable harden`

- **[P1] Stub nav is a fake IA.** Specifications is first in the row; three of four areas dump “will be available in a later Studio slice.” Jordan hits a dead door before Start. **Fix:** One current area (Runs) as selected; other three `aria-disabled` or a single Later disclosure until those slices exist. **Suggested command:** `$impeccable distill`

- **[P2] High-stakes rows are visually mute.** Attention is unstyled left-text; Adaptation is outline in the matrix, amber only on the header chip. **Fix:** Reuse failed/adaptation badges in the list; one recovery line (“Open step timeline”). **Suggested command:** `$impeccable colorize`

- **[P2] Idle chrome without a pre-run ledger.** Empty Needs attention, empty matrix headers, `idle` chip, no suite/profile shown before Start. The operator cannot see what will run. **Fix:** Show known profiles (and suite names if already loaded) as the empty matrix; drop or collapse empty attention until a cell exists; replace `idle` with “Ready” or omit the chip. **Suggested command:** `$impeccable onboard`

## Persona Red Flags

Primary action: start a test run and diagnose a failure.

**Alex (Power User):** One-click Start is right; then no shortcut, no rerun-failed, no cancel, no run id to copy. Will double-start or leave.

**Jordan (First-Timer):** Specifications is the first link and a dead end. `idle` unexplained. “Start a test run to watch…” does not say what will run. Adaptation is jargon with no gloss.

**Sam (Keyboard / SR):** Native links/buttons, `role="status"` on the badge, matrix `aria-label`s exist. No `aria-live` on activity/attention, no `aria-busy`, screenshot `alt` is `kind` only, live list rebuilds can move focus.

**Quinn (QA author, local failing payment Scenario):** Start runs the whole suite. Timeline latches onto the first starter. Payment appears as a mute attention row without profile emphasis. Plans is a stub, so she cannot promote an Adaptation. She still has to know to click the failure.

## Minor Observations

`idle` chip on first load; empty matrix headers with no rows; timeline `null` causes layout jump; artifact links use Bone (`text-primary`); opening/error states are unstyled `p-8`; hash nav does not restore area; no visible selected-cell state; no reduced-motion treatment.

## Questions to Consider

- If Runs is the only real room, why is Specifications the first door?
- Should the timeline be a lock on the worst cell, not a souvenir of whoever started first?
- Where is the page number of this test run — the identity a ledger owes an operator?
