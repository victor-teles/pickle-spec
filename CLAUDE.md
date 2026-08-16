This repository is a Bun + Turborepo monorepo:

- `packages/spec` — Specification parsing and selection
- `packages/runner` — scheduling, run events, and test results
- `packages/web` — Stagehand execution-target adapter
- `packages/cli` — executable package composition
- `packages/studio` — local Studio UI
- `apps/example` — sample Specifications

Use `bun run lint`, `bun run typecheck`, and `bun run test` from the repo root. Typecheck and test run through Turborepo. Lint and format use Biome from the repo root.

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
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

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

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

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

## Studio UI

Studio lives in `packages/studio`. Visual style is shadcn Mira on Base UI (`style: "base-mira"` in `packages/studio/components.json`).

Every UI control must be a shadcn Mira primitive (or compose those primitives). Do not hand-roll a styled `<button>`, `<a>`, `<span>`, table chrome, or layout block that duplicates a registry component. Wrapping `@base-ui/react` yourself is not a substitute for adding the shadcn primitive — Mira only applies when the component comes from the registry.

Before creating a new component or block:

1. Search the shadcn registry for an existing primitive (`search_items_in_registries` / `view_items_in_registries`, or `bunx shadcn@latest search <name>` from `packages/studio`).
2. If it exists, add it with `bunx shadcn@latest add <name>` from `packages/studio` so Mira is applied.
3. Extend the generated file in `packages/studio/src/components/ui` only when the product needs a domain variant (for example result-state chips). Do not fork a parallel component.

Product screens in `frontend.tsx` import from `./components/ui/*`. They do not invent a second button, badge, or control vocabulary.

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `victor-teles/pickle-spec`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five default canonical labels. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses the single-context layout. See `docs/agents/domain.md`.

### Coding standards

Use 10x-coder skills to always apply code best practices
