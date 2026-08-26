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

  function visibleDynamicLines(lines: readonly string[]): readonly string[] {
    const maxRows = availableTerminalRows(options.rows?.())
    if (renderedRows(lines) <= maxRows) return lines
    if (maxRows === 1) return ['…']
    const firstLine = lines[0]!
    const visibleTail: string[] = []
    let usedRows = renderedRows([firstLine, '…'])
    for (let index = lines.length - 1; index > 0; index--) {
      const line = lines[index]!
      const lineRows = renderedRows([line])
      if (usedRows + lineRows > maxRows) break
      visibleTail.unshift(line)
      usedRows += lineRows
    }
    const hiddenCount = lines.length - visibleTail.length - 1
    const hiddenLabel = ` … +${hiddenCount}`
    const columns = options.columns()
    const hiddenLine = columns
      ? Bun.stringWidth(hiddenLabel) <= columns
        ? hiddenLabel
        : '…'
      : hiddenLabel
    return [firstLine, hiddenLine, ...visibleTail]
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

export function createProcessTerminalSurface(
  stream: TerminalOutputStream,
  externalStreams: readonly TerminalOutputStream[] = [],
): InteractiveTerminalSurface {
  const capturedStreams: CapturedTerminalStream[] = [
    stream,
    ...externalStreams,
  ].map((capturedStream) => ({
    stream: capturedStream,
    originalMethod: capturedStream.write,
    write: capturedStream.write.bind(capturedStream) as TerminalWriteCall,
  }))
  const outputStream = capturedStreams[0]!
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
