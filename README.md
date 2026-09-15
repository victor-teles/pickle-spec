<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/pickle-spec-mascot-banner-dark.webp">
  <source media="(prefers-color-scheme: light)" srcset="assets/brand/pickle-spec-mascot-banner.webp">
  <img alt="Pickle Spec mascot: an abstract green character waving." src="assets/brand/pickle-spec-mascot-banner.webp" width="1902" height="827">
</picture>

# Pickle Spec

Pickle Spec runs Gherkin Specifications against web and native applications. The web adapter uses Stagehand; the mobile adapter uses Agent Device for Android Emulators and iOS Simulators. Specifications, test runs, caches, and artifacts stay on your machine or CI runner by default.

## Get started

```bash
bun add --dev @pickle-spec/cli
bunx pickle init
```

Follow the [web quick start](apps/docs/content/docs/web/quick-start.mdx) or [native testing guide](apps/docs/content/docs/native/index.mdx) to configure a real target and add a meaningful assertion. Then open Studio:

```bash
bunx pickle studio
```

`pickle init` creates a configuration shell; it does not create a demonstration or claim a successful application test.

## Documentation

The Next.js + Fumadocs site lives in [apps/docs](apps/docs). To run it locally:

```bash
bun install --frozen-lockfile
bun run docs
```

Open [localhost:3000](http://localhost:3000). Build the production site with `bun run docs:build`.

- [Installation](apps/docs/content/docs/installation.mdx)
- [Web configuration](apps/docs/content/docs/web/configuration.mdx)
- [Gherkin syntax](apps/docs/content/docs/concepts/syntax.mdx)
- [Studio](apps/docs/content/docs/guides/studio.mdx)
- [Running Specifications](apps/docs/content/docs/guides/running-tests.mdx)
- [Adaptive execution and Replay](apps/docs/content/docs/guides/replay.mdx)
- [Test runs and exports](apps/docs/content/docs/guides/results.mdx)
- [Custom adapters](apps/docs/content/docs/extending/custom-adapters.mdx)
- [Development and releases](apps/docs/content/docs/contributing/development.mdx)
- [Package ownership](apps/docs/content/docs/contributing/packages.mdx)

See the [capability and release evidence inventory](docs/capability-status.md) for supported scope and revision-linked verification. Implemented behavior does not mean every target or the published npm package has been verified.
