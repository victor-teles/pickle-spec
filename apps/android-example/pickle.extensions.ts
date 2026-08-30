import { createMobileAdapter } from '@pickle-spec/mobile'

export default {
  adapters: {
    mobile: createMobileAdapter({
      executionTarget: 'android-emulator',
      application: {
        id: 'com.android.settings',
        installed: true,
      },
      artifactDirectory: '.pickle/artifacts',
      artifacts: ['screenshot', 'device-log'],
    }),
  },
}
