import { requiredValue } from '../required-value'
export interface InteractiveTerminalSurface {
  activate?(): void
  columns(): number | undefined
  commit(lines: readonly string[]): void
  finish(lines: readonly string[]): void
  rows?(): number | undefined
  update(lines: readonly string[]): void
}

type InteractiveTerminalSurfaceOptions = {
  write(output: string): void
  columns(): number | undefined
  rows?(): number | undefined
}

type TerminalWrite = (...args: never[]) => unknown

type TerminalOutputStream = {
  columns?: number
  rows?: number
  write: TerminalWrite
}

type TerminalWriteCall = (...args: unknown[]) => unknown

type CapturedTerminalStream = {
  stream: TerminalOutputStream
  originalMethod: TerminalWrite
  write: TerminalWriteCall
}

const clearLine = '\r\u001b[2K'
const hideCursor = '\u001b[?25l'
const moveUp = '\u001b[1A'
const restoreTerminal = '\u001b[0m\u001b[?25h'
const reservedTerminalRows = 2

export function availableTerminalRows(rows: number | undefined): number {
  return rows
    ? Math.max(1, rows - reservedTerminalRows)
    : Number.POSITIVE_INFINITY
}

export function renderedTerminalRows(
  lines: readonly string[],
  columns: number | undefined,
): number {
  if (!columns) return lines.length
  return lines.reduce(
    (total, line) =>
      total + Math.max(1, Math.ceil(Bun.stringWidth(line) / columns)),
    0,
  )
}

export function createInteractiveTerminalSurface(
  options: InteractiveTerminalSurfaceOptions,
): InteractiveTerminalSurface {
  let renderedRowCount = 0

  function renderedRows(lines: readonly string[]): number {
    return renderedTerminalRows(lines, options.columns())
  }

  function hiddenLine(hiddenCount: number): string {
    const label = ` … +${hiddenCount}`
    const columns = options.columns()
    return columns && Bun.stringWidth(label) > columns ? '…' : label
  }

  function visibleTail(
    lines: readonly string[],
    maxRows: number,
  ): readonly string[] {
    const tail: string[] = []
    let usedRows = renderedRows([requiredValue(lines[0]), '…'])
    for (let index = lines.length - 1; index > 0; index--) {
      const line = requiredValue(lines[index])
      const lineRows = renderedRows([line])
      if (usedRows + lineRows > maxRows) break
      tail.unshift(line)
      usedRows += lineRows
    }
    return tail
  }

  function visibleDynamicLines(lines: readonly string[]): readonly string[] {
    const maxRows = availableTerminalRows(options.rows?.())
    if (renderedRows(lines) <= maxRows) return lines
    if (maxRows === 1) return ['…']
    const firstLine = requiredValue(lines[0])
    const tail = visibleTail(lines, maxRows)
    const hiddenCount = lines.length - tail.length - 1
    return [firstLine, hiddenLine(hiddenCount), ...tail]
  }

  function clearDynamicRegion(): void {
    if (renderedRowCount === 0) return
    let output = clearLine
    for (let index = 1; index < renderedRowCount; index++) {
      output += `${moveUp}${clearLine}`
    }
    options.write(output)
    renderedRowCount = 0
  }

  function writePermanent(lines: readonly string[]): void {
    clearDynamicRegion()
    if (lines.length > 0) options.write(`${lines.join('\n')}\n`)
  }

  return {
    columns: options.columns,
    commit: writePermanent,
    finish: writePermanent,
    update(lines) {
      clearDynamicRegion()
      if (lines.length === 0) return
      const visibleLines = visibleDynamicLines(lines)
      options.write(visibleLines.join('\n'))
      renderedRowCount = renderedRows(visibleLines)
    },
  }
}

function outputText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk
  if (ArrayBuffer.isView(chunk)) {
    return new TextDecoder().decode(
      new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
    )
  }
  return String(chunk)
}

function captureTerminalStreams(
  streams: readonly TerminalOutputStream[],
): CapturedTerminalStream[] {
  return streams.map((stream) => ({
    stream,
    originalMethod: stream.write,
    write: stream.write.bind(stream) as TerminalWriteCall,
  }))
}

export function createProcessTerminalSurface(
  stream: TerminalOutputStream,
  externalStreams: readonly TerminalOutputStream[] = [],
): InteractiveTerminalSurface {
  const capturedStreams = captureTerminalStreams([stream, ...externalStreams])
  const outputStream = requiredValue(capturedStreams[0])
  const surface = createInteractiveTerminalSurface({
    write: (output) => {
      outputStream.write(output)
    },
    columns: () => stream.columns,
    rows: () => stream.rows,
  })
  let active = false
  let externalLineOpen = false
  let dynamicLines: readonly string[] = []

  function restoreWrite(): void {
    if (!active) return
    for (const captured of capturedStreams) {
      captured.stream.write = captured.originalMethod
    }
    active = false
  }

  function finishExternalLine(): void {
    if (!externalLineOpen) return
    outputStream.write('\n')
    externalLineOpen = false
  }

  function interceptedWrite(captured: CapturedTerminalStream): TerminalWrite {
    return ((...args: unknown[]) => {
      surface.update([])
      const result = captured.write(...args)
      externalLineOpen = !outputText(args[0]).endsWith('\n')
      if (!externalLineOpen) surface.update(dynamicLines)
      return result
    }) as TerminalWrite
  }

  return {
    activate() {
      if (active) return
      active = true
      outputStream.write(hideCursor)
      for (const captured of capturedStreams) {
        captured.stream.write = interceptedWrite(captured)
      }
    },
    columns: surface.columns,
    rows: surface.rows,
    commit(lines) {
      finishExternalLine()
      dynamicLines = []
      surface.commit(lines)
    },
    finish(lines) {
      try {
        finishExternalLine()
        dynamicLines = []
        surface.finish(lines)
      } finally {
        restoreWrite()
        outputStream.write(restoreTerminal)
      }
    },
    update(lines) {
      dynamicLines = [...lines]
      if (!externalLineOpen) surface.update(lines)
    },
  }
}
