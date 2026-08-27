import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startWebRecording } from './web-recording'

const jpegFrame = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAQABADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z',
    'base64',
  ),
)

test.skipIf(!Bun.which('ffmpeg'))(
  'encodes jpeg frames into a real mp4 recording',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pickle-web-recording-'))
    const path = join(directory, 'scenario.mp4')
    try {
      const recording = await startWebRecording({
        path,
        captureFrame: async () => jpegFrame,
      })
      const artifact = await recording.stop()
      const bytes = await Bun.file(path).arrayBuffer()
      expect(artifact).toMatchObject({
        kind: 'recording',
        path,
        mediaType: 'video/mp4',
        name: 'scenario.mp4',
      })
      expect(bytes.byteLength).toBeGreaterThan(0)
      expect(new TextDecoder().decode(bytes.slice(4, 8))).toBe('ftyp')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  { timeout: 15_000 },
)
