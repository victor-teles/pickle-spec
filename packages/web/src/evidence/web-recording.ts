import type { TestArtifact } from '@pickle-spec/runner'
import type { FileSink } from 'bun'
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

function browserSafeRecordingArgs(path: string): string[] {
  return [
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
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'baseline',
    '-color_range',
    'tv',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-map_metadata',
    '-1',
    '-movflags',
    '+faststart',
    path,
  ]
}

async function writeRecordingFrame(
  stdin: FileSink,
  frame: Uint8Array,
): Promise<void> {
  const written = stdin.write(frame)
  if (typeof written !== 'number') await written
}

export async function startWebRecording(
  input: StartWebRecordingInput,
): Promise<WebRecording> {
  if (!Bun.which('ffmpeg')) {
    throw new Error('ffmpeg is required to capture a web recording')
  }
  const ffmpeg = Bun.spawn(browserSafeRecordingArgs(input.path), {
    stdin: 'pipe',
    stdout: 'ignore',
    stderr: 'pipe',
  })
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
      return
    }
  }

  async function writeFrameIfAvailable() {
    if (stopped) return
    const frame = await nextFrame()
    if (!frame || stopped) return
    await writeRecordingFrame(stdin, frame)
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
      if (frame) await writeRecordingFrame(stdin, frame)
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
      void writes.catch(() => {})
      stdin.end()
      ffmpeg.kill()
      await ffmpeg.exited
    },
  }
}
