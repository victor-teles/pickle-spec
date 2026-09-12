This repository is a Bun + Turborepo monorepo:

- `packages/spec` — Specification parsing and selection
- `packages/runner` — scheduling, run events, and test results
- `packages/web` — Stagehand execution-target adapter
- `packages/mobile` — Android execution-target adapter and Node worker
- `packages/cli` — executable package composition
- `packages/studio` — local Studio UI
- `apps/example` — sample Specifications
- `apps/docs` — Next.js + Fumadocs documentation site

Root checks are `bun run lint`, `bun run typecheck`, and `bun run test`.
Typecheck and package tests run through Turborepo; the test script also runs
script tests and a Vitest migration check. Use package test scripts for focused
runs so their Vitest runner flags and build prerequisites are preserved.

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bunx --bun vitest run` instead of `bun test`, `jest`, or plain `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Bun APIs

For Bun runtime code:

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

For Bun API details, consult `node_modules/bun-types/docs/**.mdx` when available.

## Lint and format

Use the root scripts: `bun run lint` checks with Oxlint and Oxfmt;
`bun run format` applies their fixes. Configuration lives in `.oxlintrc.json`
and `.oxfmtrc.jsonc`. Do not add a parallel ESLint or Prettier setup.
After changing TypeScript or JSON files, run `bun run lint` before finishing.

Name variables in camelCase. Do not declare `SCREAMING_SNAKE_CASE` constants.
Object keys may use CONSTANT_CASE when matching external names such as
environment variables.

## TypeScript

When casting to a shape that library types do not expose, declare a named
`type` near the top of the file. Do not inline anonymous object types in
`as { ... }` casts. Cast at the point of use (`value as MyType`); do not add
a one-line helper whose only job is wrapping that cast.

## Contextual guidance

- For Studio architecture and UI, use [packages/studio/AGENTS.md](packages/studio/AGENTS.md).
  This also applies when changing CLI integration with Studio: the CLI owns
  process lifecycle and injects project gateways.
- For documentation-site framework work, use [apps/docs/AGENTS.md](apps/docs/AGENTS.md).
- For complex refactors or code-quality reviews, consult the local
  [10x-coder skill](.agents/skills/10x-coder/SKILL.md). It is not a prerequisite
  for every edit; use its boundary and React references when those concerns apply.

## Decision boundaries and completion

Local implementation, refactoring, and validation within the requested scope
can proceed without approval between steps. Continue through relevant checks
and fixing issues introduced by the change until the requested behavior works,
or a decision requiring user input blocks progress. Report exact checks and
results, including any unverified runtime behavior or environmental blockers.

If the task has not already authorized it, get approval before:

- Materially expanding scope or changing a public API, compatibility contract,
  schema, storage format, or wire format.
- Adding a dependency, framework, service, or new test infrastructure. Adding
  registry primitives required by an authorized Studio UI task follows the
  scoped Studio guidance.
- Deleting or overwriting user data, discarding uncommitted work, rewriting
  history, or running irreversible migrations.
- Production changes, publishing, or other external side effects.

Keep parallel implementations only when compatibility or migration is part of
the requested scope; routine internal refactors do not need separate approval.
