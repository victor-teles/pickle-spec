import { watch } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import {
  applySpecificationSource,
  applyStructuredSpecification,
  ensureSpecificationState,
  readSpecificationDocument,
  type StructuredSpecification,
  specificationSourceDiff,
} from '@pickle-spec/spec'
import { catalogFromSource, type GherkinCatalog } from './gherkin-language'

export interface SpecificationWorkspaceOptions {
  root: string
  globs: string | readonly string[]
  language?: string
}

export interface SpecificationBuffer {
  uri: string
  source: string
  revision: string
  language: string
  specification: ReturnType<typeof readSpecificationDocument>['specification']
}

export interface SpecificationPreview extends SpecificationBuffer {
  diff: string
}

export interface DiskChangeEvent {
  uri: string
  source: string
  revision: string
}

export interface ProposeSpecificationInput {
  prompt: string
  uri?: string
  currentSource?: string
  author: (input: {
    prompt: string
    currentSource?: string
  }) => Promise<{ source: string }>
}

export class DocumentConflictError extends Error {
  readonly code = 'conflict'
  readonly uri: string
  readonly diskSource: string
  readonly revision: string

  constructor(input: { uri: string; diskSource: string; revision: string }) {
    super(`Specification ${input.uri} changed on disk`)
    this.name = 'DocumentConflictError'
    this.uri = input.uri
    this.diskSource = input.diskSource
    this.revision = input.revision
  }
}

export interface SpecificationWorkspace {
  read(uri: string): Promise<SpecificationBuffer>
  preview(input: {
    uri: string
    source: string
    specification?: StructuredSpecification
    diffAgainst?: string
  }): SpecificationPreview
  write(input: {
    uri: string
    source: string
    expectedRevision?: string
    create?: boolean
  }): Promise<SpecificationBuffer>
  propose(input: ProposeSpecificationInput): Promise<SpecificationPreview>
  completions(): Promise<GherkinCatalog>
  watch(listener: (event: DiskChangeEvent) => void): Promise<() => void>
}

function revisionFor(source: string): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(source)
  return hasher.digest('hex').slice(0, 16)
}

const diskWatchDebounceMs = 100
const diskWatchPollMs = 200

function globList(globs: string | readonly string[]): readonly string[] {
  return typeof globs === 'string' ? [globs] : globs
}

export function createSpecificationWorkspace(
  options: SpecificationWorkspaceOptions,
): SpecificationWorkspace {
  const root = resolve(options.root)
  const language = options.language ?? 'en'
  const globs = globList(options.globs)

  function matches(uri: string): boolean {
    return globs.some((pattern) => new Bun.Glob(pattern).match(uri))
  }

  function resolveUri(uri: string): string {
    const resolved = resolve(root, uri)
    if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
      throw new Error(
        `Specification path ${JSON.stringify(uri)} is outside the project`,
      )
    }
    const relativeUri = relative(root, resolved).replaceAll('\\', '/')
    if (!matches(relativeUri)) {
      throw new Error(
        `Specification path ${JSON.stringify(uri)} is outside the configured Specification glob`,
      )
    }
    return resolved
  }

  function buffer(uri: string, source: string): SpecificationBuffer {
    const document = readSpecificationDocument({
      uri,
      source,
      language,
    })
    return {
      uri,
      source,
      revision: revisionFor(source),
      language: document.language,
      specification: document.specification,
    }
  }

  return {
    async read(uri) {
      const path = resolveUri(uri)
      const file = Bun.file(path)
      if (!(await file.exists())) {
        throw new Error(`Specification ${uri} was not found`)
      }
      return buffer(uri, await file.text())
    },

    preview(input) {
      const next = input.specification
        ? applyStructuredSpecification({
            uri: input.uri,
            source: input.source,
            language,
            specification: input.specification,
          })
        : applySpecificationSource({
            uri: input.uri,
            source: input.source,
            language,
          })
      return {
        ...buffer(input.uri, next),
        diff: specificationSourceDiff(input.diffAgainst ?? input.source, next),
      }
    },

    async write(input) {
      const path = resolveUri(input.uri)
      const file = Bun.file(path)
      const exists = await file.exists()
      if (input.create && exists) {
        const diskSource = await file.text()
        throw new DocumentConflictError({
          uri: input.uri,
          diskSource,
          revision: revisionFor(diskSource),
        })
      }
      if (!input.create && !exists) {
        throw new Error(`Specification ${input.uri} was not found`)
      }
      if (!input.create && exists) {
        const diskSource = await file.text()
        const revision = revisionFor(diskSource)
        if (
          input.expectedRevision !== undefined &&
          revision !== input.expectedRevision
        ) {
          throw new DocumentConflictError({
            uri: input.uri,
            diskSource,
            revision,
          })
        }
      }
      const source = applySpecificationSource({
        uri: input.uri,
        source: input.source,
        language,
      })
      await Bun.write(path, source)
      return buffer(input.uri, source)
    },

    async propose(input) {
      const uri = input.uri ?? 'features/proposed.feature'
      const authored = await input.author({
        prompt: input.prompt,
        currentSource: input.currentSource,
      })
      const parsed = applySpecificationSource({
        uri,
        source: authored.source,
        language,
      })
      const source = input.currentSource
        ? parsed
        : ensureSpecificationState(parsed, 'draft', language)
      return {
        ...buffer(uri, source),
        diff: specificationSourceDiff(input.currentSource ?? '', source),
      }
    },

    async completions() {
      const tags = new Set<string>()
      const steps = new Set<string>()
      for (const pattern of globs) {
        for await (const path of new Bun.Glob(pattern).scan({
          cwd: root,
          onlyFiles: true,
        })) {
          const catalog = catalogFromSource(
            await Bun.file(resolve(root, path)).text(),
          )
          for (const tag of catalog.tags) tags.add(tag)
          for (const step of catalog.steps) steps.add(step)
        }
      }
      return {
        tags: [...tags].sort((left, right) => left.localeCompare(right)),
        steps: [...steps].sort((left, right) => left.localeCompare(right)),
      }
    },

    async watch(listener) {
      const known = new Map<string, string>()
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined

      async function scan() {
        const current = new Map<string, { source: string; revision: string }>()
        for (const pattern of globs) {
          for await (const path of new Bun.Glob(pattern).scan({
            cwd: root,
            onlyFiles: true,
          })) {
            const uri = path.replaceAll('\\', '/')
            const source = await Bun.file(resolve(root, uri)).text()
            current.set(uri, { source, revision: revisionFor(source) })
          }
        }
        return current
      }

      async function emitChanges() {
        if (stopped) return
        const current = await scan()
        for (const [uri, file] of current) {
          if (known.get(uri) === file.revision) continue
          known.set(uri, file.revision)
          listener({ uri, source: file.source, revision: file.revision })
        }
      }

      for (const [uri, file] of await scan()) known.set(uri, file.revision)

      function schedule() {
        if (stopped || timer) return
        timer = setTimeout(() => {
          timer = undefined
          void emitChanges()
        }, diskWatchDebounceMs)
      }

      let watcher: ReturnType<typeof watch> | undefined
      try {
        watcher = watch(root, { recursive: true }, () => schedule())
      } catch {
        watcher = undefined
      }
      const interval = setInterval(() => schedule(), diskWatchPollMs)

      return () => {
        stopped = true
        watcher?.close()
        clearInterval(interval)
        if (timer) clearTimeout(timer)
      }
    },
  }
}
