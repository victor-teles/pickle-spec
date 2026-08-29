import { watch } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import {
  applySpecificationMetadata,
  applySpecificationSource,
  applyStructuredSpecification,
  ensureSpecificationState,
  readSpecificationDocument,
  type SpecificationMetadata,
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
    metadata?: SpecificationMetadata
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

interface SpecificationWorkspaceState {
  root: string
  language: string
  globs: readonly string[]
}

function resolveSpecificationUri(
  state: SpecificationWorkspaceState,
  uri: string,
): string {
  const resolved = resolve(state.root, uri)
  if (resolved !== state.root && !resolved.startsWith(`${state.root}${sep}`)) {
    throw new Error(
      `Specification path ${JSON.stringify(uri)} is outside the project`,
    )
  }
  const relativeUri = relative(state.root, resolved).replaceAll('\\', '/')
  const matches = state.globs.some((pattern) =>
    new Bun.Glob(pattern).match(relativeUri),
  )
  if (!matches) {
    throw new Error(
      `Specification path ${JSON.stringify(uri)} is outside the configured Specification glob`,
    )
  }
  return resolved
}

function specificationBuffer(
  state: SpecificationWorkspaceState,
  uri: string,
  source: string,
): SpecificationBuffer {
  const document = readSpecificationDocument({
    uri,
    source,
    language: state.language,
  })
  return {
    uri,
    source,
    revision: revisionFor(source),
    language: document.language,
    specification: document.specification,
  }
}

async function validateWriteTarget(
  state: SpecificationWorkspaceState,
  input: { uri: string; expectedRevision?: string; create?: boolean },
): Promise<string> {
  const path = resolveSpecificationUri(state, input.uri)
  const file = Bun.file(path)
  const exists = await file.exists()
  if (!exists) {
    if (!input.create)
      throw new Error(`Specification ${input.uri} was not found`)
    return path
  }
  const diskSource = await file.text()
  const revision = revisionFor(diskSource)
  if (
    input.create ||
    (input.expectedRevision !== undefined &&
      revision !== input.expectedRevision)
  ) {
    throw new DocumentConflictError({ uri: input.uri, diskSource, revision })
  }
  return path
}

async function scanSpecifications(state: SpecificationWorkspaceState) {
  const current = new Map<string, { source: string; revision: string }>()
  for (const pattern of state.globs) {
    for await (const path of new Bun.Glob(pattern).scan({
      cwd: state.root,
      onlyFiles: true,
    })) {
      const uri = path.replaceAll('\\', '/')
      const source = await Bun.file(resolve(state.root, uri)).text()
      current.set(uri, { source, revision: revisionFor(source) })
    }
  }
  return current
}

async function watchSpecificationFiles(
  state: SpecificationWorkspaceState,
  listener: (event: DiskChangeEvent) => void,
): Promise<() => void> {
  const known = new Map<string, string>()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  async function emitChanges() {
    if (stopped) return
    for (const [uri, file] of await scanSpecifications(state)) {
      if (known.get(uri) === file.revision) continue
      known.set(uri, file.revision)
      listener({ uri, source: file.source, revision: file.revision })
    }
  }
  for (const [uri, file] of await scanSpecifications(state))
    known.set(uri, file.revision)
  function schedule() {
    if (stopped || timer) return
    timer = setTimeout(() => {
      timer = undefined
      void emitChanges()
    }, diskWatchDebounceMs)
  }
  let watcher: ReturnType<typeof watch> | undefined
  try {
    watcher = watch(state.root, { recursive: true }, schedule)
  } catch {
    watcher = undefined
  }
  const interval = setInterval(schedule, diskWatchPollMs)
  return () => {
    stopped = true
    watcher?.close()
    clearInterval(interval)
    if (timer) clearTimeout(timer)
  }
}

function previewSpecification(
  state: SpecificationWorkspaceState,
  input: Parameters<SpecificationWorkspace['preview']>[0],
): SpecificationPreview {
  let next: string
  if (input.metadata) {
    next = applySpecificationMetadata(
      input.source,
      input.metadata,
      state.language,
    )
  } else if (input.specification) {
    next = applyStructuredSpecification({
      uri: input.uri,
      source: input.source,
      language: state.language,
      specification: input.specification,
    })
  } else {
    next = applySpecificationSource({
      uri: input.uri,
      source: input.source,
      language: state.language,
    })
  }
  return {
    ...specificationBuffer(state, input.uri, next),
    diff: specificationSourceDiff(input.diffAgainst ?? input.source, next),
  }
}

async function collectCompletions(
  state: SpecificationWorkspaceState,
  pattern: string,
  tags: Set<string>,
  steps: Set<string>,
): Promise<void> {
  for await (const path of new Bun.Glob(pattern).scan({
    cwd: state.root,
    onlyFiles: true,
  })) {
    const catalog = catalogFromSource(
      await Bun.file(resolve(state.root, path)).text(),
    )
    for (const tag of catalog.tags) tags.add(tag)
    for (const step of catalog.steps) steps.add(step)
  }
}

export function createSpecificationWorkspace(
  options: SpecificationWorkspaceOptions,
): SpecificationWorkspace {
  const state: SpecificationWorkspaceState = {
    root: resolve(options.root),
    language: options.language ?? 'en',
    globs: globList(options.globs),
  }

  return {
    async read(uri) {
      const path = resolveSpecificationUri(state, uri)
      const file = Bun.file(path)
      if (!(await file.exists())) {
        throw new Error(`Specification ${uri} was not found`)
      }
      return specificationBuffer(state, uri, await file.text())
    },

    preview(input) {
      return previewSpecification(state, input)
    },

    async write(input) {
      const path = await validateWriteTarget(state, input)
      const source = applySpecificationSource({
        uri: input.uri,
        source: input.source,
        language: state.language,
      })
      await Bun.write(path, source)
      return specificationBuffer(state, input.uri, source)
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
        language: state.language,
      })
      const source = input.currentSource
        ? parsed
        : ensureSpecificationState(parsed, 'draft', state.language)
      return {
        ...specificationBuffer(state, uri, source),
        diff: specificationSourceDiff(input.currentSource ?? '', source),
      }
    },

    async completions() {
      const tags = new Set<string>()
      const steps = new Set<string>()
      for (const pattern of state.globs) {
        await collectCompletions(state, pattern, tags, steps)
      }
      return {
        tags: [...tags].sort((left, right) => left.localeCompare(right)),
        steps: [...steps].sort((left, right) => left.localeCompare(right)),
      }
    },

    async watch(listener) {
      return watchSpecificationFiles(state, listener)
    },
  }
}
