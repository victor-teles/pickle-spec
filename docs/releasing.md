# Release validation

Pickle Spec ships six npm packages at one version. A release is compatible only
when all six package artifacts pass together:

| Package | Public install surface |
| --- | --- |
| `@pickle-spec/spec` | `@pickle-spec/spec` |
| `@pickle-spec/runner` | `@pickle-spec/runner`, `@pickle-spec/runner/benchmarking`, `@pickle-spec/runner/testing` |
| `@pickle-spec/web` | `@pickle-spec/web` |
| `@pickle-spec/mobile` | `@pickle-spec/mobile` |
| `@pickle-spec/studio` | Installed by the CLI for `pickle studio` |
| `@pickle-spec/cli` | The `pickle` executable |

The release workflow derives the version from a `v<major>.<minor>.<patch>` tag,
applies it to every package in the release job, validates each package artifact,
refreshes the lockfile so packed workspace dependencies use that version, and
publishes the packages in dependency order. It does not commit generated version
changes back to the repository.

Stable versions publish with the npm `latest` dist-tag. A prerelease uses its
lowercase leading identifier as the dist-tag (`v2.0.0-rc.1` uses `rc`). The
release rejects numeric, unsafe, overlong, or `latest` prerelease identifiers.

## Required gates

Run these gates from the repository root before creating the GitHub release:

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run release:check
bun run benchmark:replay
```

`bun run test` includes the public workspace seam from project initialization
through an immutable run archive and HTML result export. It also includes the
Studio browser seam and controlled web, Android, and iOS adapter conformance
tests. The required suite uses deterministic adapters and controlled benchmark
drivers. It does not require model credentials, a live application browser, an
Android Emulator, or an iOS Simulator.

`bun run release:check` verifies lockstep versions, exact package export maps,
the installed `pickle` executable, the Studio dependency, removal of the legacy
monolithic package, excluded test sources, and `bun pm pack` for every package.

## Provisioned smoke tests

Live smoke tests are evidence in addition to the required gates. Run only the
checks for which the environment is provisioned and record the operating
system, execution target, application revision, and Pickle Spec revision.

- Web: from `apps/example`, provide the configured model credential and local
  Chrome, then run `bun run smoke`.
- Android Emulator: follow the environment variables and command in
  [`packages/mobile/README.md`](../packages/mobile/README.md#real-emulator-smoke-test).
- iOS Simulator: follow the environment variables and command in
  [`packages/mobile/README.md`](../packages/mobile/README.md#real-ios-simulator-smoke-test).

The web Replay performance and fidelity gates are controlled required checks;
live web, Emulator, and Simulator measurements remain provisioned smoke
evidence.

## Release scope

This release is local-first. Specifications, configuration, credentials,
execution caches, test runs, and test artifacts remain on the user's machine or
CI runner unless the user explicitly exports them or an adapter sends redacted
data to its configured model provider.

This release does not include a Pickle Spec cloud service, synchronization,
hosted collaboration, hosted report storage, or physical-device provisioning.
Android Emulator and iOS Simulator installation, images, boot state, and test
applications belong to the local or CI environment.
