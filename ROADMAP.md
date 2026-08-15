# pickle-spec Roadmap

This roadmap is based on the current repository state in March 2026: the published README, the Bun CLI package, the parser/config/runner implementation, the HTML report flow, and the existing test suite.

## Current State

pickle-spec already has the core shape of a usable AI-native E2E runner:

- CLI commands for `pickle run` and `pickle init`
- Gherkin parsing with support for tags, scenario outlines, backgrounds, and i18n
- AI-driven execution through Stagehand with direct navigation heuristics
- Local and Browserbase browser modes
- Per-feature scenario concurrency
- Dev server lifecycle management
- Failure screenshots, step traces, and HTML report generation
- Basic unit tests for config, parser, reporter, and server modules

The next stage is less about inventing the product and more about hardening it into something teams can trust in CI and adopt on real projects.

## Product Direction

pickle-spec should become the fastest way to turn plain-language product behavior into reliable browser checks, with a strong emphasis on:

- Low setup: no step definitions, minimal config, good defaults
- High trust: stable execution, debuggable failures, predictable CI output
- Team adoption: reports, docs, examples, and workflows that fit real delivery teams

## Roadmap

## Phase 1: Stabilize The Core

Goal: make the current feature set dependable enough for repeated local use and early CI adoption.

Priority outcomes:

- Lock down install and test reproducibility
  - Ensure dependency installation and test execution work cleanly from a fresh checkout
  - Add CI for `bun test` and `bunx tsc --noEmit`
- Expand test coverage around the highest-risk paths
  - Runner execution flow
  - CLI option handling
  - HTML report generation
  - Cancellation and parallel execution behavior
- Tighten runtime validation
  - Clear errors for missing model credentials
  - Clear errors for invalid screenshot modes, config values, and server setup
  - Better handling when browser startup or initial navigation fails
- Improve report ergonomics
  - Avoid auto-opening the HTML report in CI/headless environments
  - Persist report path in run results
  - Make failed-step diagnostics easier to scan

Exit criteria:

- Fresh-clone setup is reliable
- Core tests run in CI
- Common misconfiguration cases fail with actionable messages
- Local runs feel stable on small real-world suites

## Phase 2: CI And Team Workflow Readiness

Goal: make pickle-spec practical for product teams running suites in pull requests and deployment pipelines.

Priority outcomes:

- Add machine-readable outputs
  - JUnit output for CI systems
  - JSON output for custom tooling and dashboards
- Improve test selection and execution controls
  - Scenario name filtering
  - Better tag expressions beyond single-tag filtering
  - Feature-level parallelism and sharding support
- Introduce retry and flake controls
  - Scenario retries
  - Per-step/per-scenario timeout controls
  - Better distinction between assertion failures and infrastructure failures
- Improve server integration
  - Reuse existing running servers when appropriate
  - Better readiness checks and startup diagnostics

Exit criteria:

- A team can run pickle-spec in CI and consume structured results
- Flaky behavior is easier to manage without hiding real regressions
- Large suites have a path to run faster than a single machine/browser loop

## Phase 3: Authoring And Debugging Experience

Goal: make writing and fixing specs meaningfully easier than traditional browser E2E tooling.

Priority outcomes:

- Improve authoring workflows
  - `pickle init` should scaffold features/examples, not just config
  - Add `pickle doctor` or `pickle check` to validate environment and config
  - Add `pickle list` or `pickle dry-run` to inspect discovered scenarios without executing them
- Deepen debugging tools
  - Better trace playback controls
  - Attach prompt/action logs per step
  - Capture richer context when verification fails
- Make AI execution more controllable
  - Configurable prompt strategy knobs
  - Safer fallbacks between `observe/act` and direct agent execution
  - Better guidance for ambiguous natural-language steps

Exit criteria:

- New users can get from install to first useful spec quickly
- Failed runs produce enough context to fix issues without rerunning repeatedly
- Teams can tune execution behavior without forking the tool

## Phase 4: Platform Expansion

Goal: broaden the product from a promising runner into a larger testing platform.

Priority outcomes:

- Support richer assertion and workflow primitives
  - File download verification
  - Multi-tab flows
  - Auth/session helpers
  - API-assisted setup and teardown
- Add collaboration features
  - Better artifact organization per run
  - Historical run storage hooks
  - Shareable hosted report workflows
- Strengthen ecosystem fit
  - Better compatibility guidance for Playwright-heavy apps
  - Templates for common frameworks
  - Versioned docs and migration guides

Exit criteria:

- pickle-spec supports broader real-world browser workflows
- Teams can adopt it as part of a longer-lived QA strategy, not just ad hoc smoke checks

## Suggested Immediate Backlog

If we want the next 4-6 weeks to be concrete, this is the order I’d recommend:

1. Add CI for install, typecheck, and tests
2. Add runner and CLI tests for the main execution paths
3. Add structured output formats (`json`, `junit`)
4. Make report opening conditional for local interactive runs only
5. Add retry/timeouts and better failure classification
6. Add `pickle check` for environment/config validation

## Success Metrics

The roadmap is working if we can improve these over time:

- Time from install to first passing feature
- Percentage of failed runs with enough artifacts to debug immediately
- Median runtime for small and medium suites
- CI adoption success without custom glue code
- Reduction in flaky reruns caused by infrastructure or prompt ambiguity
