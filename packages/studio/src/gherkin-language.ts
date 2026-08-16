export type GherkinCompletionKind = 'keyword' | 'tag' | 'step'

export type GherkinCompletion = {
  label: string
  insertText: string
  detail: string
  kind: GherkinCompletionKind
}

export type GherkinCatalog = {
  tags: readonly string[]
  steps: readonly string[]
}

export const gherkinKeywords = [
  'Feature',
  'Rule',
  'Background',
  'Scenario Outline',
  'Scenario',
  'Examples',
  'Given',
  'When',
  'Then',
  'And',
  'But',
] as const

export const pickleStateTags = [
  '@pickle:state:draft',
  '@pickle:state:active',
  '@pickle:state:deprecated',
] as const

export const gherkinMonarch = {
  defaultToken: '',
  ignoreCase: false,
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/@[^\s]+/, 'tag'],
      [/^\s*\|.*$/, 'table'],
      [
        /^\s*(Feature|Rule|Background|Scenario Outline|Scenario|Examples)\b/,
        'keyword',
      ],
      [/^\s*(Given|When|Then|And|But)\b/, 'keyword'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/<[^>]+>/, 'placeholder'],
    ],
  },
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort(
    (left, right) => left.localeCompare(right),
  )
}

function currentToken(line: string): string {
  const match = line.match(/(\S+)$/)
  return match?.[1] ?? ''
}

export function gherkinCompletions(input: {
  line: string
  catalog?: GherkinCatalog
}): GherkinCompletion[] {
  const token = currentToken(input.line)
  const prefix = token.toLowerCase()
  const items: GherkinCompletion[] = [
    ...gherkinKeywords.map((keyword) => ({
      label: keyword,
      insertText: keyword.includes(' ') ? keyword : `${keyword} `,
      detail: 'Gherkin keyword',
      kind: 'keyword' as const,
    })),
    ...pickleStateTags.map((tag) => ({
      label: tag,
      insertText: tag,
      detail: 'Specification state',
      kind: 'tag' as const,
    })),
    ...(input.catalog?.tags ?? []).map((tag) => ({
      label: tag,
      insertText: tag,
      detail: 'Project tag',
      kind: 'tag' as const,
    })),
    ...(input.catalog?.steps ?? []).map((step) => ({
      label: step,
      insertText: step,
      detail: 'Project step',
      kind: 'step' as const,
    })),
  ]
  if (!prefix) return items
  return items.filter((item) => item.label.toLowerCase().startsWith(prefix))
}

export function catalogFromSource(source: string): GherkinCatalog {
  const tags: string[] = []
  const steps: string[] = []
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('@')) {
      tags.push(...line.split(/\s+/).filter((part) => part.startsWith('@')))
      continue
    }
    const step = line.match(/^(Given|When|Then|And|But)\s+(.+)$/)
    if (step?.[1] && step[2]) steps.push(`${step[1]} ${step[2]}`)
  }
  return {
    tags: uniqueSorted(tags),
    steps: uniqueSorted(steps),
  }
}
