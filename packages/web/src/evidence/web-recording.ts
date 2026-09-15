import type { TestArtifact } from '@pickle-spec/runner'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import type { Writable } from 'node:stream'
import { text } from 'node:stream/consumers'
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
  stdin: Writable,
  frame: Uint8Array,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stdin.write(frame, (error) => (error ? reject(error) : resolve()))
  })
}

export async function startWebRecording(
  input: StartWebRecordingInput,
): Promise<WebRecording> {
  const args = browserSafeRecordingArgs(input.path)
  const ffmpeg = spawn(args[0] ?? '', args.slice(1), {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  const exited = new Promise<number>((resolve) => {
    ffmpeg.once('close', (code) => resolve(code ?? 1))
  })
  const stderr = text(ffmpeg.stderr)
  try {
    await once(ffmpeg, 'spawn')
  } catch (cause) {
    throw new Error('ffmpeg is required to capture a web recording', { cause })
  }
  if (!ffmpeg.stdin) {
    ffmpeg.kill()
    throw new Error('Recording encoder did not accept frame input')
  }
  let stopped = false
  const stdin = ffmpeg.stdin
  stdin.on('error', () => {})
  let writes = Promise.resolve()

  async function nextFrame(): Promise<Uint8Array | undefined> {
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
      void stdin.end()
      const code = await exited
      if (code !== 0) {
        throw new Error((await stderr).trim() || 'Recording encode failed')
      }
      return capturedWebArtifact('recording', input.path, 'video/mp4')
    },
    async discard() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      void writes.catch(() => {})
      void stdin.end()
      ffmpeg.kill()
      await exited
    },
  }
}
