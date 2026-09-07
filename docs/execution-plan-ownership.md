# Execution-plan ownership and contracts

Status: approved, revision 1, on 2026-09-04. ENG-03 is complete.
This document defines approved contracts. None of its APIs, files, or lifecycle
states are implemented by this change. Implementation belongs to ENG-04
through ENG-08.

## Decision

A project owns immutable authored revisions under its configuration root at
`.pickle/plans/`. Each Scenario, execution target profile, and adapter has one
repository-owned selection in its checked-out branch. Local admission determines
whether that selection is executable in a particular worktree. The runner owns applicability and lifecycle
policy. Adapters own payload parsing, inspection, editing, and execution.
The CLI composes filesystem access. Studio presents the resulting contracts.

An applicable active revision is authoritative. It runs directly through the
adapter's existing Replay representation, without reading or publishing the
shared Execution cache. This first version needs no plan-materialization cache.
Cache refresh, eviction, and concurrent Adaptive runs cannot overwrite an edit.

When no authored selection exists, the current cache behavior remains intact.
When an authored selection exists but cannot run, execution stops with a named
reason. It does not silently choose an older cache entry or invoke a model.

| Alternative | Benefit | Decision |
| --- | --- | --- |
| One JSON document containing all revisions and its active pointer | One atomic replacement and one read | Rejected. Every edit rewrites history, and branch merges mix immutable payloads with mutable selection |
| Immutable revision files plus one selection file per Scenario/profile/adapter | Independent drafts, small selection conflicts, stable provenance | Chosen. Unreferenced revisions can remain; garbage collection is not part of this delivery |
| Cache-first execution, with authored plans used only after a miss | Reuses current cache lookup | Rejected. A stale cache could override an accepted repair because the existing key has no authored revision dimension |
| Add plan identity to the existing cache key | Separates materializations | Deferred. Direct Replay makes this cache migration unnecessary |

## Existing contracts that constrain the decision

The [cache key](../packages/runner/src/execution-cache/execution-cache.ts)
compares eight fields exactly. The cache store is mutable and supports deletion,
clear, and eviction. Its numeric publication revision is a coordination token,
not an authored revision ID.

The [local project key](../packages/runner/src/storage/local-project-storage.ts)
hashes a canonical local path. Linked worktrees at a Git project root share the
common Git directory identity. Separate clones have different local keys.
A project rooted below that Git directory can instead use its canonical project
path. Preserve this behavior. Never commit the local key as portable identity.

The [runner selection path](../packages/runner/src/execution-cache/run-scenario-cache.ts)
currently checks refresh before cache lookup. It can delete invalid cache
payloads and fall back to Adaptive execution. Those behaviors must not become
durable-plan behavior. The [prefix contract](../packages/runner/src/execution-cache/cached-step-prefix.ts)
already distinguishes mixed web Replay from complete-only mobile Replay.

The [web schema](../packages/web/src/execution-cache/web-cache-schema.ts)
owns instructions and templates. The [mobile schema](../packages/mobile/src/execution-cache/mobile-execution-cache.ts)
owns an `agent-device-ad` script and step ranges. Do not convert either into a
shared action language. The [Studio cache gateway](../packages/cli/src/studio/studio-cache.ts)
continues to inspect and clear disposable entries. It does not own authored plans.

## Caller flow and proposed types

The caller inspects a source run or cache entry, captures an immutable draft,
changes one supported interaction target, reviews intent, and validates the
complete candidate. Activation then compares the expected selection and
validation basis before changing the pointer. A validation run never activates
a candidate by itself.

The following TypeScript is the proposed shared shape. Runtime schemas must
validate unknown input before producing these types. Digests are lowercase
SHA-256 strings validated at the boundary. IDs and indices are not client-trusted.

```ts
import type { ExecutionCacheKey } from '@pickle-spec/runner'
import type { WebLocator } from '@pickle-spec/web'

type Digest = string
type PlanScope = Readonly<Omit<ExecutionCacheKey, 'projectKey'>>
type Actor = { kind: 'human' | 'agent'; id: string }
type RunReference = { projectKey: string; runId: string; resultDigest: Digest }
type StepIdentity = { scenarioRevision: string; index: number }

type PlanOrigin =
  | { kind: 'capture'; sourceRun: RunReference; payloadDigest: Digest }
  | { kind: 'cache-capture'; payloadDigest: Digest }
  | { kind: 'revision'; revisionId: Digest }

type PlanRevision = {
  formatVersion: 1
  id: Digest
  scope: PlanScope
  origin: PlanOrigin
  author: Actor
  createdAt: string
  requiredVariables: readonly string[]
  steps: readonly StepIdentity[]
  adapterPayload: unknown
  assertionBaselineRevisionId: Digest | null
}

type IntentReview = {
  reviewer: { kind: 'human'; id: string }
  candidateId: Digest
  baselineId: Digest
  scenarioRevision: string
  decision: 'preserves-specification'
  rationale: string
  evidenceRunIds: readonly string[]
}

type ValidationReceipt = {
  id: Digest
  revisionId: Digest
  key: ExecutionCacheKey
  inputSnapshotDigest: Digest
  assertionDigest: Digest
  intentReviewDigest: Digest
  validationRun: RunReference
  adapterValidatorVersion: string
  validatedAt: string
  result: 'passed'
  inferenceCount: 0
}

type PlanSelection = {
  formatVersion: 1
  generation: number
  active: { revisionId: Digest } | null
  createdAt: string
  previousSelectionDigest: Digest | null
  actor: Actor
  reason: 'activate' | 'rollback' | 'deactivate'
}

type PlanAdmission = {
  selectionDigest: Digest
  validationId: Digest
}

type ValidationHead = {
  basisDigest: Digest
  generation: number
  run: RunReference
  outcome: 'passed' | 'failed' | 'cancelled'
  receiptId: Digest | null
}

type PlanState =
  | {
      state: 'selected-unavailable'
      revision: PlanRevision | null
      selection: PlanSelection | null
      reason: PlanUnavailableReason
      message: string
    }
  | { state: 'draft'; revision: PlanRevision }
  | { state: 'validated'; revision: PlanRevision; receipt: ValidationReceipt }
  | {
      state: 'active'
      revision: PlanRevision
      receipt: ValidationReceipt
      selection: PlanSelection
    }

type PlanUnavailableReason =
  | 'unsupported-format' | 'unsupported-adapter' | 'invalid-payload'
  | 'missing-revision' | 'inapplicable' | 'incomplete-plan'
  | 'assertion-change' | 'specification-review-required'
  | 'validation-required' | 'stale-validation' | 'write-conflict'
  | 'refresh-conflicts-with-active-plan' | 'validation-failed' | 'cancelled'

type PlanResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: PlanUnavailableReason; message: string }

type ReplaceWebInteractionTarget = {
  step: StepIdentity
  instructionIndex: number
  expectedInstructionDigest: Digest
  locator: WebLocator
}

type ActivationRequest = {
  revisionId: Digest
  validationId: Digest
  expectedSelectionDigest: Digest | null
  expectedValidationHeadDigest: Digest
  actor: Actor
  reason: 'activate' | 'rollback'
}

type PlanUse = {
  revisionId: Digest
  selectionDigest: Digest | null
  key: ExecutionCacheKey
  payloadDigest: Digest
  author: Actor
  origin: PlanOrigin
} & (
  | { purpose: 'validation'; validationId: null }
  | { purpose: 'active'; validationId: Digest }
)
```

`PlanState` is a projection, not a mutable field in an immutable revision.
An unselected revision without a valid local receipt is draft. A valid receipt means validated. A matching
selection, local admission, and valid receipt mean active. A selected revision
with missing or stale proof is shown as selected but unavailable, not as active or silently absent.
Prior revisions remain available after another revision becomes active.
In `selected-unavailable`, null revision means missing/unreadable content; null
selection means its existing file could not be parsed. Neither means absence.

Author attribution records who initiated a change. It is not an authentication
or cryptographic signature system. An agent identity must name its invoking
tool or session. Human review is a separate record and cannot be self-issued
by an agent through the repair API.

## Identity, storage, and boundaries

Proposed repository files are deliberately small in number of formats:

```text
.pickle/plans/revisions/<revision-id>.json
.pickle/plans/selections/<slot-id>.json
.pickle/runtime/plans/<slot-id>.lock
.pickle/runtime/plans/validations/<validation-id>.json
.pickle/runtime/plans/reviews/<review-id>.json
.pickle/runtime/plans/admissions/<slot-id>.json
.pickle/runtime/plans/validation-heads/<basis-digest>.json
```

Revision and selection files are repository-owned. Locks, review records, and
validation receipts, heads, and admission records are local to the canonical worktree and ignored by Git.
Ordinary cache clear does not touch either category. Run retention can make
source evidence unavailable for inspection or a new activation. It does not
revoke an existing admission backed by its retained local receipt and review.
The receipt preserves the validated run identity and result digest; inspection
reports missing run artifacts explicitly. Missing receipt or review still blocks
execution. This avoids adding a second owner to user-controlled run pins.

The slot ID is SHA-256 of the UTF-8 JSON array
`[scope.scenarioId, scope.executionTargetProfileId, scope.adapterKind]`. Use the
existing resolved IDs verbatim, without additional path or case normalization.
Readers recompute the slot ID from the referenced revision and reject mismatches.
Selection digests use the same canonical JSON algorithm as revisions, over all
selection fields. The owning configuration root supplies project identity.
No parent-directory search, client-supplied project key, or cross-project plan
lookup is allowed. Copying a plan into another project is an explicit import
and requires local validation and intent review there. Selection files express
branch intent; working copies and admission records are independent in linked
worktrees. A clone starts selected but unavailable. Its local admission binds
the current project key and a new receipt without changing the committed pointer.
Rollback cannot reuse another project key or worktree's receipt.

Revision IDs hash canonical JSON of every revision field except `id`, including
author, origin, and scope. Canonicalization sorts object keys recursively and
preserves array order and string bytes. Duplicate JSON keys, unknown fields,
invalid numbers, and duplicate variables are rejected before hashing. A file's
name must match its computed ID. Source run references are provenance only;
their local project keys are not portable applicability or authority.

Step identity is the existing template Scenario revision plus a zero-based
step index. Duplicate text at different indices remains distinct. Editing,
reordering, or removing a Gherkin step changes the Scenario revision and
invalidates old identities. Do not match by line number or fuzzy text. Scenario
Outlines use template identity; validation separately records the selected
Examples rows and runtime input snapshot. Mobile step ranges stay adapter-owned.

The runner constructs the effective `ExecutionCacheKey` from the current local
project key and the revision's scope. Every field must equal the resolved run
input. Missing application revision blocks plan validation and execution.
Moving a plan between application revisions or profiles creates a new draft
with explicit scope. It never changes the parent's scope in place.

Payloads retain variable references, not resolved credentials. The existing
confidentiality checks remain mandatory at capture and export. Runtime input
snapshots use local keyed digests and source-version metadata; raw secrets and
plain hashes of low-entropy secrets must not enter repository files.

## Lifecycle operations and failure behavior

These are proposed domain operations, not new HTTP endpoints. The CLI binds
them to one project root. Studio's feature-local transport passes typed requests
and displays typed results. No operation accepts arbitrary filesystem paths.

| Operation | Input and result | Required behavior |
| --- | --- | --- |
| `inspectPlans` | Optional slot and revision IDs → selected state, revision history, adapter projection, and local review/validation references | Return absent or explicit unavailable reasons; never expose raw secrets or require Studio to read files |
| `captureDraft` | Verified source run or current cache snapshot, scope, actor → revision | Capture exact parsed bytes and origin digest. Never claim that current cache metadata proves an older run used those bytes. A cache-only capture uses `cache-capture` origin, never an invented source run; explicit baseline review is required |
| `deriveDraft` | Parent revision ID, desired scope, actor → revision | Preserve payload and assertion baseline. Rebinding scope invalidates all prior validation |
| `replaceWebInteractionTarget` | Parent ID, `ReplaceWebInteractionTarget`, actor → new revision | Check parent and instruction digests. Change one supported locator, preserve all other instruction bytes and order |
| `reviewIntent` | `IntentReview` → local review digest | Require explicit human Specification review. Bind review to candidate, baseline, Scenario revision, and evidence |
| `validateCandidate` | Revision ID, review digest, resolved input selection, cancellation signal → receipt or failure | Run complete candidate through Replay in isolation with zero inference. Preserve failed/cancelled run evidence but issue no passing receipt |
| `activate` | `ActivationRequest` → selection and local admission or conflict | Recheck receipt, source snapshot, applicability, and expected selection under the write lock |
| `admitSelection` | Current selection digest, receipt ID, validation-head digest → local admission | Apply all activation checks to the already selected revision without changing repository files |
| `deactivate` | Expected selection digest and actor → selection with `active: null` | Explicitly restore ordinary cache policy. Never delete history |
| `rollback` | Prior revision ID and fresh matching receipt through `ActivationRequest` → new selection | Apply the same checks as activation. No mutation of prior revisions or old runs |
| `resolveForRun` | Resolved run input and project-bound selection → pinned `PlanUse` and parsed payload, absent, or reason | Distinguish absent from unavailable. Hold one immutable selection for the whole run |

Initial web editing supports locator replacement for `click`, `fill`, `type`,
`hover`, and `select-option` in non-outcome steps. Method, values, variables,
instruction count, and order stay fixed. Navigation, waits, assertion locators,
and assertion predicates are read-only. Unsupported edits return a reason;
there is no raw JSON repair endpoint. Locator edits for instructions receiving
sensitive bindings are unsupported in version 1; unchanged value bytes alone
do not prevent sending a credential to the wrong field. Mobile payloads remain inspectable through
their adapter parser, but mobile editing and activation are unsupported until
ENG-17 supplies equivalent mapping and assertion protections.

Complete coverage comes from adapter parsing and the current Scenario, not a
client-supplied `complete` flag. Web requires exactly one nonempty instruction
group for every current template step, with the current step-role rules.
Mobile's complete-only prefix convention must not be interpreted as one covered
Gherkin step. Partial captures can be inspected and saved as drafts. Validation
returns `incomplete-plan` before opening a target and reports the missing tail.

## Assertion protection includes intent

The adapter projects every check, its step identity, its order, its predicate,
locator, expected value, and variable references from the baseline payload.
The candidate must reproduce this projection exactly. Also preserve implicit
navigation, waits, instruction order, and the role of every outcome step.
The [existing web role check](../packages/web/src/execution-cache/web-cache-instructions.ts)
is necessary but insufficient because it permits initial navigation in an
outcome group. A repair cannot add that navigation or change it to bypass a check.

Reject check deletion, exact-to-contains changes, reduced counts, different
expected values, changed assertion targets, skipped outcome groups, additional
navigation, or reordered instructions as `assertion-change`. Recomputing a
client-supplied digest cannot approve a new baseline. The service loads and
checks the immutable baseline itself.

A different interaction target can still change the business meaning while
all assertion bytes stay equal. Passing Replay is not proof of equivalence.
Initial target edits therefore require a human `IntentReview` before validation
can produce an activation receipt. The reviewer inspects the Specification,
old and new target evidence, and unchanged checks. Uncertain meaning returns
`specification-review-required`; a model's confidence is not an override.

If the expected business outcome must change, use the Specification authoring
workflow. It produces a new Scenario revision and a separately reviewed baseline.
The interaction repair API cannot weaken checks as a shortcut. Capture-only
baselines also require review before first activation. A root revision has a
null baseline revision ID; its review names that root as both candidate and
baseline. Every child-producing operation sets
`assertionBaselineRevisionId = parent.assertionBaselineRevisionId ?? parent.id`.
A child can never reset its baseline to null. The adapter computes the
projection and its receipt digest from that immutable root, never client claims.
Missing or corrupt review records return `specification-review-required`. ENG-15 and ENG-16 may
propose edits, but this contract does not grant agents human review authority.

## Selection, refresh, and no-inference execution

| Condition | Plan-aware runner behavior |
| --- | --- |
| No selection, or explicitly deactivated | Preserve current `prefer-cache`, `refresh`, and `cache-only` behavior |
| Supported, applicable, complete active revision | Pin its payload and use the existing adapter Replay executor. Do not consult or write shared SQLite entries |
| Active revision plus `refresh` | Return `refresh-conflicts-with-active-plan`. The user can explicitly deactivate or start a separately reviewed draft from a new Adaptive run |
| Selected partial, invalid, incompatible, or unsupported revision | Stop before execution with the corresponding reason. Preserve its files and active selection |
| Plan validation | Bypass global cache reads, writes, leases, self-healing, and inference. No retries with Adaptive mode. Missing bindings or unsupported instructions stop before launch |
| Replay divergence or business assertion failure | Fail and retain evidence. Do not repair, replace, deactivate, or fall back automatically |

No new action executor is introduced. The runner routes an immutable adapter
payload through the current Replay session mechanism. Construct an in-memory
`ExecutionCacheEnvelope` from the effective key, required variables, and parsed
payload to reuse that seam; do not call the cache store. `executionMode` remains
`replay` and `inferenceCount` is zero. `cacheOutcome` is absent for authored-plan
runs; calling this a cache hit would misreport its source. Reports distinguish
authored Replay through `planUse` presence and retain ordinary attempt status
for pass, failure, or cancellation. Cache-only accepts
complete authored Replay as a no-inference source in a plan-aware binary.

## Concurrency and validation-to-activation races

Writers in different worktrees write different selection files and local receipt
directories. They may still share existing SQLite cache storage. That sharing
cannot affect authored execution because the authored path bypasses the cache.
Revision creation is idempotent by content digest. An existing digest with
different bytes is corruption, not permission to overwrite it.

Within one worktree, managed mutations acquire an exclusive per-slot lock and
compare the full prior selection digest, not just a numeric generation. They
write a temporary file, flush it, and atomically rename it on the same local
filesystem. Revisions are flushed before any selection can reference them.
A crash can leave an unselected revision, which is harmless. Missing referenced
content blocks execution. Cross-host shared filesystem writers are unsupported.

The lock records an owner token and local process identity. Do not take over a
lock merely because a timeout elapsed. Recovery requires proof that its owner
process has exited; unknown ownership returns a conflict. The implementation
must not describe a read-then-rename sequence without this exclusion as CAS.

A passing receipt binds the candidate digest, full local key, assertion baseline,
intent review, adapter validator version, and selected input snapshot. There is
no time-based expiry. Creating or replacing admission requires the referenced
passing run and review records to remain available. After admission, ordinary
run retention does not revoke it; retained receipt, review, and validation head
supply execution admission, while missing run artifacts are an inspection limit. Changes to the bound inputs invalidate admission.
The input snapshot includes resolved Specification/configuration contents and
selected inputs; Git HEAD is checked during publication for checkout races, not
as a permanent freshness condition that committing the plan would invalidate.

Every completed validation, including failure and cancellation, publishes a
`ValidationHead` under the slot lock. Its basis digest hashes the candidate,
full key, input snapshot, assertion digest, review digest, and validator version.
It increments the prior generation for that exact basis. Activation and local
admission compare the expected head digest and require its passing receipt;
an older success cannot override a newer published failure. A validation still
in flight has not published evidence. If activation wins the lock first, a later
failure invalidates local admission for future runs; in-flight runs stay pinned.
Failures for another input basis do not invalidate this receipt.

Publishing selection and admission needs two atomic renames. Write selection
first, then admission under the same lock. Readers require an admission whose
selection digest matches. A crash between writes leaves selected-unavailable,
never an executable selection with another revision's proof. Retry admission
against the current pointer and validation head without rewriting the selection.

Activation captures and rechecks the canonical worktree identity, Git HEAD when
present, configuration and Specification contents, selection digest, and runtime
input snapshot. A conflict publishes nothing. Return the current selection so
the caller can reload and validate again. Rollback uses this same operation.

Git and manual file edits do not obey the managed lock. Parse and recheck the
selection and referenced content immediately before target launch. Pin the
resolved configuration and immutable payload for the run. A later checkout
cannot change an in-flight run; its result records the pinned basis. Future runs
resolve the new checkout again. No filesystem protocol can prove that an
external application still matches a falsely reused `applicationRevision`;
the application revision remains a caller-supplied deployment contract.

Git merges retain independent revision files. Conflicting selection files need
an explicit resolution and local validation. Never choose an active revision by
timestamp or merge mutable lifecycle state. After clone, branch import, or loss
of local validation records, a committed selection is unavailable until local
review, validation, and `admitSelection` succeed. A missing historical parent
prevents new repair or baseline review, but cannot rewrite an old run's evidence.

## Migration and historical evidence

Keep cache envelope version 1, all eight key fields, and existing cache APIs.
Do not migrate cache rows automatically into active plans. Explicit capture
creates a draft. Unsupported durable content is retained, unlike invalid cache
content that the current cache reader can discard.

Propose run-evidence schema version 3 with optional `PlanUse` on new attempts and
the corresponding scenario-scoped `scenario-started` events. Readers support
versions 2 and 3. A version-2 run has
unavailable plan provenance; do not infer it from today's cache or selection.
New runs pin revision and payload digests, validation and selection references,
the full effective key, and the `author` and `origin` snapshots in `PlanUse`.
Parent references can be unavailable after retention; do not imply that this
snapshot contains the entire ancestor history.
Use existing redacted artifact and action-evidence paths. Finalized run files
remain immutable; migration occurs in reader projections, not rewritten history.

An older binary does not understand the new plan directory and cannot be made
to fail closed by a future document. Plan adoption therefore requires upgrading
all authoring, execution, and CI entry points to a plan-aware binary before
activation. Record and pin that minimum release in project tooling when ENG-08
ships. Running an older binary against adopted plans is unsupported and may
ignore them. This is an explicit migration limit, not a claim of compatibility.

A plan-aware binary encountering a future document version, unknown adapter
schema, merge markers, missing content, or failed parsing returns an unavailable
reason and leaves bytes intact. It does not silently restore legacy behavior.
Projects without adopted plans continue to run unchanged.

## Acceptance examples and implementation ownership

ENG-02 supplies the [shared nine-step Scenario and fixed expectations](../apps/example/acceptance/checkout.feature).
Its controlled compiler tests are evidence for the fixture, not evidence that
the proposed plan APIs exist. Step indices below are zero-based.

```ts
const checkoutEdit: ReplaceWebInteractionTarget = {
  step: {
    scenarioRevision: '55c3d154230326e99a1d15d455136e1791323ff0b49724b4ec25a4129a267cd9',
    index: 5,
  },
  instructionIndex: 0,
  expectedInstructionDigest: 'e6723e634a9f7512e0d7b29f6a533953887a663589f20c063e8cd714b1caca41',
  locator: { selector: { segments: [{ literal: '#review-order' }] } },
}
```

The instruction digest is SHA-256 of the canonical baseline instruction
`{"kind":"click","locator":{"selector":{"segments":[{"literal":"#start-checkout"}]}}}`.
The service recomputes it from captured bytes before accepting the edit. The edit
changes only that locator. Step 6 still checks quantity 1 and total $29.99;
step 8 still checks one completed order.

| Acceptance case | Required result | Delivery owner |
| --- | --- | --- |
| Inspect original, repaired, and partial payloads | Adapter-owned operations grouped by exact template step identity; partial tail explained | ENG-04 |
| Save competing drafts; clear and evict cache | Immutable drafts and selected revision survive; no mutation of parent | ENG-05 |
| Change `#start-checkout` to `#review-order` in changed-target scope | New draft; intent review required; original assertions preserved | ENG-06 |
| Remove a check, change $29.99 to $39.99, change a check target, or add bypass navigation | Reject repair before validation | ENG-06, ENG-07 |
| Validate a complete repaired candidate | Same Scenario passes through Replay with no model key or inference; receipt created, selection unchanged | ENG-07 |
| Validate against ENG-02 business-regression scope with the identical repair | Quantity passes, $39.99 fails the original $29.99 assertion; no receipt or activation | ENG-07 |
| Validate partial web payload or unsupported mobile plan | Explain unavailable complete Replay before target launch; zero inference | ENG-07, ENG-17 |
| Validate, then alter config, Examples input, application revision, candidate, or review | Activation rejects stale validation | ENG-07, ENG-08 |
| Two activations share an expected selection; failed validation races activation | One selection writer wins; stale or invalidated receipt cannot publish | ENG-08 |
| Branch switch, clone, merge conflict, missing blob, future format, or validator upgrade | Re-resolve identity and proof; explicit unavailable state; preserve files | ENG-05, ENG-08 |
| Roll back while another run is in flight | New runs use the newly selected validated revision; in-flight and historical results retain their original basis | ENG-08 |
| Existing cache has a different payload under the same eight-field key | Authored selection wins; cache refresh cannot replace it | ENG-08 |
| Inspect finalized version-2 history after plan adoption | Historical result bytes unchanged; no invented plan provenance | ENG-04, ENG-08 |

Proposed module ownership follows existing package boundaries. The runner owns
`execution-plans` contracts, selection, validation admission, and local storage.
Web and mobile own adapter-specific payload capabilities. CLI project composition
provides the plan service separately from `createStudioExecutionCacheGateway`.
Studio keeps plan inspection and editing under a feature-local boundary and uses
[DESIGN.md](../DESIGN.md). No generic workflow engine is introduced.

## Verification of this proposal

Source baseline: `9fae3f69f5550054c63e0ecfd5c2d96b4436e9b0`, plus the
uncommitted ENG-02 fixture, inspected on 2026-09-04. This is design evidence,
not verification of future lifecycle APIs.

- Extracted both TypeScript blocks into a temporary file extending the CLI
  TypeScript configuration. `bunx --bun tsc --noEmit -p
  packages/cli/.eng03-contract-check/tsconfig.json` passed; temporary files removed.
- From `packages/runner`, `bun run test
  tests/unit/execution-cache/cached-step-prefix.test.ts
  tests/unit/results/store/immutability-and-concurrency.test.ts` passed 9 tests.
- From `packages/web`, `bun run test:unit
  tests/unit/execution-cache/web-public-replay.test.ts` passed 3 tests.
- Checked all local Markdown links and computed the example instruction's
  SHA-256 from its canonical bytes.
- Root `bun run lint` passed with 27 existing warnings; `bun run typecheck`
  passed all 8 tasks (cached); `bun run test` passed script checks and all
  7 package tasks (6 cached).
- Independent contract review identified and corrected portable selection/local
  receipt coupling, time expiry, failed-validation ordering, and lineage gaps.

ENG-03 changes no rendered interface. Accessibility, layout, typography, colors,
and interaction behavior are not newly verified here. ENG-04's rendered design
review must use [DESIGN.md](../DESIGN.md) and the actual inspection flow.

## Approval record

Revision 1 was approved by the requesting user on 2026-09-04 with the explicit
response “approved” to the contract approval request in this conversation.
ENG-03 is complete. Approval covers immutable repository revisions,
worktree-local validation, authoritative authored Replay, conservative human
intent review, the proposed run-evidence version, and the migration limits above.

Approved contract SHA-256:
`b0c8b9f79b628b67e3b64c16c4e3205e3d449c292aee80df954ae477c768bafa`.
The digest covers the exact UTF-8 text after the `## Decision` heading and before
`## Verification of this proposal`, including intervening whitespace. Status,
verification notes, and this approval record are outside that digest.

Record later contract changes with their own approval instead of silently
changing what ENG-04 through ENG-08 implement.
