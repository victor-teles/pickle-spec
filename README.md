# pickle-spec

AI-powered Gherkin test runner. This repository is a Bun + Turborepo monorepo.

## Workspaces

| Path | Package | Description |
| --- | --- | --- |
| [`packages/pickle-spec`](./packages/pickle-spec) | `pickle-spec` | Published CLI and library |
| [`apps/example`](./apps/example) | `@pickle-spec/example` | Sample feature files |

Product documentation lives in [`packages/pickle-spec/README.md`](./packages/pickle-spec/README.md).

## Development

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run run:example
```

Turborepo runs `typecheck` and `test` across workspaces. Filter a single package with:

```bash
bunx turbo run test --filter=pickle-spec
```
