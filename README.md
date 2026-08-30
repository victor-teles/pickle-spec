![Pickle Spec](assets/brand/pickle-spec-github-banner.png)

# Pickle Spec

Pickle Spec runs Gherkin Specifications against execution targets. The web
adapter uses Stagehand for browser automation, and the mobile adapter uses
`agent-device` for Android Emulator and iOS Simulator automation. The platform
is local-first: Specifications, test runs, caches, and artifacts stay on the
user's machine or CI runner by default.

## Package ownership

Each scoped package owns one public boundary.

| Package | Responsibility |
| --- | --- |
| `@pickle-spec/configuration` | Provide shared strict configuration validation rules. |
| `@pickle-spec/spec` | Parse Specifications and select Scenarios. |
| `@pickle-spec/runner` | Schedule Scenarios and produce run events and test results. |
| `@pickle-spec/web` | Adapt Stagehand operations to the runner contract. |
| `@pickle-spec/mobile` | Adapt Android Emulator and iOS Simulator operations through an isolated Node worker. |
| `@pickle-spec/studio` | Provide the local Studio installed for `pickle studio`. |
| `@pickle-spec/cli` | Install the `pickle` executable and compose product commands. |

The `apps/example` workspace contains sample Specifications.

All seven packages publish at one lockstep version. Library consumers use the
package roots; adapter conformance and controlled benchmark tooling are exposed
only at `@pickle-spec/runner/testing` and
`@pickle-spec/runner/benchmarking`.

## Install the executable products

Install the CLI in a Bun project, then initialize a project or open Studio:

```bash
bun add --dev @pickle-spec/cli
bunx pickle init
bunx pickle studio
```

The CLI package installs Studio as part of the compatible package set. Pickle
Spec does not require a cloud service. This release excludes hosted
synchronization and physical-device provisioning.

## Run the development checks

To install dependencies and run the repository checks, use:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run release:check
bun run benchmark:replay
```

To run one package test suite, use:

```bash
bunx turbo run test --filter=@pickle-spec/web
```

See [Release validation](docs/releasing.md) for package artifacts, required
resource-independent gates, provisioned smoke tests, and release exclusions.

## Configure web execution

Create `pickle.config.jsonc` in the project root:

```jsonc
{
  "schemaVersion": 1,
  "specifications": "features/**/*.feature",
  "suites": {
    "smoke": {
      "paths": ["features/checkout/**"],
      "tagExpression": "@smoke",
      "states": ["active"]
    }
  },
  "executionTargetProfiles": {
    "web": {
      "adapter": "web",
      "capabilities": ["screenshots"],
      "web": {
        "baseUrl": "http://localhost:3000",
        "browser": {
          "environment": "local",
          "modelName": "anthropic/claude-sonnet-4-6",
          "headless": true
        },
        "screenshots": {
          "mode": "on-failure"
        }
      }
    }
  },
  "applicationRevision": "git:HEAD",
  "cache": {
    "maxBytes": 104857600
  },
  "execution": {
    "infrastructureRetries": 1,
    "scenarioTimeoutMs": 30000,
    "stepTimeoutMs": 10000
  },
  "concurrency": 3
}
```

## Configure mobile execution

List application IDs from connected Android Emulators or iOS Simulators:

```sh
pickle apps --platform android
pickle apps --platform ios --all
```

Configure a mobile application by ID. Pickle Spec uses an Android Emulator when
`executionTarget` is omitted. Add `binaryPath` only when each run should
reinstall the application before launch.

```jsonc
{
  "schemaVersion": 1,
  "executionTargetProfiles": {
    "android": {
      "adapter": "mobile",
      "mobile": {
        "application": { "id": "com.example.checkout" }
      }
    }
  }
}
```

Adaptive execution and Cache refresh require the API key for the configured model provider. Bun loads environment variables from `.env`. For local Chrome, set `web.browser.modelApiKey` or the provider environment variable (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`). `web.browser.modelName` must be a Stagehand-supported `provider/model` value; Pickle Spec rejects unknown names before Adaptive execution starts. Replay and `--cache-only` execute browser primitives without model credentials.

To attach to an existing browser, set `web.browser.cdpUrl` to an absolute HTTP, HTTPS, WS, or WSS URL:

```jsonc
"browser": {
  "cdpUrl": "http://127.0.0.1:9222",
  "cdpExtensionId": "stagehand-extension-id"
}
```

If you omit `cdpExtensionId`, the browser must allow Stagehand to load its extension. Set `cdpExtensionId` when the external browser already has the extension loaded. Pickle Spec closes its CDP connection after the run. The external browser owner controls the browser process and must stop it when appropriate.

Treat cloud CDP URLs as secrets because they often contain credentials. Do not commit a credential-bearing `cdpUrl`. The external browser also controls launch settings such as headless mode. Pickle Spec ignores `web.browser.headless` when `cdpUrl` is set.

## Open Studio

Studio binds to loopback and opens the configured project by default:

```bash
pickle studio
```

Remote access requires an explicit host and prints a security warning:

```bash
pickle studio --remote 192.168.1.20
```

The session token grants access to local project data. Use remote access only on
a trusted network.

## Run Specifications

To run the configured Specification glob, use:

```bash
pickle run
pickle run --suite smoke --profile web
pickle run "features/**/*.feature" --tag "@smoke and not @slow"
pickle run "features/**/*.feature" --scenario "checkout"
pickle run "features/**/*.feature" --state draft
pickle run "features/**/*.feature" --shard 1/3
pickle run "features/**/*.feature" --concurrency 5 --retries 1
pickle run "features/**/*.feature" --screenshot on-step
pickle run --application-output stdout --application-output stderr
pickle run --evidence always
```

Evidence persistence defaults to `on-failure`. Configure
`evidence.persistence` for every run, override it with
`executionTargetProfiles.<id>.evidence.persistence`, or use `--evidence` for
one run. The supported policies are `off`, `on-failure`, and `always`; results
and run events are persisted under every policy. Managed application stdout and
stderr are independent diagnostic streams. Enable them under `server.output`,
per profile under `applicationOutput`, or for one run with repeatable
`--application-output` flags.

The default reporter is for people. It groups every Test result by Specification
URI, Specification, and Scenario, then reports the selected counts and timing:

```text
 RUN  pickle 1.0.2 /workspace/project

 features/search.feature
   Search
     ✓ Visit main page [150ms]

 Specifications  1
 Scenarios       1
 Test results    1 passed (1)
 Start at        14:32:07
 Duration        182ms
```

The execution target profile is omitted when only one profile is selected and
shown on each Test result when multiple profiles run. Interactive terminals use
state colors in addition to symbols; redirected output is plain text, and
`NO_COLOR` disables color explicitly. Long paths and Scenario names wrap without
being truncated.

In CI and other redirected output, each complete Specification block is written
as soon as every earlier Specification is also complete. Output remains
append-only while preserving the same deterministic order and content as the
finished report.

Use `--reporter ndjson` when an integration needs the versioned run-event and
test-result records as newline-delimited JSON. The human reporter format is not
a machine-readable contract.

## Run Adaptive and Replay modes

A Scenario without an applicable Execution cache entry runs in Adaptive mode. The adapter compiles deterministic actions and assertions as a dense Gherkin-step prefix. A later step that fails or is uncacheable still stores the compiled head when that head is nonempty. A successful Scenario that cannot compile any step remains `passed` with an `uncacheable` Cache outcome and is not stored.

An applicable complete prefix runs in Replay mode without model inference. A shorter prefix Replays the stored head and Adaptive-evaluates from the gap in the same session. That mixed attempt records `partial-hit`. Web Replay executes stored browser operations directly. Mobile Replay materializes and runs the stored Agent Device `.ad` script for a complete Scenario only. Partial mobile prefixes are not replayed.

Entries apply to one project, Scenario revision, execution target profile and configuration fingerprint, application revision, adapter, and adapter cache schema version. Set `applicationRevision` in `pickle.config.jsonc` or pass `--application-revision`; a run without it remains Adaptive and does not read or write the cache.

Use `"applicationRevision": "git:HEAD"` when the application under test is versioned by the current repository. Pickle Spec resolves it to the current commit before selecting a cache entry. For externally deployed applications, provide a release or deployment identifier instead.

Entries store placeholders and variable names instead of bound runtime values. An execution remains `uncacheable` when its adapter cannot separate reusable structure from runtime values.

If Replay diverges before any instruction ran, prefer-cache reseats Adaptive on that step in the same session. If Replay of a step already executed instructions and then failed, the attempt fails and the stored prefix shrinks to the sealed head. A successful mixed run returns `passed`. Execution mode, Cache outcome, and inference count remain separate from the Scenario result.

Use the cache controls explicitly:

```bash
pickle run --refresh-cache
pickle run --cache-only
pickle cache inspect
pickle cache clear
```

`--refresh-cache` bypasses the current entry and replaces it after Adaptive evaluation. `--cache-only` never calls a model and fails on a miss, a short prefix, or divergence. CI that requires zero inference must use `--cache-only`.

Pickle Spec stores one shared cache database at `~/.pickle/execution-cache.sqlite` and scopes every entry to its project. Git worktrees from the same repository share a project identity instead of creating another database. SQLite is the only cache tier. Each project's entries retain multiple Scenario and application revisions without a fixed TTL. The default configurable limit is 100 MiB per project, with least-recently-used eviction by `lastUsedAt`. Studio shows cache behavior with results, offers Cache refresh beside Run, and keeps cache inspection and clearing under Settings.

See [Replay performance gate](docs/replay-performance.md) for the controlled
web/mobile benchmark, budgets, and rerun protocol.

## Persist, rerun, compare, and export test runs

Every `pickle run` writes an immutable test run under `~/.pickle/projects/<project-name>-<project-key>/runs/`. Pickle Spec does not create runtime folders inside the project.

Test runs have no deletion policy by default. Studio shows total local storage,
warns at 5 GB, and lets you pin complete runs before applying an explicitly
configured age or size limit. Active and pinned runs are never retention
candidates.

To create a selective rerun from an earlier test run, use:

```bash
pickle run --rerun <run-id>
pickle run --rerun <run-id> --failures
pickle run --rerun <run-id> --failures --scenario "Pay for the order"
pickle run --rerun <run-id> --profile web
```

A rerun creates a new test run and records `sourceRunId`. It never changes the source run.

To move a test run between machines, export and import a run archive:

```bash
pickle export <run-id> --output archive=run.archive.json
pickle import run.archive.json
```

Import preserves the original archive bytes under `~/.pickle/projects/<project-name>-<project-key>/archives/` and migrates older schemas in memory.

To compare compatible test runs, use:

```bash
pickle compare <baseline-id> <candidate-id>
```

Comparison matches results by Scenario identifier and execution target profile identifier. It reports state, duration, flaky, execution-mode, Cache-outcome, inference-count, and artifact changes.

To create a self-contained HTML export, use:

```bash
pickle export <run-id> --output html=report.html
pickle export <run-id> --output html=report.html --all-artifacts
```

HTML export includes failure artifacts by default. Successful Adaptive fallback uses the normal artifact policy rather than a special category. The manifest includes execution mode, Cache outcome, and inference count. `--all-artifacts` embeds every available test artifact and prints a size warning when the export exceeds 10 MB.

Both `pickle run` and `pickle export` accept repeatable `--output format=path`
requests for `json`, `ndjson`, `junit`, `html`, `archive`, and `allure`.
Each destination is published independently after the complete output is staged.
Existing destinations are preserved unless `--force` is explicit. For example:

```bash
pickle run --output junit=results.xml --output allure=allure-results
pickle export <run-id> --output json=run.json --output html=report.html
```

Allure output is a raw `allure-results` directory that can be consumed by
Allure 2 or Allure 3. Pickle Spec does not bundle an Allure report renderer,
history manager, categories configuration, or runtime dependency.

## Add a custom adapter

Create `pickle.extensions.ts` when a project needs a custom execution-target adapter:

```ts
import type { ExecutionTargetAdapter } from '@pickle-spec/runner'

const adapter: ExecutionTargetAdapter = {
  capabilities: ['filesystem'],
  async openSession() {
    return {
      async executeStep(step) {
        return {
          state: 'passed',
          resolvedActions: [{ description: `Execute: ${step.text}` }],
        }
      },
      async close() {},
    }
  },
}

export default {
  adapters: {
    custom: adapter,
  },
}
```

Declare the profile in `pickle.config.jsonc` and import the adapter explicitly. Pickle Spec does not discover plugins dynamically.

```jsonc
{
  "schemaVersion": 1,
  "executionTargetProfiles": {
    "custom": {
      "adapter": "custom",
      "capabilities": ["filesystem"]
    }
  }
}
```

Run the custom adapter with:

```bash
pickle run --profile custom --extensions pickle.extensions.ts
```
