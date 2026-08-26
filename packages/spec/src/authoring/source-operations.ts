export type SourceLocation = { line?: number; column?: number }

export type Replacement = { start: number; end: number; text: string }

function splitSource(source: string): { lines: string[]; newline: string } {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return { lines: source.split(newline), newline }
}

export function newlineFor(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

export function offsetAt(source: string, location: SourceLocation): number {
  const { lines, newline } = splitSource(source)
  const line = Math.max(location.line ?? 1, 1)
  let offset = 0
  for (let index = 0; index < line - 1; index++) {
    offset += (lines[index]?.length ?? 0) + newline.length
  }
  return offset + Math.max((location.column ?? 1) - 1, 0)
}

export function applyReplacements(
  source: string,
  replacements: readonly Replacement[],
): string {
  const ordered = [...replacements].sort(
    (left, right) => right.start - left.start,
  )
  let next = source
  for (const replacement of ordered) {
    next =
      next.slice(0, replacement.start) +
      replacement.text +
      next.slice(replacement.end)
  }
  return next
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

export function nameReplacement(
  source: string,
  location: SourceLocation | undefined,
  keyword: string,
  currentName: string,
  nextName: string,
): Replacement | undefined {
  if (!location?.line || currentName === nextName) return undefined
  const start = offsetAt(source, location)
  const match = source
    .slice(start)
    .match(new RegExp(`^${escapedRegex(keyword)}\\s*:\\s*`))
  if (!match) return undefined
  const nameStart = start + match[0].length
  return {
    start: nameStart,
    end: nameStart + currentName.length,
    text: nextName,
  }
}

export function tagReplacement(
  source: string,
  tags: readonly { name: string; location?: SourceLocation }[],
  nextTags: readonly string[],
  keywordLocation: SourceLocation | undefined,
): Replacement | undefined {
  if (
    sameValues(
      tags.map((tag) => tag.name),
      nextTags,
    )
  )
    return undefined

  const first = tags[0]
  const last = tags.at(-1)
  if (first?.location?.line && last?.location?.column) {
    const start = offsetAt(source, first.location)
    const end = offsetAt(source, last.location) + last.name.length
    return { start, end, text: nextTags.join(' ') }
  }
  if (nextTags.length === 0 || !keywordLocation?.line) return undefined
  const indent = Math.max((keywordLocation.column ?? 1) - 1, 0)
  const lineStart = offsetAt(source, { line: keywordLocation.line, column: 1 })
  return {
    start: lineStart,
    end: lineStart,
    text: `${' '.repeat(indent)}${nextTags.join(' ')}${newlineFor(source)}`,
  }
}
