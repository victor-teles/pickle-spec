import { expect, test } from 'bun:test'
import {
  createInteractiveTerminalSurface,
  createProcessTerminalSurface,
} from './terminal-surface'

test('replaces only its dynamic region before commits and finish output', () => {
  const output: string[] = []
  const surface = createInteractiveTerminalSurface({
    write: (chunk) => output.push(chunk),
    columns: () => 80,
  })

  surface.update(['first frame', 'second line'])
  surface.update(['replacement'])
  surface.commit(['stable block'])
  surface.update(['last frame'])
  surface.finish(['summary'])

  expect(output).toEqual([
    'first frame\nsecond line',
    '\r\u001b[2K\u001b[1A\r\u001b[2K',
    'replacement',
    '\r\u001b[2K',
    'stable block\n',
    'last frame',
    '\r\u001b[2K',
    'summary\n',
  ])
})

test('bounds the dynamic region to the terminal height', () => {
  const output: string[] = []
  const surface = createInteractiveTerminalSurface({
    write: (chunk) => output.push(chunk),
    columns: () => 80,
    rows: () => 8,
  })

  surface.update(Array.from({ length: 20 }, (_, index) => `line ${index}`))

  const frame = output[0]!.split('\n')
  expect(frame.length).toBeLessThanOrEqual(6)
  expect(frame[0]).toBe('line 0')
  expect(frame.join('\n')).toContain('…')
  expect(frame.at(-1)).toBe('line 19')
})

test('keeps its overflow marker within narrow terminal columns', () => {
  const output: string[] = []
  const surface = createInteractiveTerminalSurface({
    write: (chunk) => output.push(chunk),
    columns: () => 3,
    rows: () => 5,
  })

  surface.update(Array.from({ length: 20 }, (_, index) => `line ${index}`))

  expect(Bun.stringWidth(output[0]!.split('\n')[1]!)).toBeLessThanOrEqual(3)
  expect(output[0]!.split('\n')[1]).toBe('…')
})

test('counts physical rows when a logical line wraps in narrow columns', () => {
  const output: string[] = []
  const surface = createInteractiveTerminalSurface({
    write: (chunk) => output.push(chunk),
    columns: () => 3,
    rows: () => 8,
  })

  surface.update([' ◐ a'])
  surface.update(['x'])

  expect(output[1]).toBe('\r\u001b[2K\u001b[1A\r\u001b[2K')
})

test('moves unrelated process output above the live region without erasing it', () => {
  const output: string[] = []
  const stream = {
    columns: 80,
    rows: 24,
    write(chunk: string) {
      output.push(chunk)
      return true
    },
  }
  const errorStream = {
    write(chunk: string) {
      output.push(chunk)
      return true
    },
  }
  const originalWrite = stream.write
  const originalErrorWrite = errorStream.write
  const surface = createProcessTerminalSurface(stream, [errorStream])

  surface.activate?.()
  surface.update(['live progress'])
  errorStream.write('adapter log\n')
  surface.finish(['summary'])

  expect(output).toEqual([
    '\u001b[?25l',
    'live progress',
    '\r\u001b[2K',
    'adapter log\n',
    'live progress',
    '\r\u001b[2K',
    'summary\n',
    '\u001b[0m\u001b[?25h',
  ])
  expect(stream.write('after finish\n')).toBe(true)
  expect(output.at(-1)).toBe('after finish\n')
  expect(stream.write).toBe(originalWrite)
  expect(errorStream.write).toBe(originalErrorWrite)
})

test('restores process streams and terminal state when final rendering throws', () => {
  const output: string[] = []
  const stream = {
    columns: 80,
    write(chunk: string) {
      output.push(chunk)
      if (chunk === 'summary\n') throw new Error('terminal write failed')
      return true
    },
  }
  const originalWrite = stream.write
  const surface = createProcessTerminalSurface(stream)

  surface.activate?.()

  expect(() => surface.finish(['summary'])).toThrow('terminal write failed')
  expect(stream.write).toBe(originalWrite)
  expect(output.at(-1)).toBe('\u001b[0m\u001b[?25h')
})
