# Competitive review for the Pickle Spec roadmap

This review used current first-party documentation on 2026-08-28. It pins the
OpenQA findings to repository commit
[`5540095`](https://github.com/openqa-labs/openqa/tree/5540095df555853a2c73eba2d077480227558f29).
This is a documentation comparison, not a hands-on product benchmark. We report
vendor capabilities as their documentation describes them. We did not
independently verify performance or reliability.

## Executive conclusion

The roadmap points at the right product layer, but its central competitive
claim is too broad. Live visual authoring, headed agent execution, AI reasoning,
recorded replay, trace inspection, healing, and agent-driven test generation are
already documented by one or more competitors. Pickle Spec should not position
the moving browser alone as the differentiator.

The stronger wedge is a local-first, event-sourced command center that unifies
web and mobile execution, makes parallel agent work observable, and explains
Adaptive-to-Replay behavior with durable, typed evidence. The reviewed sources
do not establish that combination. Treat it as a testable product thesis rather
than an absolute market claim.

## Capability comparison

### Momentic

- **Workflow:** Momentic stores natural-language YAML in the repository. Tests combine preset steps, agentic actions, modules, and code. Its local editor and MCP tools use live browsers or devices. [How Momentic works](https://momentic.ai/docs/get-started/how-momentic-works), [local app](https://momentic.ai/docs/local-app), [MCP](https://momentic.ai/docs/coding-agents/mcp-server).
- **Evidence and operations:** Momentic documents cache, replay, healing, recovery, classification, triage, quarantine, and change-aware selection. Results include video, traces, screenshots, network, console, decision evidence, analytics, and shareable URLs. [Maintenance](https://momentic.ai/docs/reliability/auto-maintenance), [selection](https://momentic.ai/docs/ai/select), [results](https://momentic.ai/docs/running-tests/results), [self-hosted viewer](https://momentic.ai/docs/guides/reporting/self-hosted-result-viewer).
- **Boundary:** Web execution uses Chromium. Mobile execution uses simulators or emulators, not physical devices. AI selection is alpha, and failure recovery is beta. Some maintenance policy remains dashboard-managed. [Platform summary](https://momentic.ai/docs/llms.txt), [selection maturity](https://momentic.ai/docs/ai/select), [recovery maturity](https://momentic.ai/docs/reliability/auto-maintenance), [configuration precedence](https://momentic.ai/docs/configuration/momentic-config).

### OpenQA

- **Workflow:** `npx openqa init` creates a Playwright-BDD, Cucumber.js, or YAML harness. Each step runs Claude Code or OpenCode through an in-process Playwright MCP server. The server shares browser context and resumes the agent session across scenario steps. [README](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/README.md#how-it-works), [architecture](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/docs/how-it-works.mdx#L8-L41).
- **Evidence and operations:** OpenQA uses Playwright reports, traces, screenshots, video, headed execution, and parallel workers. Verbose runs include step-level agent logs. Existing Claude Code or OpenCode login can avoid a separate local key. [Features](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/README.md#features), [evidence configuration](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/examples/playwright-bdd/playwright.config.ts#L15-L22), [quickstart](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/docs/quickstart.mdx#L134-L171), [run commands](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/docs/quickstart.mdx#L217-L224).
- **Boundary:** OpenQA documents a Playwright browser harness, not a persisted Studio, mobile platform, or suite-health service. Pass or fail depends on tool errors and agent output. The harness handles zero tool calls and narrated failures explicitly. [Package scope](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/package.json#L1-L10), [assertion detection](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/docs/how-it-works.mdx#L78-L85).

### Playwright Test Agents

- **Workflow:** Playwright provides planner, generator, and healer agents. The planner writes a Markdown plan. The generator validates selectors and assertions before writing tests. The healer replays failures and proposes patches. Agents can run separately or in sequence across four coding-agent environments. [Test Agents](https://playwright.dev/docs/test-agents).
- **Evidence and operations:** UI Mode provides watch and time-travel debugging. Traces include action snapshots, screencasts, DOM, source, console, network, and visual-diff attachments. [UI Mode](https://playwright.dev/docs/test-ui-mode), [Trace Viewer](https://playwright.dev/docs/trace-viewer).
- **Boundary:** Generated tests can contain initial errors. The healer stops at guardrails and can skip a test when it identifies a product defect. Playwright stores agent definitions in the project and recommends regeneration after updates. [Generator](https://playwright.dev/docs/test-agents#-generator), [healer](https://playwright.dev/docs/test-agents#-healer), [agent definitions](https://playwright.dev/docs/test-agents#agent-definitions).

## Highest-value roadmap implications

### 1. Replace the absolute core bet

The sentence "No product today lets an operator watch an AI agent test their
app live, see its reasoning at each step, and replay the evidence afterward" is
not supportable from these sources. Momentic documents a local visual editor
with a live browser or device, step-level run artifacts and AI reasoning, and
recorded video and trace replay. OpenQA supports a visible browser plus
step-by-step agent logs. [Momentic local app](https://momentic.ai/docs/local-app),
[Momentic results](https://momentic.ai/docs/running-tests/results),
[OpenQA headed execution](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/docs/quickstart.mdx#L217-L224)

A defensible replacement would be:

> Pickle Spec makes concurrent AI-driven web and mobile tests observable from
> one local, event-sourced control plane, then preserves the same decision,
> cache, and artifact evidence for replay and diagnosis.

This remains a thesis to validate. The product should measure whether the
parallel matrix, cross-target follow mode, and Replay divergence story improve
diagnosis time beyond a single headed browser or conventional trace viewer.

### 2. Pull evidence foundations into the Live Execution Theater

Web traces, console and network capture, screenshots, filmstrips, and visual
diff inspection are already baseline capabilities in Momentic and Playwright,
not a late differentiator. Playwright UI Mode already connects each action to
before/after DOM, console, network, attachments, and source. Momentic's run page
connects each step to video, trace, console, network, cache state, healing, and
AI reasoning. [Playwright UI Mode](https://playwright.dev/docs/test-ui-mode),
[Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer),
[Momentic run details](https://momentic.ai/docs/running-tests/results)

Move the event and evidence contract ahead of, or into, Phase 2. Stream a
normalized record first: observation summary, chosen tool action, outcome,
execution mode, cache decision, timing, cost, and artifact references. The live
view and the post-run inspector should render the same record. Avoid making
private model chain-of-thought a product dependency; show auditable decision
evidence instead.

### 3. Advance authoring and make the review boundary explicit

Phase 4 is already crowded territory. Playwright ships planner, generator, and
healer agents; Momentic documents live MCP authoring and repository-aware test
creation; OpenQA turns plain Gherkin into agent execution with a short scaffold.
[Playwright Test Agents](https://playwright.dev/docs/test-agents),
[Momentic MCP workflows](https://momentic.ai/docs/coding-agents/mcp-server),
[OpenQA quick start](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/README.md#quick-start)

Bring the smallest end-to-end authoring loop forward: explore -> propose draft
Gherkin -> preview against a live target -> show a semantic diff -> accept into
Git. Preserve `@pickle:state:draft`, durable identities, and explicit approval
as the Pickle-specific trust boundary. Do not let generated coverage silently
become authoritative or convert a product failure into a skipped passing gate.

### 4. Add an agent-facing product surface, not only built-in AI

The roadmap discusses built-in authoring but does not name MCP, skills, or a
stable machine-readable agent interface. Momentic exposes author, run, inspect,
and maintain workflows over MCP; Playwright generates agent definitions for
four major coding-agent environments. [Momentic MCP](https://momentic.ai/docs/coding-agents/mcp-server),
[Playwright agent setup](https://playwright.dev/docs/test-agents#getting-started)

Add a roadmap deliverable for a narrow agent API over existing contracts:
discover Specifications, inspect readiness, start or cancel a run, subscribe to
typed run events, fetch artifacts, propose a draft, preview a step, and explain
a failure. Keep CLI and Studio as clients of the same contracts. This makes
Pickle composable in coding-agent workflows without making a hosted service a
prerequisite.

### 5. Add change-aware selection and strengthen maintenance controls

Momentic already documents diff- and code-index-based test selection with a
full-suite fallback, although it labels the feature alpha. Its maintenance
workflow escalates from locator re-resolution through recovery,
classification, verified repair, and quarantine, with human override, delivery
policy, and a circuit breaker for broad outages. [AI test selection](https://momentic.ai/docs/ai/select),
[AI test maintenance](https://momentic.ai/docs/reliability/auto-maintenance)

Phase 5 should add change-aware scenario selection alongside current tag and
duration-aware selection. Phase 3's AI failure triage should also specify
provenance, confidence, operator override, bounded retries, suite-outage
circuit breaking, and validation proof for proposed repairs. Quarantine
should remain visible and temporary, never turn unknown failures into green.
Replace Phase 4's vague coverage map with journey and variant coverage grounded
in observed executions, while requiring human review of inferred taxonomy.
[Momentic app graph](https://momentic.ai/docs/ai/app-graph)

### 6. Treat onboarding, traces, visual diff, and quarantine as parity work

OpenQA markets a two-minute scaffold and Momentic documents a wizard intended
to reach a passing test in about two minutes. Momentic and Playwright already
cover traces and visual inspection; Momentic already covers quarantine and
trend analytics. [OpenQA setup](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/README.md#features),
[Momentic changelog](https://momentic.ai/docs/changelog),
[Momentic platform summary](https://momentic.ai/docs),
[Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)

Keep these roadmap items, but label them as adoption or trust prerequisites.
Set Phase 1's onboarding metric against a competitive floor: a fresh project
should reach a useful first green run in at most two minutes after required
credentials and target access are available. Measure time-to-diagnosis and
accepted repair rate separately from feature presence.

### 7. Preserve the openings competitors leave

The reviewed sources leave useful room for differentiation:

- Momentic explicitly does not support physical mobile devices; Pickle Spec's
  planned agent-device path can become a real differentiator if it includes the
  same live and replayable evidence contract as simulators. [Momentic platform
  boundary](https://momentic.ai/docs/llms.txt)
- Playwright Test Agents generate conventional Playwright code. Pickle can keep
  executable Gherkin as the reviewed source of truth while still using agents
  to explore, preview, and repair. [Playwright artifacts and
  conventions](https://playwright.dev/docs/test-agents#artifacts-and-conventions)
- OpenQA is deliberately a thin browser harness. Pickle's durable run history,
  Adaptive/Replay semantics, web-mobile matrix, and local Studio can offer the
  operational layer that a headed browser and HTML report do not document.
  [OpenQA scope](https://github.com/openqa-labs/openqa/blob/5540095df555853a2c73eba2d077480227558f29/package.json#L1-L10)
- Momentic puts collaboration, analytics, and some policy in a managed
  dashboard. Pickle can validate whether local-first archives, shareable static
  evidence, and provider-neutral execution are valuable before choosing hosted
  sync. [Momentic results](https://momentic.ai/docs/running-tests/results),
  [Momentic configuration](https://momentic.ai/docs/configuration/momentic-config)

## Suggested sequencing change

Without rewriting the roadmap yet, the competitive evidence supports this
order:

1. Finish first-run onboarding and define the shared event/evidence contract.
2. Deliver live browser and device views on that contract, including the
   parallel matrix and typed decision evidence.
3. Add traces, network, console, filmstrip, and Replay divergence before calling
   the theater complete.
4. Ship the smallest explore/propose/preview/accept loop plus agent-facing MCP
   or equivalent contracts.
5. Add bounded failure classification and repair, then change-aware selection,
   quarantine, and trends.
6. Decide hosted collaboration only after teams test local archives and static
   evidence sharing.

This sequence protects the distinctive runtime story while closing the most
visible parity gaps earlier.
