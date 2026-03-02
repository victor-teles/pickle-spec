# pickle-spec

AI-powered Gherkin test runner. Write `.feature` files in plain English — pickle-spec executes them with Claude and browser automation. No step definitions needed.

## How It Works

pickle-spec parses standard Gherkin `.feature` files and executes each step using [Stagehand](https://github.com/browserbase/stagehand), an AI-powered browser automation library:

- **Given / When** steps are dispatched as browser actions (`stagehand.act()`) — clicking, typing, navigating
- **Then** steps are dispatched as verifications (`stagehand.extract()`) — the AI reads the page and checks if the expectation is met
- Steps containing **"navigate to"** are handled as direct URL navigation

Each scenario gets its own isolated browser context.

## Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- An [Anthropic API key](https://console.anthropic.com/) for Claude

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

Create a `.env` file (Bun loads it automatically):

```
ANTHROPIC_API_KEY=sk-ant-...
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

## Configuration

Create `pickle.config.ts` in your project root (or run `pickle init`):

```typescript
import { defineConfig } from 'pickle-spec'

export default defineConfig({
  server: {
    command: 'bun run dev',
    port: 3000,
    url: 'http://localhost:3000',
  },
  stagehand: {
    env: 'LOCAL',
    modelName: 'claude-4-6-sonnet-latest',
    headless: true,
  },
})
```

### Server options

If configured, pickle-spec starts your dev server before running tests and stops it afterward.

| Option           | Type     | Default | Description                                      |
| ---------------- | -------- | ------- | ------------------------------------------------ |
| `command`        | `string` | —       | Shell command to start the server                |
| `port`           | `number` | —       | Port the server listens on                       |
| `url`            | `string` | —       | Base URL for navigation                          |
| `startupTimeout` | `number` | `30000` | Milliseconds to wait for the server to be ready  |

### Stagehand options

| Option               | Type                        | Default                      | Description                               |
| -------------------- | --------------------------- | ---------------------------- | ----------------------------------------- |
| `env`                | `'LOCAL' \| 'BROWSERBASE'`  | `'LOCAL'`                    | Run browser locally or via Browserbase    |
| `modelName`          | `string`                    | `'claude-4-6-sonnet-latest'` | AI model for browser automation           |
| `modelClientOptions` | `{ apiKey?, baseURL? }`     | —                            | Custom API key or base URL for the model  |
| `headless`           | `boolean`                   | `true`                       | Run browser without a visible window      |
| `apiKey`             | `string`                    | —                            | Browserbase API key (when env is `BROWSERBASE`) |
| `projectId`          | `string`                    | —                            | Browserbase project ID                    |
| `verbose`            | `0 \| 1 \| 2`              | —                            | Logging verbosity level                   |

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
```

| Flag                  | Description                          |
| --------------------- | ------------------------------------ |
| `-c, --config <path>` | Path to config file                  |
| `--headed`            | Disable headless mode (show browser) |
| `--verbose`           | Enable verbose logging               |
| `-t, --tag <tag>`     | Filter scenarios by tag              |

### `pickle init`

Scaffold a starter `pickle.config.ts` in the current directory.

```bash
pickle init
```

## Programmatic API

You can import `defineConfig` for type-safe configuration:

```typescript
import { defineConfig } from 'pickle-spec'
import type { PickleSpecConfig, ServerConfig, StagehandConfig } from 'pickle-spec'
```

## Environment Variables

Bun automatically loads `.env` files. Set your API key there:

```
ANTHROPIC_API_KEY=sk-ant-...
```

When using Browserbase, also set:

```
BROWSERBASE_API_KEY=...
BROWSERBASE_PROJECT_ID=...
```

## License

MIT
