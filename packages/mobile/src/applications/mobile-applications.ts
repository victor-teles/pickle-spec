import { createNodeWorkerClient } from '../worker/worker-client'
import {
  type MobileApplicationScope,
  type MobilePlatform,
  mobileWorkerProtocolVersion,
} from '../worker/worker-protocol'

export interface ListMobileApplicationsInput {
  platform: MobilePlatform
  scope?: MobileApplicationScope
  signal?: AbortSignal
}

export async function listMobileApplications(
  input: ListMobileApplicationsInput,
): Promise<string[]> {
  const worker = createNodeWorkerClient()
  try {
    const response = await worker.request(
      {
        version: mobileWorkerProtocolVersion,
        type: 'list-applications',
        platform: input.platform,
        scope: input.scope ?? 'user-installed',
      },
      input.signal,
    )
    if (response.type !== 'applications-listed') {
      throw new Error(`Unexpected mobile worker response: ${response.type}`)
    }
    return response.applicationIds
  } finally {
    await worker.dispose()
  }
}
