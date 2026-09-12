# Studio

Paths below are relative to `packages/studio`.

## Architecture

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

Visual style is shadcn Mira on Base UI (`style: "base-mira"` in `components.json`).

Every UI control must be a shadcn Mira primitive (or compose those primitives). Do not hand-roll a styled `<button>`, `<a>`, `<span>`, table chrome, or layout block that duplicates a registry component. Wrapping `@base-ui/react` yourself is not a substitute for adding the shadcn primitive — Mira only applies when the component comes from the registry.

When adding a UI component or block not already available in `src/components/ui`:

1. Search the shadcn registry for an existing primitive (`search_items_in_registries` / `view_items_in_registries`, or `bunx shadcn@latest search <name>` from `packages/studio`).
2. If it exists, add it with `bunx shadcn@latest add <name>` from `packages/studio` so Mira is applied.
3. Extend the generated file in `src/components/ui` only when the product needs a domain variant (for example result-state chips). Do not fork a parallel component.

Product screens and their composed page components import primitives from `@/components/ui/*`. They do not invent a second button, badge, or control vocabulary.
