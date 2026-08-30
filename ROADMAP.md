# Pickle Spec roadmap

This roadmap reflects the repository state in August 2026. Its goal is to make Studio the flagship interface for local-first, AI-driven autonomous testing. Stagehand powers web execution, and agent-device powers mobile execution.

## Where the platform stands

The execution engine is ahead of the product surface. Pickle Spec ships these capabilities today:

- **Specifications** — Gherkin with `@pickle` tags, durable identities, tag-expression selection, and duration-aware sharding
- **Runner** — event-sourced runs under `~/.pickle`, worker-pool concurrency, retries, flake marking, and the Adaptive/Replay execution cache
- **Web** — Stagehand observe, act, extract, and verify routing with screenshots and local, Browserbase, or external CDP environments
- **Mobile** — agent-device automation for Android emulators and iOS simulators, with screenshots, logs, recordings, and traces
- **CLI** — `run`, `studio`, `cache`, `check`, `migrate`, `compare`, `export`, and `import`. Exports support JUnit, JSON, NDJSON, HTML, archives, and Allure.
- **Studio** — a Specification catalog, Monaco Gherkin editing, and live scenario-by-profile progress. Studio also provides deep-linked evidence, history, comparison, export, rerun, settings, git integration, and mobile target discovery.

Studio does not yet provide live target video, web traces, visual diffing, built-in AI authoring, or guarded test repair. Trend analytics and hosted collaboration are also absent.

## Competitive baseline

The market already treats natural-language tests, AI-assisted authoring, selector recovery, visual editing, and rich failure artifacts as baseline capabilities. Pickle Spec must meet that baseline without copying a competitor's product model.

| Competitor signal | Documented baseline | Pickle Spec response |
| --- | --- | --- |
| [Momentic](https://momentic.ai/docs) | Local editor; modules; cache; selection; maintenance; quarantine; MCP | Match the workflow baseline. Lead with Gherkin, local evidence, provider choice, and deterministic Replay. |
| [OpenQA](https://github.com/openqa-labs/openqa) | One-command setup; selector-free Gherkin; provider sessions; Playwright evidence | Make setup fast and provider-neutral. Preserve one source-controlled Specification. |
| [Playwright Test Agents](https://playwright.dev/docs/test-agents) | Planner, generator, and healer roles; seed tests; plans; live validation | Separate planning, generation, validation, and repair. Link each accepted mutation to evidence. |

These features are necessary, but they are not sufficient differentiation. Pickle Spec's advantage is one local-first evidence model across web and mobile, with explicit Adaptive and Replay behavior, portable runs, and observable autonomy.

## The core bet

Pickle Spec should become the most trustworthy place to watch, understand, and govern an AI test run. Live viewing alone is not the differentiator. The product must combine concurrent web and mobile views with typed decision evidence, deterministic Replay, cache provenance, and reviewable repairs.

Four product rules protect that position:

1. **The repository owns intent.** Specifications, reusable flows, configuration, and accepted repairs remain version-controlled files.
2. **Autonomy stays inspectable.** Studio records observations, tool activity, chosen actions, model identity, cache behavior, and artifacts. It does not expose or depend on private chain-of-thought.
3. **Known work becomes deterministic.** Adaptive execution discovers a path. Replay executes the validated path without model inference when the cache remains applicable.
4. **Mutation requires proof.** An agent can propose a Specification or repair. Acceptance requires a source diff and a validating run.

Every phase also follows `DESIGN.md`: flat plates, spelled result states, Bone for the primary action, and teal, oxide, or amber only as labeled state ink. Every control uses a shadcn Mira primitive.

## Phase 1: Command Center (weeks 1–6)

Phase 1 makes Studio navigable, addressable, and usable from first launch. Runs become a global area instead of history nested under each Specification.

- [x] Global Runs area: provide a cross-Specification dashboard with live progress and a filterable run list backed by `index.sqlite`. Join the manifest and event stream on one run detail page.
- [x] Real URL routing and deep links: give every Specification, scenario, run, result, and artifact a stable URL. Ensure it survives refresh.
- [x] Command palette (`Cmd+K`): jump to a Specification, scenario, or run; start or cancel a run; and switch profiles.
- [x] First-run onboarding: guide users through project checks, target readiness, model credentials, and a first green run. Offer a credential-free example that demonstrates Replay and evidence inspection.
- [x] Design-system fill-in: add the missing shadcn Mira toast, tooltip, dropdown menu, command, and skeleton primitives.

Exit criteria: every Studio entity has a stable URL. After target access and credentials are ready, a new user reaches a first green run within 2 minutes.

## Phase 2: Observable Execution Theater (weeks 5–14)

Phase 2 makes concurrent execution understandable during and after a run. The live view and result inspector must use the same event and evidence contracts.

- [x] Shared evidence contract: version observations, tool activity, outcomes, timing, cost, artifact references, execution mode, and cache decisions. Redact secrets before streaming or persistence. Never store private chain-of-thought.
- [x] Live browser viewport: stream CDP screencast frames from a local or attached browser over the per-run WebSocket. Embed the Browserbase live session for remote runs.
- [x] Live device mirror: stream Android emulator and iOS simulator frames through the existing Node worker protocol. Render the active device beside the step timeline.
- [x] Web diagnostics: capture redacted traces, recordings, network activity, and console output. Link each artifact to its step and event range.
- [ ] Time-travel inspector: connect each action to target state, diagnostics, source evidence, retries, and before-and-after screenshots. Use the same view for live and completed runs.
- [ ] Replay divergence explainer: show the divergence step, sealed prefix, and Adaptive fallback. Use the existing `replay-diverged` and `adaptive-fallback-started` events.
- [ ] Operator controls: let an operator pin or cancel a scenario, open its live session, and capture evidence. Add pause-after-step only after the runner defines a safe suspension contract.
- [ ] Follow mode and picture-in-picture: follow the worst result or a pinned scenario across the matrix. Show a filmstrip of concurrent targets for parallel workers.
- [ ] Live step timeline: append screenshots, execution mode, cache provenance, retries, and elapsed time as step events arrive.
- [ ] Read-and-run agent API: expose readiness, run control, events, result inspection, and artifact retrieval through local MCP tools.

Exit criteria: an operator can watch a run, inspect any completed action, and cancel unsafe execution. The same evidence remains available after the run ends.

## Phase 3: Planned authoring (weeks 10–20)

Phase 3 provides a deliberate path from product intent to a running Specification. AI propose currently exists only as an optional extension hook.

- [ ] Coverage planner: explore a URL with an optional product requirement, seed scenario, or authenticated setup. Produce a human-readable coverage plan with journeys, edge cases, expected results, and uncovered risks.
- [ ] Plan-to-draft generation: generate `@pickle:state:draft` Specifications only from an approved plan. Preserve links from each generated scenario to its plan and exploration evidence.
- [ ] Built-in authoring: provide a default `authorSpecification` implementation for any configured model, without requiring `pickle.extensions.ts`.
- [ ] Step-level live preview: run one step or a selected range from Monaco against a live session. Show the result inline before saving.
- [ ] Semantic review: show added, changed, and removed behaviors before applying generated Gherkin. Require explicit acceptance into the working tree.
- [ ] Reusable flows and state: add parameterized authentication, setup, test data, variables, and repeated journeys. Show dependency impact before changing a shared flow.
- [ ] Project knowledge: store approved product terms, agent rules, and known flows in repository-owned files. Apply them consistently during authoring and Adaptive execution.
- [ ] Authoring agent API: extend the Phase 2 MCP tools with planning, draft proposal, preview, and semantic-diff operations. Publish project skills over those public contracts.
- [ ] Grounded autocomplete: suggest steps from the observed target state, project knowledge, and the existing Gherkin vocabulary.
- [ ] Specification health: flag ambiguous steps, uncacheable patterns, unreachable states, and missing assertions. Ground journey and variant coverage in observed executions.

Exit criteria: a user can approve a coverage plan and create a passing scenario for an existing application in under 5 minutes. The workflow requires no extension code and leaves a reviewable evidence trail.

## Phase 4: Guarded maintenance (weeks 16–28)

Phase 4 turns failure evidence into controlled maintenance. Autonomous recovery must preserve application regressions and unknown failures as failures.

- [ ] Visual screenshot diff: compare full screenshots and selected regions between compatible runs. Extend `pickle compare` and the Studio comparison view.
- [ ] Evidence-based classification: classify each failure by cause, with provenance and confidence. Show the supporting evidence and allow an explicit override.
- [ ] Guarded repair loop: propose the smallest source diff, run the affected scenario, and attach before-and-after evidence. Stop after a bounded number of attempts. Never change expected behavior to pass an application regression.
- [ ] Suite circuit breaker: stop automated repair during a broad outage, shared-dependency failure, or repeated suite-wide pattern.
- [ ] Quarantine workflow: keep an unresolved flaky scenario visible and running without blocking configured CI gates. Record provenance, justification, owner, and expiry conditions.
- [ ] Repair delivery policy: support local proposals first. Add automatic working-tree edits or pull requests only through explicit project policy.
- [ ] Maintenance agent API: expose classification, override, repair proposal, validation, and quarantine through the shared local contracts.

Exit criteria: at least 80% of example-suite failures are diagnosable without a rerun. Every accepted repair retains its source diff and validation evidence.

## Phase 5: Insight and scale (weeks 26+)

Phase 5 turns local run history into suite intelligence and team workflows. The run index remains the source for local analysis.

- [ ] Trends: show pass rate, flake rate, duration, cache usage, inference count, and cost over time.
- [ ] Suite health view: rank Specifications that need attention. Combine failure history, quarantine age, cache churn, duration changes, and coverage gaps without hiding flaky scenarios.
- [ ] Change-impact map: connect application revisions and observed journeys to Scenarios. Select a smaller CI set from a code change, explain every selection, and provide an explicit full-suite fallback.
- [ ] CI surface: add pull-request annotations, cache-only playbooks, and shard-aware result merging. Open archived CI failures in local Studio through deep links.
- [ ] Execution scale: add physical mobile devices when agent-device supports them. Reach parity across local, attached CDP, and Browserbase web execution.
- [ ] Hosted collaboration decision: decide whether to add hosted sync, access control, audit logs, and multi-user review. Keep these features out of scope until local workflows meet the earlier exit criteria.

Exit criteria: teams use Studio instead of raw CI logs to understand suite health. Change-aware selection reduces pull-request time without increasing escaped regressions.

## Cross-phase release gates

Every phase must meet these gates before its exit criteria count as complete:

- **Security** — redact credentials, tokens, user data, and credential-bearing URLs before they cross a trust boundary.
- **Auditability** — version every new event and artifact schema. Attribute autonomous actions and mutations to their model, tool, input evidence, and run.
- **Interoperability** — keep CLI, Studio, CI, exports, and coding-agent tools on the same public runner and result contracts.
- **Safety** — default agents to proposals. Require explicit policy before automatic source changes, quarantine, cache invalidation, or hosted upload.
- **Portability** — keep complete runs inspectable through local Studio and self-contained exports without a Pickle Spec cloud account.

## Success metrics

- Median time from ready prerequisites to first green run, split by example, web, and mobile setup. Target at most 2 minutes.
- Share of live runs watched, pinned, or cancelled from Studio
- Share of failed scenarios diagnosed without a rerun, targeting at least 80%
- Evidence completeness for failed steps, including target state, diagnostics, execution mode, cache provenance, and model identity
- Repair proposal acceptance, validation, and escaped-regression rates. An application regression must never be auto-healed into a pass.
- Median time from approved coverage plan to a new passing scenario, targeting under 5 minutes
- Cache hit rate, inference count, and inference cost per CI run
- Change-aware selection duration and escaped-regression rate compared with the full suite

## Competitive research

Read the [competitive roadmap review](docs/roadmap-competitive-review.md) before changing the differentiation claim or moving a baseline capability between phases.
