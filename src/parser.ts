import { Parser, AstBuilder, GherkinClassicTokenMatcher, compile } from '@cucumber/gherkin'
import { IdGenerator } from '@cucumber/messages'
import type { Pickle, GherkinDocument } from '@cucumber/messages'

export interface ParsedFeature {
  filePath: string
  featureName: string
  document: GherkinDocument
  pickles: readonly Pickle[]
}

/**
 * Parse a single .feature file into its AST and compiled Pickles.
 */
export async function parseFeatureFile(filePath: string, language?: string): Promise<ParsedFeature> {
  const uuidFn = IdGenerator.uuid()
  const parser = new Parser(new AstBuilder(uuidFn), new GherkinClassicTokenMatcher(language ?? 'en'))

  const file = Bun.file(filePath)
  const content = await file.text()

  const document = parser.parse(content)
  const pickles = compile(document, filePath, uuidFn)

  return {
    filePath,
    featureName: document.feature?.name ?? 'Unnamed Feature',
    document,
    pickles,
  }
}

/**
 * Discover and parse all .feature files matching the given glob pattern(s).
 */
export async function parseFeatureFiles(globPattern: string | string[], language?: string): Promise<ParsedFeature[]> {
  const patterns = Array.isArray(globPattern) ? globPattern : [globPattern]
  const seen = new Set<string>()
  const results: ParsedFeature[] = []

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern)
    for await (const filePath of glob.scan({ cwd: process.cwd(), absolute: true })) {
      if (seen.has(filePath)) continue
      seen.add(filePath)
      const parsed = await parseFeatureFile(filePath, language)
      results.push(parsed)
    }
  }

  if (results.length === 0) {
    throw new Error(`No .feature files found matching pattern: ${patterns.join(', ')}`)
  }

  return results
}

/**
 * Filter pickles by tag.
 * Normalizes the tag to ensure it starts with '@'.
 */
export function filterPicklesByTag(pickles: readonly Pickle[], tag: string): Pickle[] {
  const normalizedTag = tag.startsWith('@') ? tag : `@${tag}`
  return pickles.filter(pickle =>
    pickle.tags.some(t => t.name === normalizedTag)
  )
}
