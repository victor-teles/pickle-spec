This repository is a Bun + Turborepo monorepo:

- `packages/spec` — Specification parsing and selection
- `packages/runner` — scheduling, run events, and test results
- `packages/web` — Stagehand execution-target adapter
- `packages/mobile` — Android execution-target adapter and Node worker
- `packages/cli` — executable package composition
- `packages/studio` — local Studio UI
- `apps/example` — sample Specifications

Use `bun run lint`, `bun run typecheck`, and `bun run test` from the repo root. Typecheck and test run through Turborepo. Lint and format use Biome from the repo root.

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bunx --bun vitest run` instead of `bun test`, `jest`, or plain `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use Vitest through Bun to run tests.

```ts#index.test.ts
import { test, expect } from "vitest";

test("hello world", () => {
 expect(1).toBe(1);
});
```

## Lint and format

Use Biome from the repo root. Do not add ESLint or Prettier.

```sh
bun run lint
bun run format
```

`bun run lint` checks formatting, import order, and lint rules. `bun run format` applies safe fixes. Configuration lives in `biome.json`.

Write new TypeScript with 2-space indent, single quotes, and semicolons only when needed. Name variables in camelCase. Do not declare `SCREAMING_SNAKE_CASE` constants. Object keys may use CONSTANT_CASE when they match external names such as environment variables.

## TypeScript

When casting to a shape that library types do not expose, declare a named `type` near the top of the file. Do not inline anonymous object types in `as { ... }` casts.

Cast at the point of use (`value as MyType`). Do not add a one-line helper whose only job is wrapping that cast.

After you change TypeScript or JSON files, run `bun run lint` before you finish.

## Frontend

Studio uses TanStack Start with Rsbuild. Use file routes for pages, typed server
functions for same-origin application RPC, and server routes for raw HTTP or
external contracts such as downloads. Keep route and server-function modules
thin. Put transport-free behavior in focused services.

Organize Studio application code by feature under `src/features/<feature>`.
Colocate each feature's contracts, server functions, HTTP routes, and focused
server-side behavior. Keep `src/server` limited to transport, security,
composition, and lifecycle concerns; do not create cross-feature API or
server-function grab bags.

Keep TanStack route files composition-only. React pages, feature-specific
components, hooks, models, tests, and server modules belong to their owning
feature. Keep only proven cross-feature primitives and infrastructure in
`src/components`, `src/hooks`, and `src/lib`; do not recreate flat `app`,
`runs`, `settings`, or page-specific shared folders.

The CLI still owns Studio process lifecycle and injects project gateways. The
embedded srvx host is limited to binding, security headers, static assets, and
WebSocket upgrades. Do not add application routing back to a `Bun.serve`
callback.

## Studio UI

Studio lives in `packages/studio`. Visual style is shadcn Mira on Base UI (`style: "base-mira"` in `packages/studio/components.json`).

Every UI control must be a shadcn Mira primitive (or compose those primitives). Do not hand-roll a styled `<button>`, `<a>`, `<span>`, table chrome, or layout block that duplicates a registry component. Wrapping `@base-ui/react` yourself is not a substitute for adding the shadcn primitive — Mira only applies when the component comes from the registry.

Before creating a new component or block:

1. Search the shadcn registry for an existing primitive (`search_items_in_registries` / `view_items_in_registries`, or `bunx shadcn@latest search <name>` from `packages/studio`).
2. If it exists, add it with `bunx shadcn@latest add <name>` from `packages/studio` so Mira is applied.
3. Extend the generated file in `packages/studio/src/components/ui` only when the product needs a domain variant (for example result-state chips). Do not fork a parallel component.

Product screens under `src/routes` and their composed page components import from `./components/ui/*`. They do not invent a second button, badge, or control vocabulary.

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Coding standards

Use the local `10x-coder` skill before writing or reviewing code. Apply its
final evidence gate before reporting the task complete.

## Before editing

- Read the relevant code, tests, and configuration directly. Do not work from search snippets or guesses.
- If the requirement is ambiguous or the premise is unverified, resolve that before building on it.
- State a minimal plan:
  - **Outcome** — the exact behavior requested
  - **Non-goals** — what this task will not do
  - **Files** — the smallest set expected to change
  - **Proof** — the check that will prove the change works
- Start with one implementation path. Split work only when the task has genuinely independent parts.

## While editing

- Reuse existing code, helpers, patterns, and test setup before adding anything new.
- Fix bugs at the root cause. Do not stack patches around a wrong premise.
- Add an abstraction, adapter, or config layer only for a second real caller in this task or a stated requirement.
- Preserve behavior outside the requested change.
- Do not design for rare or future cases nobody asked about.
- Remove code you replace. Keep an old path only when compatibility is an explicit requirement.

## Pause and confirm

Read-only discovery is always allowed. If the task has not already authorized it, get approval before:

- Materially expanding the scope or touching unrelated files
- Adding a dependency, framework, service, or new test infrastructure
- Changing a public API, schema, storage format, or wire format
- Deleting or overwriting user data, discarding uncommitted work, rewriting history, or dropping data
- Keeping two implementations of the same behavior alive

## Testing

- Run the narrowest existing tests that exercise the changed behavior.
- Extend the most relevant existing test before creating a new test file.
- Add a test only when changed user-observable behavior is not covered, or when the user asks for one.
- Each new test must protect a clear acceptance criterion or regression risk.
- Do not backfill unrelated coverage or introduce test infrastructure for one task alone.
- Do not use passing tests as justification for extra abstractions or scope.

## If the plan grows

Stop when the work starts adding future-use layers, workaround stacks,
unrelated cleanup, or tests for unstated behavior. Rewrite a smaller plan
and confirm the new scope.

## Done means

- The requested behavior works and the acceptance criteria are met
- Relevant checks pass, with the exact commands and results reported
- Every touched file is necessary and the diff contains nothing unrelated
- No debug code, backup copies, dead paths, or scratch files remain
- Assumptions, limitations, and unverified runtime behavior are stated plainly