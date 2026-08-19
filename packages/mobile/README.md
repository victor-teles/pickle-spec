# `@pickle-spec/mobile`

The mobile adapter runs Android Emulator scenarios through a versioned Node
worker. The Bun runner remains runtime-independent, and `agent-device` types
stay inside the worker.

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
bun test packages/mobile/src/android-emulator.smoke.test.ts
```

Set `PICKLE_ANDROID_TARGET_ID=emulator-5554` when more than one emulator is
booted. The adapter uses `agent-device reinstall` semantics before every
logical session, so the selected application's existing emulator data is
deleted and the configured binary is installed fresh.
