import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { startWebRecording } from '../../../src/evidence/web-recording'

const jpegFrame = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAQABADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z',
    'base64',
  ),
)

type VideoStreamProbe = {
  pixelFormat: string
  colorRange?: string
  profile?: string
  width: number
  height: number
}

function videoStreamProbe(stream: unknown): VideoStreamProbe {
  if (!stream || typeof stream !== 'object') {
    throw new Error('ffprobe did not return a video stream')
  }
  const fields = stream as Record<string, unknown>
  if (
    typeof fields.pix_fmt !== 'string' ||
    typeof fields.width !== 'number' ||
    typeof fields.height !== 'number'
  ) {
    throw new Error('ffprobe did not return a video stream')
  }
  return {
    pixelFormat: fields.pix_fmt,
    width: fields.width,
    height: fields.height,
    colorRange:
      typeof fields.color_range === 'string' ? fields.color_range : undefined,
    profile: typeof fields.profile === 'string' ? fields.profile : undefined,
  }
}

async function jpegFrameAt(size: string): Promise<Uint8Array> {
  const ffmpeg = Bun.spawn(
    [
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=red:s=${size}`,
      '-frames:v',
      '1',
      '-f',
      'image2',
      'pipe:1',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const bytes = new Uint8Array(await new Response(ffmpeg.stdout).arrayBuffer())
  const code = await ffmpeg.exited
  if (code !== 0) {
    throw new Error((await new Response(ffmpeg.stderr).text()).trim())
  }
  return bytes
}

async function probeVideoStream(path: string): Promise<VideoStreamProbe> {
  const ffprobe = Bun.spawn(
    [
      'ffprobe',
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=pix_fmt,color_range,profile,width,height',
      '-of',
      'json',
      path,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const output = await new Response(ffprobe.stdout).text()
  const code = await ffprobe.exited
  if (code !== 0) {
    throw new Error((await new Response(ffprobe.stderr).text()).trim())
  }
  const parsed: unknown = JSON.parse(output)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('streams' in parsed) ||
    !Array.isArray(parsed.streams)
  ) {
    throw new Error('ffprobe did not return a video stream')
  }
  return videoStreamProbe(parsed.streams[0])
}

async function recordFrames(
  frames: Uint8Array,
  path: string,
): Promise<VideoStreamProbe> {
  const recording = await startWebRecording({
    path,
    captureFrame: async () => frames,
  })
  await recording.stop()
  return probeVideoStream(path)
}

test.skipIf(!Bun.which('ffmpeg') || !Bun.which('ffprobe'))(
  'encodes jpeg frames into a browser-safe mp4 recording',
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pickle-web-recording-'))
    const path = join(directory, 'scenario.mp4')
    try {
      const stream = await recordFrames(jpegFrame, path)
      const bytes = await Bun.file(path).arrayBuffer()
      expect(new TextDecoder().decode(bytes.slice(4, 8))).toBe('ftyp')
      expect(stream.pixelFormat).toBe('yuv420p')
      expect(stream.colorRange).toBe('tv')
      expect(stream.profile?.toLowerCase()).toContain('baseline')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test.skipIf(!Bun.which('ffmpeg') || !Bun.which('ffprobe'))(
  'scales odd jpeg frames to even yuv420p dimensions browsers can decode',
  { timeout: 15_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pickle-web-recording-'))
    const path = join(directory, 'scenario.mp4')
    try {
      const stream = await recordFrames(await jpegFrameAt('1281x721'), path)
      expect(stream.width % 2).toBe(0)
      expect(stream.height % 2).toBe(0)
      expect(stream.pixelFormat).toBe('yuv420p')
      expect(stream.colorRange).toBe('tv')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test.skipIf(!Bun.which('ffmpeg'))(
  'discards the encoder while a frame capture is still pending',
  { timeout: 5_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pickle-web-recording-'))
    const path = join(directory, 'scenario.mp4')
    const captureStarted = Promise.withResolvers<void>()
    const pendingFrame = Promise.withResolvers<Uint8Array>()
    const recording = await startWebRecording({
      path,
      async captureFrame() {
        captureStarted.resolve()
        return pendingFrame.promise
      },
    })
    try {
      await captureStarted.promise
      const discarding = recording.discard()
      const outcome = await Promise.race([
        discarding.then(() => 'discarded'),
        Bun.sleep(250).then(() => 'still-pending'),
      ])
      pendingFrame.resolve(jpegFrame)
      await discarding
      expect(outcome).toBe('discarded')
    } finally {
      pendingFrame.resolve(jpegFrame)
      await recording.discard()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
