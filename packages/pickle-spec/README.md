# pickle-spec

AI-powered Gherkin test runner. Write `.feature` files in natural language. pickle-spec executes them with AI and browser automation. No step definitions needed.

## How It Works

pickle-spec parses standard Gherkin `.feature` files and executes each step using AI-powered browser automation:

- **Given / When** steps are dispatched as browser actions via `observe` + `act` — clicking, typing, navigating
- **Then** steps are dispatched as verifications via `extract` — the AI reads the page and checks if the expectation is met
- Steps containing **"navigate to"** are handled as direct URL navigation

Each scenario gets its own isolated browser context.

## Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- An API key for your chosen model provider (see [Environment Variables](#environment-variables))

## Installation

```bash
bun add pickle-spec
```

Or install globally for the CLI:

```bash
bun add -g pickle-spec
```

## Local Development

This package lives in a Bun + Turborepo monorepo. From the repository root, use the same flow as CI:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
```

## Quick Start

### 1. Initialize configuration

```bash
pickle init
```

This creates a `pickle.config.ts` in your project root.

### 2. Write a feature file

Create `features/example.feature`:

```gherkin
Feature: Example Search

  Scenario: Visit a website
    Given I navigate to "https://example.com"
    Then I should see "Example Domain"
```

### 3. Set your API key

Create a `.env` file (Bun loads it automatically). Set the key for the provider that matches your configured model:

```
# Claude (default)
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
OPENAI_API_KEY=sk-...

# Google
GOOGLE_GENERATIVE_AI_API_KEY=...
```

### 4. Run

```bash
pickle run
```

## Writing Feature Files

pickle-spec supports standard Gherkin syntax.

### Basic scenario

```gherkin
Feature: Login

  Scenario: Successful login
    Given I navigate to "http://localhost:3000/login"
    When I type "user@example.com" into the email field
    And I type "password123" into the password field
    And I click the "Sign in" button
    Then I should see "Welcome back"
```

### Tags

Tag scenarios to run subsets of your tests:

```gherkin
@smoke
Scenario: Homepage loads
  Given I navigate to "http://localhost:3000"
  Then I should see the main heading
```

Run only tagged scenarios:

```bash
pickle run --tag @smoke
```

### Scenario Outline

Generate multiple scenarios from a template:

```gherkin
Scenario Outline: Login with different users
  Given I navigate to "/login"
  When I type "<email>" into the email field
  And I type "<password>" into the password field
  And I click "Sign in"
  Then I should see "<greeting>"

  Examples:
    | email            | password | greeting      |
    | alice@test.com   | pass123  | Hello Alice   |
    | bob@test.com     | pass456  | Hello Bob     |
```

### Background

Steps shared across all scenarios in a feature:

```gherkin
Feature: Dashboard

  Background:
    Given I navigate to "/login"
    And I log in as "admin@test.com"

  Scenario: View stats
    When I click "Dashboard"
    Then I should see the stats panel
```

### Multi-language support

pickle-spec supports writing feature files in other languages (Portuguese, Spanish, French, Japanese, etc.) using standard Gherkin i18n:

```gherkin
# language: pt
Funcionalidade: Pesquisa

  Cenario: Visitar um site
    Dado I navigate to "https://example.com"
    Entao I should see "Example Domain"
```

Set the default language in config or override per run:

```bash
pickle run --language pt
```

## Parallel Execution

By default, pickle-spec runs up to 3 scenarios in parallel per feature. Control this with the `-j` flag or the `concurrency` config option:

```bash
pickle run -j 5          # Run up to 5 scenarios in parallel
pickle run -j 1          # Run scenarios sequentially
```

## Screenshots

Capture screenshots on failure or after every step:

```bash
pickle run --screenshot on-failure
pickle run --screenshot on-step
```

Screenshots are saved to `.pickle/artifacts` by default. See [Screenshot options](#screenshot-options) for full configuration.

## HTML Reports

After each run, pickle-spec generates an HTML report with embedded screenshots and traces.

By default, pickle-spec opens the report automatically only for local interactive runs. It will not auto-open in CI. You can override that behavior with config or CLI flags:

```bash
pickle run --open-report
pickle run --no-open-report
```

## Structured Outputs

Write machine-readable JSON and JUnit results for CI:

```bash
pickle run --json .pickle/results/run.json
pickle run --junit .pickle/results/junit.xml
```

JSON output includes summary counts, feature/scenario/step results, `failureKind`, retry metadata, selection metadata, server metadata, and the generated HTML `reportPath`.

JUnit output emits one testsuite per feature and one testcase per scenario. Assertion failures use `<failure>`, while infrastructure and cancellation failures use `<error>`.

## Configuration

Create `pickle.config.ts` in your project root (or run `pickle init`):

```typescript
import { defineConfig } from 'pickle-spec'

export default defineConfig({
  language: 'en',
  concurrency: 3,
  output: {
    json: {},
    junit: {},
  },
  filter: {
    tagExpression: '@smoke and not @ignore',
  },
  execution: {
    retries: 1,
    scenarioTimeoutMs: 30000,
    stepTimeoutMs: 10000,
  },
  server: {
    command: 'bun run dev',
    port: 3000,
    url: 'http://localhost:3000',
    reuseExisting: true,
    readinessPath: '/api/health',
  },
  browser: {
    env: 'LOCAL',
    modelName: 'anthropic/claude-sonnet-4-6', // or 'openai/gpt-4o', 'google/gemini-2.0-flash', etc.
    headless: true,
  },
})
```

### Top-level options

| Option        | Type                   | Default                    | Description                              |
| ------------- | ---------------------- | -------------------------- | ---------------------------------------- |
| `language`    | `string`               | `'en'`                     | Default Gherkin dialect (e.g., `pt`, `ja`) |
| `features`    | `string \| string[]`   | `'features/**/*.feature'`  | Glob pattern(s) for feature files        |
| `concurrency` | `number`               | `3`                        | Max parallel scenarios per feature       |
| `report`      | `ReportConfig`         | `{ open: 'auto' }`         | Control when the generated HTML report opens |
| `output`      | `OutputConfig`         | —                          | JSON and JUnit result output settings    |
| `filter`      | `FilterConfig`         | —                          | Scenario-name and tag-expression filters |
| `shard`       | `ShardConfig`          | —                          | Deterministic shard selection            |
| `execution`   | `ExecutionConfig`      | `{ retryOn: 'infrastructure' }` | Retries and timeout settings        |
| `verbose`     | `boolean`              | `false`                    | Enable verbose logging                   |

### Server options

If configured, pickle-spec starts your dev server before running tests and stops it afterward.

| Option           | Type     | Default | Description                                      |
| ---------------- | -------- | ------- | ------------------------------------------------ |
| `command`        | `string` | —       | Shell command to start the server                |
| `port`           | `number` | —       | Port the server listens on                       |
| `url`            | `string` | —       | Base URL for navigation                          |
| `startupTimeout` | `number` | `30000` | Milliseconds to wait for the server to be ready  |
| `reuseExisting`  | `boolean` | `false` | Reuse an already-running healthy server          |
| `readinessPath`  | `string` | —       | Optional path to poll for readiness checks       |
| `pollIntervalMs` | `number` | `500`   | Poll interval for readiness checks               |

### Browser options

| Option               | Type                        | Default                         | Description                               |
| -------------------- | --------------------------- | ------------------------------- | ----------------------------------------- |
| `env`                | `'LOCAL' \| 'BROWSERBASE'`  | `'LOCAL'`                       | Run browser locally or via Browserbase    |
| `modelName`          | `string`                    | `'anthropic/claude-sonnet-4-6'` | Provider-prefixed model id for Stagehand  |
| `modelClientOptions` | `{ apiKey?, baseURL? }`     | —                               | Custom API key (and optional base URL) for the model  |
| `headless`           | `boolean`                   | `true`                          | Run browser without a visible window      |
| `domSettleTimeout`   | `number`                    | `3000`                          | DOM settle timeout in ms                  |
| `actTimeoutMs`       | `number`                    | `15000`                         | Act operation timeout in ms               |
| `observeTimeout`     | `number`                    | `10000`                         | Observe operation timeout in ms           |
| `navigationTimeout`  | `number`                    | `15000`                         | Page.goto() timeout in ms                 |
| `cache`              | `boolean`                   | —                               | Enable Stagehand server-side caching (Browserbase only) |
| `cacheDir`           | `string \| false`           | —                               | Deprecated. `false` disables cache; any string enables server-side cache |
| `selfHeal`           | `boolean`                   | `true`                          | Re-infer an action when a cached selector fails |
| `domSimplification`  | `boolean`                   | `true`                          | Remove heavy DOM elements and disable animations |
| `apiKey`             | `string`                    | —                               | Browserbase API key (when env is `BROWSERBASE`) |
| `projectId`          | `string`                    | —                               | Browserbase project ID                    |
| `verbose`            | `0 \| 1 \| 2`              | —                               | Logging verbosity level                   |

Stagehand v4 no longer ships a local `.pickle/cache` directory. Caching is server-side on Browserbase only. Given/When steps use `observe` + `act`; Then steps use `extract` (the v3 `agent()` API is gone).

### Screenshot options

| Option      | Type                                   | Default              | Description                                |
| ----------- | -------------------------------------- | -------------------- | ------------------------------------------ |
| `mode`      | `'off' \| 'on-failure' \| 'on-step'`  | `'off'`              | When to capture screenshots                |
| `outputDir` | `string`                               | `'./.pickle/artifacts'` | Output directory for screenshots        |
| `format`    | `'png' \| 'jpeg'`                      | `'png'`              | Image format                               |
| `fullPage`  | `boolean`                              | `false`              | Capture full scrollable page               |

### Report options

| Option | Type                             | Default  | Description |
| ------ | -------------------------------- | -------- | ----------- |
| `open` | `'auto' \| 'always' \| 'never'` | `'auto'` | Open the generated HTML report automatically for local interactive runs, always, or never |

### Output options

| Option  | Type                       | Default | Description |
| ------- | -------------------------- | ------- | ----------- |
| `json`  | `{ path?: string } \| false`  | —       | Write stable JSON results. Defaults to `.pickle/results/run.json` when enabled without a path |
| `junit` | `{ path?: string } \| false`  | —       | Write JUnit XML results. Defaults to `.pickle/results/junit.xml` when enabled without a path |

### Filter options

| Option           | Type     | Default | Description |
| ---------------- | -------- | ------- | ----------- |
| `scenarioName`   | `string` | —       | Case-insensitive substring match against scenario names |
| `tagExpression`  | `string` | —       | Cucumber-style tag expression, including `and`, `or`, `not`, and parentheses |

### Shard options

| Option  | Type     | Default | Description |
| ------- | -------- | ------- | ----------- |
| `index` | `number` | —       | One-based shard index |
| `total` | `number` | —       | Total number of shards |

### Execution options

| Option              | Type                  | Default | Description |
| ------------------- | --------------------- | ------- | ----------- |
| `retries`           | `number`              | `0`     | Retry a scenario this many times after an infrastructure failure |
| `retryOn`           | `'infrastructure'`    | `'infrastructure'` | Retry classification for Phase 2 |
| `scenarioTimeoutMs` | `number`              | —       | Timeout for a full scenario attempt |
| `stepTimeoutMs`     | `number`              | —       | Timeout for each step |

## CLI Reference

### `pickle run [glob]`

Run feature files.

```bash
pickle run                              # Run all features/**/*.feature
pickle run "tests/**/*.feature"         # Custom glob pattern
pickle run --headed                     # Show browser window
pickle run --verbose                    # Verbose output
pickle run --tag "@smoke and not @ignore" # Filter by tag expression
pickle run --scenario checkout          # Filter by scenario name
pickle run --shard 1/3                  # Run one deterministic shard
pickle run --config ./custom.config.ts  # Custom config path
pickle run --language pt                # Run with Portuguese Gherkin
pickle run --screenshot on-failure      # Capture screenshots on failure
pickle run --json .pickle/results/run.json   # Write JSON results
pickle run --junit .pickle/results/junit.xml # Write JUnit XML results
pickle run --retries 1                  # Retry infrastructure failures once
pickle run --scenario-timeout 30000     # Timeout a scenario attempt
pickle run --step-timeout 10000         # Timeout an individual step
pickle run --reuse-server               # Reuse an already-running healthy server
pickle run --open-report                # Always open the HTML report
pickle run --no-open-report             # Never open the HTML report
pickle run -j 5                         # Run 5 scenarios in parallel
```

| Flag                       | Description                          |
| -------------------------- | ------------------------------------ |
| `-c, --config <path>`      | Path to config file                  |
| `--headed`                 | Disable headless mode (show browser) |
| `--verbose`                | Enable verbose logging               |
| `-t, --tag <expr>`         | Filter scenarios by tag expression   |
| `--scenario <text>`        | Filter by case-insensitive scenario name |
| `--shard <index/total>`    | Run only one deterministic shard     |
| `-l, --language <code>`    | Override Gherkin language             |
| `--screenshot <mode>`      | Screenshot mode: `off`, `on-failure`, `on-step` |
| `--json <path>`            | Write machine-readable JSON output   |
| `--junit <path>`           | Write JUnit XML output               |
| `--retries <n>`            | Retry infrastructure failures        |
| `--scenario-timeout <ms>`  | Timeout a full scenario attempt      |
| `--step-timeout <ms>`      | Timeout an individual step           |
| `--reuse-server`           | Reuse an already-running healthy server |
| `--open-report`            | Always open the generated HTML report |
| `--no-open-report`         | Never open the generated HTML report |
| `-j, --concurrency <n>`   | Max parallel scenarios per feature   |

## Validation

pickle-spec validates runtime configuration before starting your server or browser. Common misconfiguration errors now fail fast, including:

- invalid `concurrency`
- invalid screenshot `mode` or `format`
- invalid shard coordinates
- invalid retry or timeout values
- missing Browserbase credentials when `browser.env = 'BROWSERBASE'`
- missing provider API keys for known model families unless `browser.modelClientOptions.apiKey` is set explicitly

### `pickle init`

Scaffold a starter `pickle.config.ts` in the current directory.

```bash
pickle init
```

## Environment Variables

Bun automatically loads `.env` files. Set the API key for your chosen model provider:

```
# Anthropic (default)
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
OPENAI_API_KEY=sk-...

# Google
GOOGLE_GENERATIVE_AI_API_KEY=...

# Other supported providers
GROQ_API_KEY=...
MISTRAL_API_KEY=...
DEEPSEEK_API_KEY=...
XAI_API_KEY=...
```

The correct env var is auto-detected based on your configured `modelName`. You can also pass the key directly via `browser.modelClientOptions.apiKey` in your config.

When using Browserbase, also set:

```
BROWSERBASE_API_KEY=...
BROWSERBASE_PROJECT_ID=...
```

## Credits

- [Stagehand](https://github.com/browserbase/stagehand) — AI-powered browser automation library

## License

MIT
