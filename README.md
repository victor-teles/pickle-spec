# Pickle Spec

Pickle Spec runs Gherkin Specifications against execution targets. The current web adapter uses Stagehand for browser automation.

## Package ownership

Each scoped package owns one public boundary.

| Package | Responsibility |
| --- | --- |
| `@pickle-spec/spec` | Parse Specifications and select Scenarios. |
| `@pickle-spec/runner` | Schedule Scenarios and produce run events and test results. |
| `@pickle-spec/web` | Adapt Stagehand operations to the runner contract. |
| `@pickle-spec/cli` | Compose configuration and public package interfaces. |

The `apps/example` workspace contains sample Specifications.

## Run the development checks

To install dependencies and run the repository checks, use:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
```

To run one package test suite, use:

```bash
bunx turbo run test --filter=@pickle-spec/web
```

## Configure web execution

Create `pickle.config.jsonc` in the project root:

```jsonc
{
  "schemaVersion": 1,
  "specifications": "features/**/*.feature",
  "executionTargetProfile": {
    "id": "web"
  },
  "web": {
    "baseUrl": "http://localhost:3000",
    "browser": {
      "environment": "local",
      "modelName": "anthropic/claude-sonnet-4-6",
      "headless": true
    },
    "screenshots": {
      "mode": "on-failure",
      "outputDir": ".pickle/artifacts"
    }
  },
  "execution": {
    "infrastructureRetries": 1,
    "scenarioTimeoutMs": 30000,
    "stepTimeoutMs": 10000
  },
  "concurrency": 3
}
```

Set the API key for the configured model provider. Bun loads environment variables from `.env`.

## Run Specifications

To run the configured Specification glob, use:

```bash
pickle run
```

To select Scenarios or override execution policy, use:

```bash
pickle run "features/**/*.feature" --tag "@smoke and not @slow"
pickle run "features/**/*.feature" --scenario "checkout"
pickle run "features/**/*.feature" --shard 1/3
pickle run "features/**/*.feature" --concurrency 5 --retries 1
pickle run "features/**/*.feature" --screenshot on-step
```

The command writes versioned run-event and test-result records as newline-delimited JSON.

## Add a custom adapter

Create `pickle.extensions.ts` when a project needs a custom execution-target adapter:

```ts
import type { ExecutionTargetAdapter } from '@pickle-spec/runner'

const adapter: ExecutionTargetAdapter = {
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
  executionTargetProfile: { id: 'custom' },
  adapter,
}
```

Run the custom adapter with:

```bash
pickle run "features/**/*.feature" --extensions pickle.extensions.ts
```
