---
name: 10x-coder
description: >-
  Apply pragmatic code-quality discipline before and after implementations,
  refactors, bug fixes, and code reviews. Use for every code change or review
  to preserve contracts, keep scope narrow, choose the smallest coherent
  design, and enforce repository-specific TypeScript and React conventions.
  Also use when code is repetitive, overlong, difficult to scan, or gaining
  helpers, layers, state, effects, configuration, or validation logic.
---

# 10x coder

Produce the smallest change that is easy to understand, verify, and maintain.
KISS, DRY, Clean Code, SOLID, and separation of concerns are decision tools,
not quotas for helpers, files, interfaces, or patterns.

## Respect authority and scope

- Follow the user's request and repository instructions before this guide.
- Preserve behavior, public contracts, compatibility, and intentional product
  decisions unless the task explicitly changes them.
- Treat existing uncommitted work as user-owned. Inspect it and avoid rewriting
  unrelated changes.
- A review or audit is read-only unless the user also asks for fixes. A change
  task authorizes only the code and minimum supporting work needed for it.
- This skill does not authorize dependencies, commits, pushes, PR operations,
  migrations, or other external state changes.
- This skill does not replace or suppress verification. Run checks required by
  the task and repository, then add only the focused checks justified by risk.

## Choose the operating mode

### Implement or refactor

Before editing, identify:

1. the observable behavior or contract that must change;
2. the module that owns that behavior;
3. the smallest file set and existing seam that can express it;
4. the evidence that will show the change works.

Use that boundary as the size budget. New behavior can require net growth, but
growth in concepts, files, types, or options needs a concrete responsibility.

### Clean an existing diff

Read the complete relevant diff, then remove accidental complexity without
changing its intended behavior. Cleanup may split a touched mixed-concern file,
but it is not permission for a neighboring rewrite.

### Review or audit

Do not edit. Report concrete findings first, ordered by impact, with locations
and the violated contract or quality rule. Distinguish a real defect from a
line-count trigger or stylistic preference. Say when no material finding is
supported by the evidence.

## Work through the change

1. Read repository instructions, `git status`, the relevant implementation and
   tests, and the complete target diff. Compare with the target branch when the
   task concerns a branch or PR.
2. Trace the public seam and callers before changing a type, export, file
   boundary, error, default, or side effect.
3. Reuse the repository's vocabulary, types, utilities, components, and
   extension seams when they already own the concept.
4. Implement the behavior directly. Keep policy separate from I/O, state owned
   once, dependencies explicit, and the happy path visible.
5. Remove task-created dead code, stale comments, debug logging, unused
   branches, accidental exports, repeated guards, and temporary workarounds.
6. Re-read the final diff for behavioral drift, hidden compatibility changes,
   needless churn, duplicated knowledge, weak names, and avoidable growth.
7. Run the required and risk-appropriate checks. Never claim a check ran when
   it did not, and separate unrelated pre-existing failures from task failures.
8. Report the material result, verification, and any unresolved risk. Do not
   narrate the whole checklist when it produced no meaningful decision.

## Apply the simplicity gate

Prefer the solution with fewer concepts and a clearer contract when two
solutions are equally correct.

- Keep one source of truth for each business rule, default, allow-list, and
  state transition.
- DRY duplicated knowledge that must change together. Keep similar-looking
  code separate when it represents different rules or can evolve independently.
- Add an abstraction only when it names a real concept, removes duplicated
  knowledge, protects a meaningful boundary, or supports real variants.
- Do not add a class, factory, interface, options bag, wrapper, or configurable
  switch merely to make the code look extensible.
- A one-use helper should expose intent or isolate a coherent operation; it
  should not just move one expression elsewhere.
- Prefer early returns, positive conditions, precise domain names, and one
  level of abstraction per function.
- Prefer explicit typed assignments over clever loops, dynamic keys,
  metaprogramming, or casts that hide the output shape.
- Do not make existing orchestration disappear into callers. Keep the workflow
  visible while moving independently changing policy or I/O behind its owner.
- Comments explain non-obvious intent, constraints, or tradeoffs. Delete
  comments that only restate the code.

## Keep contracts and units coherent

- Keep public interfaces small and capability-based. Avoid boolean positional
  arguments and invalid combinations of optional fields.
- Encapsulate invariants where they are enforced instead of repeating them in
  callers.
- Handle failures at a boundary that can recover or add useful context. Do not
  swallow errors or add catch-and-rethrow noise.
- Keep domain policy independent of storage, transport, UI, and process state.
- Split a file when the touched code contains distinct responsibilities with
  different reasons to change. Keep cohesive data and straight-line workflows
  together even when they are long.
- Treat roughly 40 lines per function and 200 lines per TypeScript module as
  review prompts, not pass/fail limits. Do not game them with dense expressions,
  passthrough helpers, or one-function files.
- Preserve established import paths and exports when compatibility requires
  it. Do not re-export a newly internal detail merely to avoid updating
  task-owned callers.

## Apply TypeScript discipline

- Name multi-field parameter and cast shapes near their owner. Do not leave
  anonymous object types in `as { ... }` casts.
- Cast at the point of use. Do not add a helper whose only job is one cast.
- Resolve non-trivial fallbacks before constructing a configuration object.
- Prefer plain typed objects. Do not use conditional object spreads solely to
  omit properties whose value may be `undefined`.
- Validate `unknown` once at the I/O boundary, infer the domain type from the
  schema when practical, and let typed internal functions trust that type.
- Reuse the repository's schema library, glob matcher, sanitizer, and
  required-value conventions instead of introducing parallel mechanisms.

When the task touches configuration, CLI arguments, archives, persisted JSON,
plans, or other untrusted input, read and apply
[the TypeScript boundary guide](references/typescript-boundaries.md).

## Apply React discipline

When the task touches React or JSX, read and apply
[the React quality guide](references/react.md) before editing or reviewing.
Its core contract is minimal state, pure rendering, Effects only for external
synchronization, accessible repository primitives, and composition before
boolean modes.

## Final evidence gate

Inspect every touched unit and answer:

- Is the requested behavior visible at the public seam and covered at the
  closest reliable boundary?
- Can a caller understand the contract without knowing private mechanics?
- Is each rule, fallback, transformation, and state value owned once?
- Did any helper, type, prop, effect, file, or layer add more structure than
  the behavior needs?
- Does each function, component, hook, and file have one coherent reason to
  change?
- Did cleanup alter behavior, broaden scope, or disturb user-owned work?
- Were repository-required checks run, with failures reported honestly?

If an answer reveals avoidable structure or unproven behavior, fix or report
it before declaring the task complete.

## Use the references selectively

- Read [examples.md](examples.md) when choosing between extraction and
  repetition, splitting a file, introducing a variant seam, or simplifying a
  configuration object. Examples illustrate judgment; they are not templates.
- Read [the TypeScript boundary guide](references/typescript-boundaries.md)
  only for untrusted-input and configuration boundaries.
- Read [the React quality guide](references/react.md) for every React or JSX
  change or review.
