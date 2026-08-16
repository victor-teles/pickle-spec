---
name: 10x-coder
description: >-
  A skill for appling coding best practices using KISS, DRY, Clean Code, SOLID, and
  the repository's local conventions. This is a focused code-quality pass, not a request to run the
  test suite, type checker, or linter.
---

# 10x coder

Always apply coding best practices using KISS, DRY, Clean Code, SOLID but also
Treat repository instructions and neighboring code as the source of truth.

Separate concerns first. Extend instead of modify, respect contracts, keep
interfaces small, and inject dependencies — but only when the touched code
already needs that shape. If two solutions are correct, prefer the one that
needs less code, fewer concepts, and less explanation. A small file with one
job beats a large file that does many.

For concrete before/after patterns, see [examples.md](examples.md).

## Keep the contract narrow

- Work only on code touched by the current task and the minimum supporting code
  required to clean it safely. Splitting a touched file by concern is in
  scope. Creating a new package, layer, or rewrite is not.
- Preserve behavior, public contracts, compatibility, and intentional product
  decisions unless the user explicitly requests a change.
- Do not treat cleanup as permission to create, update, push, merge, or
  automerge a PR. Run this pass before those actions only when they are already
  authorized.
- Do not run the test suite, type checker, or linter merely because cleanup was
  requested. Run a focused check only when needed to establish that a material
  cleanup is safe.

## Perform the pass

1. Read repository instructions, `git status`, and the complete relevant diff.
2. Remove dead code, stale comments, debug logging, commented-out code,
   accidental exports, unused branches, and temporary workarounds.
3. Reuse or extend an existing helper before adding another implementation.
4. Simplify control flow, names, data movement, and module boundaries.
   Name inline parameter types. Resolve config fallbacks before the object.
   If the touched file mixes unrelated concerns or is too large to scan,
   split by concern into neighboring files and keep public exports stable.
5. Apply Clean Code, KISS, DRY, SOLID, and separation of concerns
   proportionally to the actual problem. Read [examples.md](examples.md)
   when a rewrite could grow a class hierarchy, a new abstraction, a
   shared helper, a config object, or a file split.
6. Re-read the resulting diff for scope creep, behavioral drift, needless
   churn, and inconsistent style.
7. Report what changed and any focused verification performed.

## Apply Clean Code

Make the business intent obvious without forcing the reader to mentally execute
the code.

- Choose precise names that expose intent and match the domain vocabulary.
  Prefer `activeUsers` over `u`, `TransactionStatus.SETTLED` over `3`.
- Keep functions focused on one coherent responsibility and one level of
  abstraction.
- Prefer early returns and positive conditions over nested `if` trees and
  double negatives (`user.isActive`, not `!user.isNotActive`).
- Extract complex conditions into named predicates (`canUserTransfer(user)`).
- Replace magic numbers with named constants (`maxLoginAttempts`).
- Prefer built-in transformations (`filter`, `map`, `includes`) over manual
  loops. Use `map` only to transform data, never for side effects.
- Prefer default parameters, optional chaining, and nullish coalescing over
  defensive `if` scaffolding.
- Prefer lookup objects over repeated equality checks for the same field.
- Keep functions small enough that the happy path is obvious in one glance.
  Extract named types and named values before growing the body.
- Keep files small enough that one concern fits in the head. Do not append
  a second job to a file that is already hard to scan.
- Avoid boolean positional arguments. Use a named options object or separate
  functions when the call site would otherwise read as `fn(data, true, false)`.
- Keep dependencies explicit. Avoid new global state, temporal coupling, and
  action-at-a-distance.
- Encapsulate invariants where they are enforced. Do not scatter the same rule
  across callers.
- Handle errors at the boundary that can add context or recover. Throw
  meaningful errors (`Transaction ${id} was not found`), not `Error('Error')`.
  Do not swallow failures or add catch-and-rethrow noise.
- Write comments only for non-obvious intent, constraints, or tradeoffs.
  Comments explain why, not what.
- Reduce parameter lists and boolean mode switches when a clear existing type
  or cohesive operation already models the intent.
- Prefer immutability when it improves local reasoning; do not add copying or
  ceremony without benefit.
- Separate domain rules from infrastructure. A policy like `canWithdraw`
  should not query the database.

## Apply KISS and DRY

If two solutions solve the same problem correctly, prefer the one that
requires less code, fewer concepts, and less explanation.

- Prefer the smallest readable solution that satisfies the current behavior.
- Do not create a class, helper, or options bag for a one-line transformation.
- Do not make everything configurable. Add a parameter only when a second
  real caller needs it.
- Prefer readable code over clever code (`includes` over `!!~indexOf`).
- Do not use `reduce` when `map`, `filter`, or a loop states the intent
  more clearly.
- Remove a temporary variable that only renames a value once
  (`const city = user.city`). Keep a named const when it holds a fallback,
  default, or value that would clutter an object literal.
- Remove duplication when the copies express the same concept and are
  expected to change together — especially business rules, validation, and
  shared configuration.
- DRY is about duplicated knowledge, not similar-looking code. Keep
  similar-looking code separate when it represents different rules or may
  evolve independently.
- Avoid premature generalization, speculative configurability,
  framework-like helpers, and abstractions with only one caller.
- Accept a little repetition when extraction would hide intent or couple
  unrelated behavior.

## Keep units small and configs obvious

A function is too large when the reader has to reconstruct types, fallbacks,
and the call at the same time. Extract names first. Do not add a factory or
class to "fix" size.

### Named types

- Do not leave a multi-field object type inline on a function parameter.
  `{ browser: BrowserOptions; signal?: AbortSignal }` belongs in a named
  type in the same file, or in the types file the repository already uses.
- Reuse that type when the same shape appears in more than one signature.
- Do not invent a type for a single primitive or a one-field bag.

### Config objects

Assemble configuration as a plain object literal. Resolve fallbacks first,
then pass the object.

- Extract fallbacks into named consts:
  `const modelApiKey = config.modelApiKey ?? options.modelApiKey`
- Extract a fallback when it has a default or spans more than one line.
  A short `a ?? b` may stay inline if the object stays readable.
- Do not omit optional keys with
  `...(value !== undefined ? { value } : {})` or
  `...((a ?? b) ? { key: (a ?? b)! } : {})`.
- Pass the property even if it may be `undefined`. Omitting a key is not
  worth a spread, a non-null assertion, or a ternary object.

```ts
// ❌ inline type, nested fallbacks, conditional spreads
async function ensureClient(input: {
  browser: BrowserOptions
  signal?: AbortSignal
}): Promise<Client> {
  const model: ModelConfig = {
    modelName: (input.browser.modelName ??
      options.modelName ??
      'anthropic/claude-sonnet-4-6') as ModelConfig['modelName'],
    ...((input.browser.modelApiKey ?? options.modelApiKey)
      ? { apiKey: (input.browser.modelApiKey ?? options.modelApiKey)! }
      : {}),
  }
  return Client.create({
    model,
    selfHeal: input.browser.selfHeal ?? options.selfHeal ?? true,
    ...((input.browser.cache ?? options.cache) !== undefined
      ? { cache: input.browser.cache ?? options.cache }
      : {}),
  })
}

// ✅ named type, named fallbacks, plain object
type ClientContext = {
  browser: BrowserOptions
  signal?: AbortSignal
}

async function ensureClient(input: ClientContext): Promise<Client> {
  if (client) return client
  const modelName =
    input.browser.modelName ??
    options.modelName ??
    'anthropic/claude-sonnet-4-6'
  const modelApiKey = input.browser.modelApiKey ?? options.modelApiKey
  const domSettleTimeoutMs =
    input.browser.domSettleTimeoutMs ?? options.domSettleTimeoutMs ?? 3_000

  client = await Client.create({
    browser,
    model: {
      modelName: modelName as ModelConfig['modelName'],
      apiKey: modelApiKey,
    },
    logging: { level: 'off', format: 'json' },
    selfHeal: input.browser.selfHeal ?? options.selfHeal ?? true,
    domSettleTimeoutMs,
    cache: input.browser.cache ?? options.cache,
  })
  return client
}
```

## Separate concerns and keep files small

Separation of concerns is a first-class cleanup rule, not a later refactor.
Line count is a smell. Mixed jobs are the defect.

A function is too large when the happy path is no longer obvious in one
glance. A file is too large when it hosts more than one reason to change —
validation, construction, orchestration, parsing, and I/O in the same
module. Section comments and "helpers" dumped at the bottom are the usual
tells.

### What to split

- Put each concern in the file that owns it. Follow the repository's
  existing file-per-concern layout.
- During cleanup of a touched file, move a mixed-in concern out when it
  already has its own reason to change. Typical splits: options validation,
  client/factory setup, domain rules, I/O, and orchestration.
- Keep the public export surface stable. Re-export from the original module
  when callers already import from there.
- When adding code, put it in the file that owns that concern. Do not grow
  a large file because it is nearby.

### What not to split

- Do not split a cohesive module that is still easy to scan.
- Do not create a file per function, a folder per helper, or a layer that
  has only one implementation.
- Do not rename or relocate files the diff did not touch.
- Do not invent a package or plugin system to "organize" one module.

```ts
// ❌ one file owns validation, factory setup, and session orchestration
// web-adapter.ts
export function validateWebAdapterOptions(value: unknown): WebAdapterOptions
const stagehandFactory: WebAutomationFactory = { async launch() { /* ... */ } }
export function createWebAdapter(options: WebAdapterOptions) { /* screenshots, replay, steps */ }

// ✅ each concern in its own neighboring file; adapter stays the composer
// web-options.ts
export function validateWebAdapterOptions(value: unknown): WebAdapterOptions

// stagehand-factory.ts
export const stagehandFactory: WebAutomationFactory = { async launch() { /* ... */ } }

// web-adapter.ts
export { validateWebAdapterOptions } from './web-options'
export function createWebAdapter(options: WebAdapterOptions) { /* orchestration only */ }
```

## Apply SOLID without ceremony

Apply these only to code the diff already touches, and only when the current
shape is already hurting. Do not explode a simple function into a class
hierarchy during cleanup.

- **S — Single responsibility:** A unit should have one reason to change.
  This applies to functions and files. Split validation, persistence, and
  notifications when they are already mixed and changing for different
  reasons. Keep cohesive behavior together.
- **O — Open/closed:** Prefer an existing extension seam when real variants
  already exist. A growing `if (type === ...)` chain with several live
  variants is a candidate; a single branch is not. Do not invent plugin
  points for hypothetical requirements.
- **L — Liskov substitution:** A subtype must honor the parent's contract.
  Do not inherit behavior the subtype cannot support, and do not change
  implementations in a way that surprises callers.
- **I — Interface segregation:** Keep contracts small and capability-based.
  Consumers should not depend on methods they do not use. Prefer small
  objects and focused types over large base classes.
- **D — Dependency inversion:** High-level policy should not construct
  volatile I/O. Inject repositories, gateways, and adapters at meaningful
  boundaries. Do not create an interface for a single implementation
  unless it protects a real boundary, enables a required test seam, or
  isolates expected volatility.

## Reject I/O validation slop

These rules apply when the diff touches configuration, CLI argv, archives,
plans, or other untrusted input. They exist so cleanup does not reintroduce
`isRecord` helpers.

- Validate untrusted input once at the process edge. Typed functions trust
  their types. Do not call a validator that takes `unknown` from a function
  that already accepted `T`.
- Parse that edge with a schema that returns `T` (`schema.parse(value)`).
  Infer the type (`z.infer<typeof schema>`). Do not write `isRecord`,
  `record()`, `knownFields`, or `as unknown as T`.
- Do not extract a shared `isRecord` / `Record<string, unknown>` helper.
  That type only means "non-null object". It is not a domain type.
- Do not coerce invalid JSON to `{}`. Reject it, or `safeParse` and treat
  failure as missing.
- Use `z.strictObject` when extra keys must throw. Default `z.object`
  strips extra keys. Zod 4 `z.record` takes two arguments.
- Keep each schema next to the type it owns. Do not add a schema package
  just to re-export Zod. Do not add a second schema library.
- One allow-list and one error string per rule. Import them. Do not copy
  enum arrays, glob defaults, or file-name literals across packages.
- Do not swallow validation errors (`catch` + log + continue).
- Do not `process.chdir` so relative files resolve. Pass an explicit root.
- Do not compare factory references (`factory === defaultFactory`) to
  decide production behavior. Pass an explicit option.
- Do not use `id ?? name` when the domain has a durable identifier.
- One evidence predicate for capture, embed, and on-failure screenshots.
  Do not keep three `Set`s of the same result states.
- Reuse the existing slug or filename sanitizer. Do not copy
  `toLowerCase` / replace / trim-dash helpers.
- Use the repository glob matcher (`Bun.Glob`) for file discovery and
  URI filters. Do not add a second regex dialect.
- Do not leave unused parameters after a signature change.

## Match the repository

- Follow the nearest established patterns for names, imports, file layout,
  errors, tests, comments, and dependency direction.
- Treat `AGENTS.md` and other repository instructions as normative.
- Prefer existing domain types, utilities, components, and design-system
  primitives.
- For UI diffs, preserve the approved visual direction. Do not redesign during
  cleanup or introduce a parallel primitive.
- Avoid formatting or import churn outside the touched area.

## Do not

- Change behavior under the label of cleanup.
- Add dependencies without a concrete need.
- Add patterns, factories, wrappers, layers, or base classes for their own sake.
- Split a simple function into a class hierarchy to "apply SOLID".
- Extract an abstraction because two snippets look alike.
- Collapse readable code into terse tricks.
- Rewrite stable code merely to express personal preference.
- Leave multi-field object types inline on function signatures.
- Use conditional object spreads to omit `undefined` keys.
- Leave mixed concerns in a large file the diff already touched.
- Split a cohesive module into one-function files or speculative folders.
