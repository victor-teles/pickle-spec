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
          "mode": "on-failure",
          "outputDir": ".pickle/artifacts"
        }
      }
    }
  },
  "applicationRevision": "git:HEAD",
  "policy": {
    "adaptedResults": "reject"
  },
  "execution": {
    "infrastructureRetries": 1,
    "scenarioTimeoutMs": 30000,
    "stepTimeoutMs": 10000
  },
  "concurrency": 3
}
```

Set the API key for the configured model provider. Bun loads environment variables from `.env`. For local Chrome, Stagehand needs that key on `model.apiKey`: set `web.browser.modelApiKey` or the provider env var (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`). `web.browser.modelName` must be a Stagehand-supported `provider/model` value; Pickle Spec rejects unknown names before it starts browsers.

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
```

The command writes versioned run-event and test-result records as newline-delimited JSON.

## Run Adaptive and Replay modes

A Scenario without an applicable approved plan runs in Adaptive mode. Adaptive mode resolves actions while the Scenario runs and writes a candidate plan under `.pickle/candidates/`.

An applicable approved plan runs in Replay mode. Replay mode uses the stored resolved actions and does not resolve actions with a model. Approved plans live under `.pickle/plans/` and belong in Git.

A plan applies to one Scenario revision, execution target profile, plan-format version, and application revision. A plan for one execution target profile cannot run on another profile.

If Replay cannot complete a Scenario and Adaptive mode then succeeds, the test result is `passed-with-adaptation`. That run writes a candidate plan. It does not change the approved plan.

Set `applicationRevision` in `pickle.config.jsonc` or pass `--application-revision`. CI Replay requires that value. CI can reject adapted results:

```jsonc
{
  "applicationRevision": "git:abc123",
  "policy": {
    "adaptedResults": "reject"
  }
}
```

`policy.adaptedResults` accepts `accept` or `reject`. The default is `accept`.

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
