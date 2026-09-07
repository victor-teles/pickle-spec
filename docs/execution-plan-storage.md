# Durable execution-plan storage

Status: implemented, revision 1, 2026-09-06. The approved ownership contract
is [execution-plan ownership](execution-plan-ownership.md); this document records
the ENG-05 implementation and its evidence.

The runner owns a lazy, project-root-bound `LocalExecutionPlanStore`. Opening or
inspecting an empty project does not create `.pickle` state. A write creates:

```text
.pickle/plans/revisions/<revision-id>.json
.pickle/plans/selections/<slot-id>.json
.pickle/runtime/plans/<slot-id>.lock
```

Revision files are immutable and content-addressed. Their ID is the SHA-256
digest of canonical JSON for the approved revision fields excluding `id`.
Selection files are the single mutable pointer for a Scenario, profile, and
adapter slot. Selection writes hold an exclusive worktree-local lock and
compare the complete expected selection digest before publishing the next
generation.

The storage boundary rejects duplicate JSON keys, unknown fields, future
formats, invalid digests and numbers, duplicate variables or step identities,
symlinks, traversal-like IDs, and non-JSON adapter payloads. The store accepts no
binding map and preserves payload values verbatim; adapter-owned capture and
confidentiality checks must keep resolved credentials out of those values.

| Concern | Status | Evidence |
| --- | --- | --- |
| Draft creation and structural revision validation | Implemented, verified | `createRevision` and the runner execution-plan unit suite |
| Immutable, idempotent revision history | Implemented, verified | Restart and repeated-content assertions in `local-execution-plan-store.test.ts` |
| Stale concurrent selection writes | Implemented, verified | Two store instances race on one expected digest; one succeeds and one returns `write-conflict` |
| Malformed files and path confinement | Implemented, verified | Duplicate-key, malformed-file, traversal, symlink, and byte-preservation assertions |
| Dead-owner lock recovery | Implemented, verified | Live lock conflict and proven-dead PID recovery assertions |
| Interrupted publication recovery | Implemented, partially verified | Flushed temp plus atomic hard-link/rename protocol and ignored temporary-file assertion; injected filesystem faults remain unverified |
| Cache eviction and clear independence | Implemented, verified | The store uses only `<project-root>/.pickle`; the focused suite proves both cache clear and LRU eviction leave authored files |
| Validation receipts, admissions, activation, and plan-aware execution | Unsupported in ENG-05 | Deliberately owned by ENG-07/08 under the approved contract |
| CLI or Studio mutation transport | Unsupported in ENG-05 | Persistence remains outside presentation; composition is added with editing transport in ENG-06 |

Verification run on this revision:

```text
packages/runner focused ENG-05 tests: 9 passed
packages/runner full suite: 58 files, 230 tests passed
root typecheck: 8 tasks passed
root lint: no errors; existing length warnings plus one cohesive-store length warning
```

The implementation is exported from `@pickle-spec/runner` through
`openLocalExecutionPlanStore` and the approved plan types/codecs. No cache schema,
Studio component, or existing user-owned ENG-01–04 path was changed.
