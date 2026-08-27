# Cache Adaptive step prefixes for Replay

Pickle Spec stores an Execution cache as a dense Gherkin-step prefix for one Scenario key. A failure or uncacheable step at index `k` still publishes compiled steps `0..k-1` when that head is nonempty. The next prefer-cache run opens one Target session, Replays the stored head, and Adaptive-evaluates from the first gap.

Envelope `schemaVersion` stays 1. A short web `steps` array is a prefix. A full array is a complete prefix. The SQLite key is unchanged.

## Decision

The runner owns prefix lifecycle. `CachedStepPrefix` is minted only by `cachedStepPrefixFrom` and `sealCachedStepPrefix`. Both factories reject an empty head and reject holes. Length lives in the adapter payload through `ExecutionCachePayloadValidator.prefixStepCount`. Web uses `payload.steps.length`.

A Target session is one open browser or device. The runner holds a `GapCursor` whose `replayUntil` is exclusive. Each `executeStep` receives `evaluation: 'replay' | 'adaptive'`. Adapters do not choose when to switch. Web merges Adaptive and Replay into one session object that branches on `evaluation`. `completeTargetSession` runs on every non-cancelled attempt, including failed attempts, so a failed Adaptive run can seal `0..k-1`.

`CacheOutcome` adds `partial-hit`. `hit` requires `inferenceCount === 0` and a prefix that covers every Scenario step. Mixed Replay in the same attempt is `partial-hit` and may record `prefixStepCount`. `fallback` still parses on old manifests. New runs do not write it. Test results keep flat `cacheOutcome` and `inferenceCount` on `ScenarioAttempt`. `ExecutionMode` stays `'adaptive' | 'replay'`. An attempt that Adaptive-evaluated any step is `'adaptive'`. A full Replay hit stays `'replay'`.

cache-only plus a short prefix is an immediate `cache-miss`. The runner does not open Replay for a prefix that cannot finish without inference.

Sticky uncacheable at `k` stops appending compiled steps. It does not discard `0..k-1`. `cacheable: false` is returned only when the sealed head is empty. Bound values in the sealed payload still block the write. A later publish replaces the stored envelope for the same key. Divergence that seals a shorter head overwrites a longer stale tail.

## Divergence

If the cached step is inapplicable before any instruction ran, prefer-cache reseats Adaptive on that step in the same session. If Replay of step `k` already executed instructions and then failed, the runner does not Adaptive-retry `k` in this attempt. The step fails and the runner publishes `0..k-1` when that head is nonempty.

## Mobile deferral

Mobile uses `MobilePrefixPolicy` `{ mixedReplay: false, write: 'complete-scenario-only' }`. `executeScenario` cannot reseat per step. Agent Device `stepRanges` are operations, not Gherkin steps, so the runner does not invent a step session or a Gherkin map. Partial mobile prefixes are not replayed. Mobile writes stay complete-Scenario-only until ranges map to Gherkin steps.

## Cache coordination

SQLite leases still serialize concurrent misses for the same key. A published prefix is visible to waiters. Cache refresh bypasses the current entry and replaces it after Adaptive evaluation. `--cache-only` never calls a model.

This decision supersedes ADR-0003. It replaces the all-or-nothing write after a complete Adaptive pass.
