# pickle-spec

AI-powered Gherkin test runner. Write `.feature` files in natural language. pickle-spec executes them with AI and browser automation. No step definitions needed.

## How It Works

pickle-spec parses standard Gherkin `.feature` files and executes each step using AI-powered browser automation:

- **Given / When** steps are dispatched as browser actions — clicking, typing, navigating
- **Then** steps are dispatched as verifications — the AI reads the page and checks if the expectation is met
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

After each run, pickle-spec generates an HTML report with embedded screenshots and traces, and opens it in your browser automatically.

## Configuration

Create `pickle.config.ts` in your project root (or run `pickle init`):

```typescript
import { defineConfig } from 'pickle-spec'

export default defineConfig({
  language: 'en',
  concurrency: 3,
  server: {
    command: 'bun run dev',
    port: 3000,
    url: 'http://localhost:3000',
  },
  browser: {
    env: 'LOCAL',
    modelName: 'claude-4-6-sonnet-latest', // or 'gpt-4o', 'gemini-2.0-flash', etc.
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
| `verbose`     | `boolean`              | `false`                    | Enable verbose logging                   |

### Server options

If configured, pickle-spec starts your dev server before running tests and stops it afterward.

| Option           | Type     | Default | Description                                      |
| ---------------- | -------- | ------- | ------------------------------------------------ |
| `command`        | `string` | —       | Shell command to start the server                |
| `port`           | `number` | —       | Port the server listens on                       |
| `url`            | `string` | —       | Base URL for navigation                          |
| `startupTimeout` | `number` | `30000` | Milliseconds to wait for the server to be ready  |

### Browser options

| Option               | Type                        | Default                      | Description                               |
| -------------------- | --------------------------- | ---------------------------- | ----------------------------------------- |
| `env`                | `'LOCAL' \| 'BROWSERBASE'`  | `'LOCAL'`                    | Run browser locally or via Browserbase    |
| `modelName`          | `string`                    | `'claude-4-6-sonnet-latest'` | AI model for browser automation           |
| `modelClientOptions` | `{ apiKey?, baseURL? }`     | —                            | Custom API key or base URL for the model  |
| `headless`           | `boolean`                   | `true`                       | Run browser without a visible window      |
| `domSettleTimeout`   | `number`                    | `3000`                       | DOM settle timeout in ms                  |
| `actTimeoutMs`       | `number`                    | `15000`                      | Act operation timeout in ms               |
| `observeTimeout`     | `number`                    | `10000`                      | Observe operation timeout in ms           |
| `navigationTimeout`  | `number`                    | `15000`                      | Page.goto() timeout in ms                 |
| `cacheDir`           | `string \| false`           | `'.pickle/cache'`            | Cache directory for act() results. `false` to disable |
| `selfHeal`           | `boolean`                   | `true`                       | Re-run cached actions with AI when they fail |
| `domSimplification`  | `boolean`                   | `true`                       | Remove heavy DOM elements and disable animations |
| `apiKey`             | `string`                    | —                            | Browserbase API key (when env is `BROWSERBASE`) |
| `projectId`          | `string`                    | —                            | Browserbase project ID                    |
| `verbose`            | `0 \| 1 \| 2`              | —                            | Logging verbosity level                   |

### Screenshot options

| Option      | Type                                   | Default              | Description                                |
| ----------- | -------------------------------------- | -------------------- | ------------------------------------------ |
| `mode`      | `'off' \| 'on-failure' \| 'on-step'`  | `'off'`              | When to capture screenshots                |
| `outputDir` | `string`                               | `'./.pickle/artifacts'` | Output directory for screenshots        |
| `format`    | `'png' \| 'jpeg'`                      | `'png'`              | Image format                               |
| `fullPage`  | `boolean`                              | `false`              | Capture full scrollable page               |

## CLI Reference

### `pickle run [glob]`

Run feature files.

```bash
pickle run                              # Run all features/**/*.feature
pickle run "tests/**/*.feature"         # Custom glob pattern
pickle run --headed                     # Show browser window
pickle run --verbose                    # Verbose output
pickle run --tag @smoke                 # Filter by tag
pickle run --config ./custom.config.ts  # Custom config path
pickle run --language pt                # Run with Portuguese Gherkin
pickle run --screenshot on-failure      # Capture screenshots on failure
pickle run -j 5                         # Run 5 scenarios in parallel
```

| Flag                       | Description                          |
| -------------------------- | ------------------------------------ |
| `-c, --config <path>`      | Path to config file                  |
| `--headed`                 | Disable headless mode (show browser) |
| `--verbose`                | Enable verbose logging               |
| `-t, --tag <tag>`          | Filter scenarios by tag              |
| `-l, --language <code>`    | Override Gherkin language             |
| `--screenshot <mode>`      | Screenshot mode: `off`, `on-failure`, `on-step` |
| `-j, --concurrency <n>`   | Max parallel scenarios per feature   |

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
