# iOS Simulator example

This example installs an iOS application in a booted Simulator, opens it, and
runs one deterministic onboarding Scenario through the mobile Node worker.
Studio shows the active device beside the step timeline while the run is live.

## Configure the app

Edit the `mobile.application` fields in `pickle.config.jsonc`:

- `application.id` with the app bundle identifier, such as
  `com.acme.checkout`.
- `application.binaryPath` with an absolute path to the built `.app` bundle.

Then edit `applicationRevision` in `pickle.config.jsonc` with a stable build or
commit identifier when you want successful runs to use Replay.

Edit `features/onboarding.feature` to match visible text in the app. The example
waits for `Welcome`, taps `Continue`, and verifies that `Home` is visible.

## Run the Scenario

The example requires macOS, Xcode Command Line Tools, Node 22.12 or newer, and
a booted iOS Simulator visible to `agent-device doctor`.

From the repository root:

```sh
bun install
bun run --cwd apps/ios-example check
bun run --cwd apps/ios-example run:ios
```

Open Studio instead when you want to watch the live device mirror:

```sh
bun run --cwd apps/ios-example studio
```

When more than one Simulator is booted, add its UDID as `targetId` in the
`createMobileAdapter` options in `pickle.extensions.ts`.
