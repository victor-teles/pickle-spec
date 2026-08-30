import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openTestRunStore } from '@pickle-spec/runner'
import {
  parseSpecification,
  validateSpecificationMetadata,
} from '@pickle-spec/spec'
import { defaultExtensionsFile } from '../../configuration/config'
import type { Extensions } from '../../extensions/extensions'

export async function loadExtensions(
  path?: string,
  root = process.cwd(),
): Promise<Extensions> {
  const selectedPath = path ?? defaultExtensionsFile
  const absolutePath = resolve(root, selectedPath)
  if (!(await Bun.file(absolutePath).exists())) {
    if (!path) return {}
    throw new Error(`Extensions file not found: ${selectedPath}`)
  }
  return ((await import(pathToFileURL(absolutePath).href)).default ??
    {}) as Extensions
}

export async function loadProjectSpecifications(
  patterns: string | string[],
  language: string | undefined,
  root: string,
) {
  const paths = new Set<string>()
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    const glob = new Bun.Glob(pattern)
    for await (const path of glob.scan({
      cwd: root,
      absolute: true,
      onlyFiles: true,
    }))
      paths.add(path)
  }
  if (paths.size === 0) return []
  const files = await Promise.all(
    [...paths].sort().map(async (path) => ({
      uri: relative(root, path),
      source: await Bun.file(path).text(),
    })),
  )
  validateSpecificationMetadata(files, language)
  return files.map((file) =>
    parseSpecification({
      source: file.source,
      uri: file.uri,
      language,
    }),
  )
}

export async function discoverSpecifications(
  patterns: string | string[],
  language: string | undefined,
  root: string,
) {
  const specifications = await loadProjectSpecifications(
    patterns,
    language,
    root,
  )
  if (specifications.length === 0) {
    const description = Array.isArray(patterns) ? patterns.join(', ') : patterns
    throw new Error(`No specifications found matching: ${description}`)
  }
  return specifications
}

export async function loadPersistedRun(root: string, runId: string) {
  const store = openTestRunStore({ root })
  const run = await store.open(runId)
  const events = await run.events()
  if (events.length === 0) throw new Error(`Unknown test run "${runId}"`)
  const manifest = await run.materialize({ finished: false })
  return { manifest, events }
}
