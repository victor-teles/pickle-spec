# `@pickle-spec/mobile`

The mobile adapter runs Android Emulator and iOS Simulator scenarios through a
versioned Node worker. The Bun runner remains runtime-independent, and
`agent-device` types stay inside the worker.

## Real-emulator smoke test

The smoke test is optional and skipped by default. It requires:

- Node 22.12 or newer on `PATH`, or an absolute `PICKLE_NODE_PATH`;
- the Android SDK and `adb` on `PATH`;
- a booted Android Emulator visible to `agent-device doctor`;
- an installable `.apk` or `.aab` and its Android application ID;
- visible text that the installed application should show after launch.

Run it from the repository root:

```sh
PICKLE_ANDROID_SMOKE=1 \
PICKLE_ANDROID_APP_ID=com.example.checkout \
PICKLE_ANDROID_APP_PATH=/absolute/path/to/checkout.apk \
PICKLE_ANDROID_SMOKE_STEP='Checkout' \
bun run --cwd packages/mobile test -- src/adapter/android-emulator.smoke.test.ts
```

Set `PICKLE_ANDROID_TARGET_ID=emulator-5554` when more than one emulator is
booted. The adapter uses `agent-device reinstall` semantics before every
logical session, so the selected application's existing emulator data is
deleted and the configured binary is installed fresh.

## Real iOS Simulator smoke test

The iOS smoke test is also optional and skipped by default. It requires:

- macOS with Xcode and Xcode Command Line Tools installed;
- Node 22.12 or newer on `PATH`, or an absolute `PICKLE_NODE_PATH`;
- a booted iOS Simulator visible to `agent-device doctor`;
- an installable `.app` or `.ipa` and its bundle identifier;
- visible text that the installed application should show after launch.

Run it from the repository root:

```sh
PICKLE_IOS_SMOKE=1 \
PICKLE_IOS_APP_ID=com.example.checkout \
PICKLE_IOS_APP_PATH=/absolute/path/to/Checkout.app \
PICKLE_IOS_SMOKE_STEP='Checkout' \
bun run --cwd packages/mobile test -- src/adapter/ios-simulator.smoke.test.ts
```

Set `PICKLE_IOS_TARGET_ID` to a Simulator UDID when more than one compatible
Simulator is booted. The adapter reinstalls and verifies the configured bundle
for every logical session. Physical-device provisioning remains outside this
release.

## Test evidence and redaction

Set `artifactDirectory` and choose the evidence kinds to capture with
`artifacts`: `screenshot`, `device-log`, `recording`, or `trace`. The adapter
checks the selected Simulator or Emulator capabilities before installation and
rejects unsupported evidence or Scenario capability requirements.

Text logs can be redacted before Pickle Spec persists them:

```ts
createMobileAdapter({
  executionTarget: 'ios-simulator',
  application: {
    id: 'com.example.checkout',
    binaryPath: '/absolute/path/to/Checkout.app',
  },
  artifactDirectory: '/absolute/path/to/test-artifacts',
  artifacts: ['device-log'],
  redactions: [
    { match: 'secret-value' },
    { match: 'customer@example.com', replacement: '[EMAIL]' },
  ],
})
```

Redaction matches literal text and defaults the replacement to `[REDACTED]`.
Screenshots, recordings, and traces are binary and cannot use text redaction;
the adapter rejects a session that combines those evidence kinds with text
redaction rules. Binary evidence stays local in the explicitly configured
artifact directory.
