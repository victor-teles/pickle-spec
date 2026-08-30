import { Writable } from 'node:stream'
import { expect, test } from 'vitest'
import { createTerminalProgress } from './progress'

function outputStream() {
  let output = ''
  const stream = new Writable({
    write(chunk, _encoding, done) {
      output += String(chunk)
      done()
    },
  })
  return { read: () => output, stream }
}

test('uses Ora for interactive progress', async () => {
  const output = outputStream()
  const progress = createTerminalProgress({
    color: true,
    enabled: true,
    stream: output.stream,
  })

  progress.start('Checking project files')
  progress.update('Checking configured environments')
  await Bun.sleep(100)
  progress.stop()

  expect(output.read()).toContain('Checking project files')
  expect(output.read()).toContain('Checking configured environments')
})

test('keeps Ora silent when terminal animation is unavailable', () => {
  const output = outputStream()
  const progress = createTerminalProgress({
    color: false,
    enabled: false,
    stream: output.stream,
  })

  progress.start('Checking project files')
  progress.update('Checking configured environments')
  progress.stop()

  expect(output.read()).toBe('')
})
