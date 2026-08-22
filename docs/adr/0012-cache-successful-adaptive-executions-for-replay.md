# Cache successful Adaptive executions for Replay

Pickle Spec automatically stores an Execution cache after a Scenario succeeds in Adaptive mode. Replay mode uses the cached deterministic actions and verifications without model inference; a user can bypass the cache to force another Adaptive execution. The runner owns this lifecycle through a common adapter-neutral contract, while each execution-target adapter owns its versioned replay payload.

Execution caches are local-computer runtime data. Each checkout stores its SQLite database outside the repository under `~/.pickle/cache/projects/<project-key>/execution-cache.sqlite`, where `project-key` is derived from the real path of the project root. SQLite is the only cache tier. A Cache refresh bypasses the current entry and replaces it atomically only after a complete successful Adaptive execution.

An entry is keyed by the project, Scenario identifier and revision, execution target profile, target-configuration fingerprint, application revision, adapter kind, and adapter cache schema version. Application revision is required for cache reads and writes; a run without it remains Adaptive and does not persist an entry.

An execution is cacheable only when every action and verification can replay deterministically. During Adaptive mode, the adapter executes the exact representation it will persist and writes it only after that representation completes the Scenario. Web adapters persist locators, operations, parameterized arguments, and assertions that Replay executes directly through browser primitives without model credentials. Mobile adapters persist the complete native Agent Device `.ad` replay for the Scenario and materialize it as a temporary file when executing Replay. Persisted payloads contain placeholders and variable names, never bound values; an adapter that cannot separate structure from values must not cache the execution.

The runner owns a small versioned envelope containing applicability metadata, required variable names, and the adapter payload. Each adapter owns and strictly validates its payload schema before storage and execution. Runtime-specific types do not cross the adapter boundary.

When Replay diverges, normal execution invalidates the entry, performs an Adaptive fallback, and writes a replacement only if the complete Scenario succeeds. `pickle run --cache-only` instead fails without model inference. Run events expose cache hits, misses and bypasses, Replay divergence, Adaptive fallback, cache writes, and inference counts.

SQLite leases coordinate concurrent misses for the same key so only one process performs Adaptive evaluation while bounded waiters reuse the resulting entry. A lease has a renewable 30-second TTL, a 10-second owner heartbeat, and a cancelable 30-second waiter timeout. Waiters poll with jittered backoff from 100 to 500 milliseconds. A process can take an expired lease atomically; an owner that loses its lease discards its evaluation. Lease-wait timeout is an infrastructure error that does not use the Scenario retry policy or start duplicate inference. Cache refresh leaves the previous entry readable until an atomic compare-and-swap installs the successful replacement; concurrent refreshes never overwrite one another silently.

The cache retains entries for multiple Scenario and application revisions without a fixed TTL. Each checkout has a configurable 100 MiB limit and evicts least-recently-used entries by `lastUsedAt` when it exceeds that limit. Database schema migrations use `PRAGMA user_version`, while incompatible adapter payloads are invalidated instead of converted. Corruption moves the database aside for diagnosis and creates an empty replacement; cache loss is a miss, not a Scenario failure.

Each entry records creation and last-use times, hit count, source test-run identifier, adapter and payload versions, payload digest, evaluation model, and evaluation inference count. It does not store prompts, DOM content, screenshots, or bound variable values. Test artifacts remain owned by the source Test run and may expire independently.

The first version does not encrypt the cache. Cache directories use `0700` permissions and database files use `0600`. Materialized Agent Device `.ad` files use a private temporary directory and `0600` permissions and are removed during cleanup. Cache inspection shows metadata rather than executable payloads by default.

Adaptive evaluation compiles Given and When steps into ordered atomic actions and waits, and Then steps into assertions. Every operation has one target and uses placeholders for dynamic values. Web assertions are restricted to `exists`, `visible`, `hidden`, `text-equals`, `text-contains`, `value-equals`, `count-equals`, and `url-equals`. Mobile assertions use the supported Agent Device predicates, including `text`, `visible`, `hidden`, `exists`, `editable`, `selected`, and `focused`. Cached operations cannot contain arbitrary JavaScript or serialized callbacks.

If a Scenario passes but any action or verification cannot be represented deterministically, the result remains `passed` with an `uncacheable` Cache outcome and a structured reason. No entry is written, the next normal run remains Adaptive, and `pickle run --cache-only` fails immediately.

The CLI exposes normal execution through `pickle run`, forced reevaluation through `pickle run --refresh-cache`, inference-free execution through `pickle run --cache-only`, and project-scoped management through `pickle cache inspect` and `pickle cache clear`. Studio shows cache behavior with test results, offers Cache refresh beside Run, and keeps inspection and clearing under Settings.

A successful Adaptive fallback produces `passed`; existing cancelled, skipped, infrastructure-error, and flaky semantics remain. With `pickle run --cache-only`, a missing entry produces `failed` with a distinct `cache-miss` failure kind. Test results record execution mode, Cache outcome, and inference count as orthogonal fields. CI that requires zero inference invokes `pickle run --cache-only` explicitly.

HTML export includes failure artifacts by default and has no special Adaptive-fallback artifact category. Successful fallback runs retain only artifacts enabled by the normal artifact policy. Exported manifests always include execution mode, Cache outcome, and inference count.

This decision supersedes ADR-0003. It establishes automatic reuse after one successful Adaptive execution and preserves an explicit path to reevaluate a Scenario.
