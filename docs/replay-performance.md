# Replay performance gate

Pickle Spec measures Replay against Adaptive execution with controlled adapters.
The gate answers one question: after a successful Adaptive run has populated the
local SQLite cache, how much orchestration time does Replay need to execute the
same deterministic representation?

Run the complete controlled gate from the repository root:

```sh
bun run benchmark:replay
```

The command prints one JSON result for web and one for mobile. When an adapter
exceeds its budget, the root gate repeats that adapter once and prints the
second result. It exits with a non-zero status when the repeated benchmark also
exceeds its budget or an adapter cannot produce enough samples, so the same
command can run in CI. Adapter execution errors are not retried.

## Measurement protocol

Each adapter uses the same Scenario, adapter configuration, runtime bindings,
and artifact policy for both modes. Artifacts are disabled. Samples run with
concurrency `1` and use `performance.now()` around the complete Scenario run.

The controlled harness runs three warm-up pairs and discards them. It then
records at least 20 paired Adaptive and Replay samples. Pairing reduces drift
from background load because every Replay sample is compared with an Adaptive
sample from the same measurement cycle.

The reported JSON includes the raw samples in milliseconds plus p50 and p95 for
each mode. Percentiles use the nearest-rank sample from the sorted measurements.
No warm-up sample contributes to those values.

## Budgets

| Adapter | p50 budget | p95 budget |
| --- | ---: | ---: |
| Web | Replay <= 50% of Adaptive | Replay <= 65% of Adaptive |
| Mobile | Replay <= 75% of Adaptive | Replay <= 110% of Adaptive |

The mobile CI gate uses a controlled in-process driver. It compiles and compares
the deterministic `.ad` representation without launching an emulator, a worker
process, or Agent Device. Its p95 tolerance accounts for measured tail variance
in SQLite orchestration, the mobile protocol path, and simulated runtime work.
Its p50 still requires a material orchestration improvement, and the gate does
not manufacture model latency to make Replay look faster.

The gate rejects fewer than 20 measured pairs. A value exactly on a budget is a
pass; a value above it is a failure.

## Interpreting results

p50 describes the typical warm execution. p95 exposes tail latency such as
process scheduling, SQLite contention, and adapter/runtime coordination.
Inspect the raw paired samples before treating a single percentile movement as
a regression.

If the gate fails:

1. Stop unrelated CPU-, disk-, browser-, and emulator-heavy work.
2. Compare both JSON results from the gate's automatic retry.
3. Compare raw pairs, not only rounded ratios.
4. If the same budget failed twice, preserve the JSON output and investigate
   the slow path before changing a threshold.

Live browser and emulator runs remain useful informational checks, but they are
not the reproducible CI gate. Record device, operating-system, browser/emulator,
and Pickle Spec revisions whenever sharing live measurements.
