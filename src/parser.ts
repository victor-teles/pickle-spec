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
export async function parseFeatureFile(filePath: string): Promise<ParsedFeature> {
  const uuidFn = IdGenerator.uuid()
  const parser = new Parser(new AstBuilder(uuidFn), new GherkinClassicTokenMatcher())

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
 * Discover and parse all .feature files matching the given glob pattern.
 */
export async function parseFeatureFiles(globPattern: string): Promise<ParsedFeature[]> {
  const glob = new Bun.Glob(globPattern)
  const results: ParsedFeature[] = []

  for await (const filePath of glob.scan({ cwd: process.cwd(), absolute: true })) {
    const parsed = await parseFeatureFile(filePath)
    results.push(parsed)
  }

  if (results.length === 0) {
    throw new Error(`No .feature files found matching pattern: ${globPattern}`)
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
