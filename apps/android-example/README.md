# Android system app example

This example opens the Android Settings app already installed on a booted
Emulator and verifies that `Apps` is visible. No APK is required and the system
app is not reinstalled or modified.

Studio shows the active device beside the step timeline while the run is live.
The example uses `com.android.settings`, which is available on standard Android
Emulator system images and does not depend on Google Play services.

## Run the Scenario

The example requires Android SDK Platform Tools, Node 22.12 or newer, and a
booted Android Emulator visible to `agent-device doctor`.

From the repository root:

```sh
bun install
bun run --cwd apps/android-example check
bun run --cwd apps/android-example run:android
```

Open Studio instead when you want to watch the live device mirror:

```sh
bun run --cwd apps/android-example studio
```

When more than one Emulator is booted, add its serial as `targetId` in the
`createMobileAdapter` options in `pickle.extensions.ts`.
