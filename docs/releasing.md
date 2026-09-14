# Release validation

The compatible release set contains seven npm packages at one version. A
release is compatible only when all seven package artifacts pass together:

| Package                      | Public install surface                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@pickle-spec/configuration` | `@pickle-spec/configuration`                                                                                            |
| `@pickle-spec/spec`          | `@pickle-spec/spec`, `@pickle-spec/spec/schemas`                                                                        |
| `@pickle-spec/runner`        | `@pickle-spec/runner`, `@pickle-spec/runner/benchmarking`, `@pickle-spec/runner/schemas`, `@pickle-spec/runner/testing` |
| `@pickle-spec/web`           | `@pickle-spec/web`                                                                                                      |
| `@pickle-spec/mobile`        | `@pickle-spec/mobile`                                                                                                   |
| `@pickle-spec/studio`        | Installed by the CLI for `pickle studio`                                                                                |
| `@pickle-spec/cli`           | The `pickle` executable                                                                                                 |

The release preparation script derives the version from a
`v<major>.<minor>.<patch>` tag, applies it to all seven packages, and refreshes
the lockfile so packed workspace dependencies use that version. Validation
checks each package artifact. Generated version changes are not committed back
to the repository.

The [publish workflow](../.github/workflows/publish.yml) publishes
`configuration spec runner web mobile studio cli` in dependency order.
Release acceptance tests compare this order with the
[release package definitions](../scripts/release-packages.ts). A failed check
stops the job before publication.

Stable versions publish with the npm `latest` dist-tag. A prerelease uses its
lowercase leading identifier as the dist-tag (`v2.0.0-rc.1` uses `rc`). The
release rejects numeric, unsafe, overlong, or `latest` prerelease identifiers.

## Required gates

The supported release runtime is Bun 1.4.2, pinned by the root
`packageManager` field and used by both CI and the publish workflow. Run these
gates from the repository root with that exact version before creating the
GitHub release:

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run test:integration
bun run test:e2e
bun run release:check
bun run release:install-check
bun run benchmark:replay
```

`bun run test` runs script tests and package unit suites, including controlled
web/mobile adapter conformance and Studio static-rendering tests. Turbo may
reuse cached results. It does not run the CLI integration or Studio browser
E2E suites and does not require model credentials or live execution targets.

The [CI workflow](../.github/workflows/ci.yml) runs `bun run test:integration`
and `bun run test:e2e` in a separate job. These cover CLI workflows and the
rendered Studio browser seam. Provisioned mobile smoke tests are opt-in and
skip without their environment flags; a green E2E job does not certify a real
Android Emulator or iOS Simulator run. CI currently uses Ubuntu runners and
does not provision an iOS Simulator.

The publish workflow runs integration and E2E on the checked-out release
revision before publishing. Either command failing stops publication. These
checks exercise controlled CLI and Studio workflows; provisioned target smoke
tests and installation of the exact published version remain separate evidence.

`bun run release:check` verifies lockstep versions, exact package export maps,
the installed `pickle` executable, the Studio dependency, removal of the legacy
monolithic package, excluded test sources, and `bun pm pack` for every package.
It also verifies the repository's MIT license and each package's description,
license, homepage, source directory, and supported Bun version.

`bun run release:install-check` packs all seven packages and installs the
artifacts in a clean temporary project. It imports every public entry point,
runs the installed CLI, starts the packaged Studio build, and requests its HTML.
It also imports a schema-version 2 run archive, exports it with the current
package set, and imports that archive into a second isolated project. The
prepublication project uses local tarball overrides because internal package
dependencies already refer to the final lockstep version.

## Previous-version recovery

Do not unpublish a broken version. Move the affected dist-tag to the last known
good version, then verify that exact version in a clean project. For example:

```sh
npm dist-tag add @pickle-spec/configuration@<previous-version> latest
npm dist-tag add @pickle-spec/spec@<previous-version> latest
npm dist-tag add @pickle-spec/runner@<previous-version> latest
npm dist-tag add @pickle-spec/web@<previous-version> latest
npm dist-tag add @pickle-spec/mobile@<previous-version> latest
npm dist-tag add @pickle-spec/studio@<previous-version> latest
npm dist-tag add @pickle-spec/cli@<previous-version> latest

mkdir pickle-recovery-check && cd pickle-recovery-check
bun init -y
bun add --exact @pickle-spec/cli@<previous-version>
bunx pickle --version
bunx pickle import /path/to/run.archive.json
bunx pickle studio --no-open
```

Move all seven package tags as one operation. If one command fails, stop broad
distribution and finish the set before announcing recovery. Existing projects
can pin `@pickle-spec/cli` to the previous version and run `bun install`.
Run archives remain immutable during import. Keep the source archive until the
recovered Studio displays the imported run.

## Provisioned smoke tests

The [capability and release evidence inventory](capability-status.md) records
the audited revision, supported task scope, checks actually run, and remaining
verification gaps. An implementation checkbox or this procedure alone is not
release evidence. Package packing does not verify npm publication or installation
of the exact public version.

Live smoke tests are evidence in addition to the required gates. Run only the
checks for which the environment is provisioned and record the operating
system, execution target, application revision, and Pickle Spec revision.

- Web: from `apps/example`, provide the configured model credential and local
  Chrome, then run `bun run smoke`.
- Android Emulator: follow the environment variables and command in
  [`packages/mobile/README.md`](../packages/mobile/README.md#real-emulator-smoke-test).
- iOS Simulator: follow the environment variables and command in
  [`packages/mobile/README.md`](../packages/mobile/README.md#real-ios-simulator-smoke-test).

Attached CDP and Browserbase have connection implementations and controlled
tests, but no dedicated live smoke recipe in this policy. Roadmap gate L3 owns their
provisioned acceptance evidence. A local web smoke does not certify either.
`pickle doctor` checks CDP URL syntax and Browserbase configuration without
testing remote connectivity or successful model authentication.

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
