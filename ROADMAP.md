# Pickle Spec Roadmap

This roadmap reflects the repository state in August 2026 and focuses on one goal: evolve Studio from a local diagnostic instrument into the flagship visual experience for AI-driven autonomous testing, powered by Stagehand on the web and agent-device on mobile.

## Where the platform stands

The engine is ahead of the face. Shipped and tested today:

- **Specs** — Gherkin with `@pickle` tags, durable identities, tag-expression selection, duration-aware sharding
- **Runner** — event-sourced runs (`events.ndjson` + manifest under `~/.pickle`), worker-pool concurrency, retries, flake marking, Adaptive/Replay execution cache
- **Web** — Stagehand adapter with observe/act/extract/verify routing, screenshots, local and Browserbase environments
- **Mobile** — agent-device adapter for Android emulator and iOS simulator via a Node worker, with screenshot, device-log, recording, and trace evidence
- **CLI** — `run`, `studio`, `cache`, `check`, `migrate`, `compare`, `export`, `import`; JUnit/JSON/NDJSON outputs; `--cache-only` for keyless CI
- **Studio** — the Dark Spec Ledger: Specification catalog, Monaco Gherkin editing with optional AI propose, live scenario-by-profile matrix over WebSockets, result inspector with step timeline and artifacts, history with compare/export/rerun, settings with git integration and mobile target discovery
What does not exist yet: a global Runs area, deep-linkable routes, live browser or device video, web traces and recordings, visual diffing, built-in AI authoring, trend analytics, and any hosted or multi-user surface.

## The core bet

No product today lets an operator watch an AI agent test their app live, see its reasoning at each step, and replay the evidence afterward. Phase 2 (Live Execution Theater) is the differentiator. Phase 1 makes Studio navigable enough to carry it; Phase 3 makes what it shows trustworthy.
Every phase inherits the design law in `DESIGN.md`: flat plates, spelled result states, Bone for the primary action, teal/oxide/amber only as labeled state ink, and shadcn Mira primitives for every control.

## Phase 1: Command Center (weeks 1–6)

Goal: make Studio navigable, addressable, and shareable as a full application. Runs become a first-class global area instead of history nested under each Specification.
- [x] Global Runs area: a cross-Specification dashboard with live progress and a filterable run list backed by the existing `index.sqlite` projection, plus a unified run detail page that joins the manifest and the event stream
- [x] Real URL routing and deep links: replace the query-param history location so every Specification, scenario, run, result, and artifact has a shareable URL
- [x] Command palette (Cmd+K): jump to any Specification, scenario, or run; start and cancel runs; switch profiles
- [ ] First-run onboarding: a visual readiness checklist built on the existing run-readiness API, guiding a new user to a first green run
- [x] Design-system fill-in: add the missing shadcn Mira primitives (toast, tooltip, dropdown menu, command, skeleton)
Exit criteria: any state in Studio has a URL, and a new user goes from `pickle studio` to a first green run without reading docs.

## Phase 2: Live Execution Theater (weeks 5–14)

Goal: watching the AI test your app becomes the signature experience. Studio currently shows live state chips and after-the-fact screenshots; this phase adds the moving picture.
- [ ] Live browser viewport: stream CDP screencast frames from the local Stagehand browser over the existing per-run WebSocket; embed the Browserbase session live view for remote runs
- [ ] Live device mirror: frame streaming from agent-device for Android emulator and iOS simulator through the existing Node worker protocol, rendered beside the step timeline
- [ ] AI decision feed: extend run events with model-decision payloads so Studio renders observe, act, and verify reasoning per step in real time — what the model saw, the candidate actions, and the chosen action
- [ ] Follow mode and picture-in-picture: auto-follow the worst cell or a pinned scenario across the matrix, with a filmstrip of concurrent viewports for parallel workers
- [ ] Live step timeline: steps appear as events arrive with inline screenshots, execution mode, and cache annotations
Exit criteria: a full run is watchable end-to-end without opening a terminal.

## Phase 3: Evidence and Diagnosis (weeks 12–20)

Goal: every failure is diagnosable from Studio without a rerun. Evidence kinds already exist in the result schema; this phase makes them rich and universal.
- [ ] Web traces and recordings as first-class evidence, captured through the browser under Stagehand, with an embedded viewer in the result inspector
- [ ] Visual screenshot diff between two runs, extending `pickle compare` and the History compare UI with pixel and region diffing
- [ ] Replay divergence explainer: visualize the exact step where cached Replay diverged and what Adaptive did instead (the `replay-diverged` and `adaptive-fallback-started` events already carry the data)
- [ ] AI failure triage: a model-generated root-cause summary per failed scenario, classified as spec wording, app regression, or infrastructure, with a suggested fix
- [ ] Network and console capture for web runs, surfaced in the diagnostics tab
Exit criteria: at least 80% of failures on the example suite explain themselves from evidence in the inspector.

## Phase 4: Authoring Intelligence (weeks 18–26)

Goal: the fastest path from product intent to a running Specification. AI propose exists today only as an optional extension hook; this phase makes authoring intelligence built-in.
- [ ] Explore mode: point the Stagehand agent at a URL; it explores the app and proposes draft Specifications (`@pickle:state:draft`) into the workspace for review
- [ ] Built-in default `authorSpecification` so AI propose works out of the box with any configured model key, with no `pickle.extensions.ts` required
- [ ] Step-level live preview: run a single step from the Monaco editor against a live session and see the result inline before saving
- [ ] Grounded autocomplete: step suggestions from observed page state plus the project's existing step vocabulary, layered onto the current Gherkin completions
- [ ] Spec health lints in the editor gutter (ambiguous steps, uncacheable patterns, unreachable states) and a tag and coverage map per Specification
Exit criteria: a new scenario for an existing app in under 5 minutes, with propose working with zero extension code.

## Phase 5: Insight and Scale (weeks 24+)

Goal: from a diagnostic instrument to a suite-health platform. The raw data already lands in the run index; this phase turns it into trends and team workflows.
- [ ] Trends from the run index: pass and flake rate, duration, cache hit rate, and inference count and cost per scenario over time, shown as sparklines in the ledger
- [ ] Suite health view: attention-ranked Specifications and a flake quarantine workflow that keeps flaky scenarios visible without blocking runs
- [ ] CI surface: PR-annotation-friendly output, cache-only playbooks for keyless CI, and archive import deep links so a CI failure opens directly in local Studio
- [ ] Physical mobile devices via agent-device when supported, and Browserbase parity for scale-out web execution
- [ ] Decision gate: hosted sync and multi-user collaboration, explicitly out of scope until this point and then decided deliberately
Exit criteria: teams choose Studio over raw CI logs to understand suite health.

## Success metrics
- Time from install to first green run (Phase 1)
- Live-view engagement during runs (Phase 2)
- Share of failures diagnosed without a rerun, targeting 80% or more (Phase 3)
- Time to author a new passing scenario, targeting under 5 minutes (Phase 4)
- Cache hit rate and inference cost per CI run (Phase 5)
