# Separate specifications, orchestration, and execution-target adapters

Pickle Spec separates specification management, test-run orchestration, execution-target adapters, and product surfaces. This boundary keeps scenarios independent from Stagehand and `agent-device`.

## Package ownership

- `@pickle-spec/spec` owns the specification model, parser, and editor operations.
- `@pickle-spec/runner` owns scheduling, execution policy, events, and test results.
- `@pickle-spec/web` adapts Stagehand to the runner contract.
- `@pickle-spec/mobile` adapts `agent-device` to the runner contract.
- `@pickle-spec/studio` owns the local application, storage, and user interface.
- `@pickle-spec/cli` composes the packages into commands.

The runner owns concurrency, retries, timeouts, cancellation, adaptation, run events, and test results. Each adapter declares capabilities and owns logical sessions, actions, verification, and artifact capture.

The specification, runner, web, and mobile packages expose small public interfaces. The Studio and CLI are executable products, not general-purpose libraries.

Project configuration imports custom adapters explicitly. The first version does not discover plugins dynamically.

Scenarios can declare capability requirements without naming an adapter. The runner validates those requirements against each selected target profile before execution.

The runner rejects a selected target that lacks a required capability. It does not report that configuration error as a skipped scenario.
