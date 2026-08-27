import type { TestArtifact } from '@pickle-spec/runner'
import { capturedWebArtifact } from './web-artifact'

export type WebRecording = {
  stop(): Promise<TestArtifact>
  discard(): Promise<void>
}

type StartWebRecordingInput = {
  captureFrame: () => Promise<Uint8Array>
  path: string
}

const frameIntervalMs = 500

export async function startWebRecording(
  input: StartWebRecordingInput,
): Promise<WebRecording> {
  if (!Bun.which('ffmpeg')) {
    throw new Error('ffmpeg is required to capture a web recording')
  }
  const ffmpeg = Bun.spawn(
    [
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-framerate',
      '2',
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      input.path,
    ],
    { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' },
  )
  if (!ffmpeg.stdin) {
    ffmpeg.kill()
    throw new Error('Recording encoder did not accept frame input')
  }
  let stopped = false
  const stdin = ffmpeg.stdin
  let writes = Promise.resolve()

  async function nextFrame() {
    try {
      return await input.captureFrame()
    } catch {
      return undefined
    }
  }

  async function writeFrameIfAvailable() {
    if (stopped) return
    const frame = await nextFrame()
    if (!frame || stopped) return
    stdin.write(frame)
  }

  function enqueueFrame() {
    writes = writes.then(writeFrameIfAvailable)
  }

  const timer = setInterval(enqueueFrame, frameIntervalMs)

  return {
    async stop() {
      if (stopped) {
        return capturedWebArtifact('recording', input.path, 'video/mp4')
      }
      stopped = true
      clearInterval(timer)
      await writes
      const frame = await nextFrame()
      if (frame) stdin.write(frame)
      stdin.end()
      const code = await ffmpeg.exited
      if (code !== 0) {
        const stderr = await new Response(ffmpeg.stderr).text()
        throw new Error(stderr.trim() || 'Recording encode failed')
      }
      return capturedWebArtifact('recording', input.path, 'video/mp4')
    },
    async discard() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      await writes
      ffmpeg.kill()
      await ffmpeg.exited
    },
  }
}
