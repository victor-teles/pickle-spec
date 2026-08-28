import { requiredValue } from '../required-value'

function sourceLines(source: string): string[] {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return source.split(newline)
}

function longestCommonSubsequence(
  fromLines: readonly string[],
  toLines: readonly string[],
): number[][] {
  const matrix = Array.from({ length: fromLines.length + 1 }, () =>
    Array.from({ length: toLines.length + 1 }, () => 0),
  )
  for (let fromIndex = fromLines.length - 1; fromIndex >= 0; fromIndex--) {
    for (let toIndex = toLines.length - 1; toIndex >= 0; toIndex--) {
      requiredValue(matrix[fromIndex])[toIndex] =
        fromLines[fromIndex] === toLines[toIndex]
          ? (requiredValue(matrix[fromIndex + 1])[toIndex + 1] ?? 0) + 1
          : Math.max(
              requiredValue(matrix[fromIndex + 1])[toIndex] ?? 0,
              requiredValue(matrix[fromIndex])[toIndex + 1] ?? 0,
            )
    }
  }
  return matrix
}

function appendChangedLine(
  lines: string[],
  fromLines: readonly string[],
  toLines: readonly string[],
  matrix: readonly (readonly number[])[],
  fromIndex: number,
  toIndex: number,
): 'from' | 'to' {
  const removalKeeps = matrix[fromIndex + 1]?.[toIndex] ?? 0
  const additionKeeps = matrix[fromIndex]?.[toIndex + 1] ?? 0
  if (removalKeeps >= additionKeeps) {
    lines.push(`-${requiredValue(fromLines[fromIndex])}`)
    return 'from'
  }
  lines.push(`+${requiredValue(toLines[toIndex])}`)
  return 'to'
}

export function specificationSourceDiff(from: string, to: string): string {
  if (from === to) return ''
  const fromLines = sourceLines(from)
  const toLines = sourceLines(to)
  const lines: string[] = ['--- current', '+++ proposed']
  const matrix = longestCommonSubsequence(fromLines, toLines)
  let fromIndex = 0
  let toIndex = 0

  while (fromIndex < fromLines.length && toIndex < toLines.length) {
    if (fromLines[fromIndex] === toLines[toIndex]) {
      fromIndex++
      toIndex++
      continue
    }
    const changed = appendChangedLine(
      lines,
      fromLines,
      toLines,
      matrix,
      fromIndex,
      toIndex,
    )
    if (changed === 'from') fromIndex++
    else toIndex++
  }
  while (fromIndex < fromLines.length)
    lines.push(`-${requiredValue(fromLines[fromIndex++])}`)
  while (toIndex < toLines.length)
    lines.push(`+${requiredValue(toLines[toIndex++])}`)
  return `${lines.join('\n')}\n`
}
