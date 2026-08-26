# Studio mobile smoke tests

The optional Studio smoke tests discover a provisioned mobile target, start a
Studio test run through the public HTTP surface, and require the resulting test
result to pass. They are skipped unless explicitly enabled.

For Android Emulator:

```sh
PICKLE_STUDIO_ANDROID_SMOKE=1 \
PICKLE_ANDROID_APP_ID=com.example.app \
PICKLE_ANDROID_APP_PATH=/absolute/path/to/app.apk \
PICKLE_ANDROID_SMOKE_STEP='the mobile behavior succeeds' \
bun test packages/cli/src/studio/studio-mobile.smoke.test.ts
```

For iOS Simulator:

```sh
PICKLE_STUDIO_IOS_SMOKE=1 \
PICKLE_IOS_APP_ID=com.example.app \
PICKLE_IOS_APP_PATH=/absolute/path/to/App.app \
PICKLE_IOS_SMOKE_STEP='the mobile behavior succeeds' \
bun test packages/cli/src/studio/studio-mobile.smoke.test.ts
```

Set `PICKLE_ANDROID_TARGET_ID` or `PICKLE_IOS_TARGET_ID` to require a specific
booted target. Set `PICKLE_NODE_PATH` when the Node 22.12+ executable is not
available as `node`.
