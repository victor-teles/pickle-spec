export type StudioLiveViewportTarget = {
  scenarioId: string
  examplesRowId?: string
  profileId: string
  attempt?: number
}

export type StudioLiveViewport =
  | {
      kind: 'frame'
      data: string
      mimeType: 'image/jpeg'
      width?: number
      height?: number
    }
  | {
      kind: 'device-frame'
      data: string
      mimeType: 'image/png'
      width?: number
      height?: number
    }
  | { kind: 'browserbase'; sessionId: string; url: string }

export type StudioLiveViewportEvent =
  | {
      type: 'viewport-updated'
      target: StudioLiveViewportTarget
      viewport: StudioLiveViewport
    }
  | {
      type: 'viewport-closed'
      target: StudioLiveViewportTarget
    }

export function liveViewportTargetKey(
  target: StudioLiveViewportTarget,
): string {
  return JSON.stringify([
    target.scenarioId,
    target.examplesRowId ?? null,
    target.profileId,
    target.attempt ?? null,
  ])
}
