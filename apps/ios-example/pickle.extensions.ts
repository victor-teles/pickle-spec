import { createMobileAdapter } from '@pickle-spec/mobile'

export default {
  adapters: {
    mobile: createMobileAdapter({
      executionTarget: 'ios-simulator',
      application: {
        id: 'com.example.app',
        binaryPath: '/absolute/path/to/YourApp.app',
      },
      artifactDirectory: '.pickle/artifacts',
      artifacts: ['screenshot', 'device-log'],
    }),
  },
}
