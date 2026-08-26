import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSpecificationWorkspace,
  DocumentConflictError,
} from './documents'

const checkoutSource = `# keep this comment

@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnpaybbbbbbbbbb
  Scenario: Pay for the order
    Then payment is captured
`

describe('createSpecificationWorkspace', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  async function project(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'pickle-studio-docs-'))
    directories.push(root)
    await mkdir(join(root, 'features'), { recursive: true })
    await Bun.write(join(root, 'features', 'checkout.feature'), checkoutSource)
    return root
  }

  test('loads a Specification document from the project workspace', async () => {
    const workspace = createSpecificationWorkspace({
      root: await project(),
      globs: 'features/**/*.feature',
    })
    const document = await workspace.read('features/checkout.feature')
    expect(document.uri).toBe('features/checkout.feature')
    expect(document.source).toBe(checkoutSource)
    expect(document.revision).toBeTruthy()
    expect(document.specification.name).toBe('Checkout')
    expect(document.specification.children[0]).toMatchObject({
      kind: 'scenario',
      name: 'Pay for the order',
    })
  })

  test('previews a structured edit as a source diff without writing the file', async () => {
    const root = await project()
    const workspace = createSpecificationWorkspace({
      root,
      globs: 'features/**/*.feature',
    })
    const current = await workspace.read('features/checkout.feature')
    const specification = {
      ...current.specification,
      name: 'Basket',
    }
    const preview = workspace.preview({
      uri: 'features/checkout.feature',
      source: current.source,
      specification,
    })
    expect(preview.source).toContain('Feature: Basket')
    expect(preview.diff).toContain('-Feature: Checkout')
    expect(preview.diff).toContain('+Feature: Basket')
    expect(
      await Bun.file(join(root, 'features', 'checkout.feature')).text(),
    ).toBe(checkoutSource)
  })

  test('writes a confirmed source buffer and preserves unrelated comments', async () => {
    const root = await project()
    const workspace = createSpecificationWorkspace({
      root,
      globs: 'features/**/*.feature',
    })
    const current = await workspace.read('features/checkout.feature')
    const specification = {
      ...current.specification,
      name: 'Basket',
    }
    const preview = workspace.preview({
      uri: 'features/checkout.feature',
      source: current.source,
      specification,
    })
    const written = await workspace.write({
      uri: 'features/checkout.feature',
      source: preview.source,
      expectedRevision: current.revision,
    })
    expect(written.source).toContain('# keep this comment')
    expect(written.source).toContain('Feature: Basket')
    expect(
      await Bun.file(join(root, 'features', 'checkout.feature')).text(),
    ).toBe(written.source)
    expect(written.revision).not.toBe(current.revision)
  })

  test('rejects a write when the disk revision no longer matches', async () => {
    const root = await project()
    const workspace = createSpecificationWorkspace({
      root,
      globs: 'features/**/*.feature',
    })
    const current = await workspace.read('features/checkout.feature')
    await Bun.write(
      join(root, 'features', 'checkout.feature'),
      checkoutSource.replace('Checkout', 'Changed on disk'),
    )
    try {
      await workspace.write({
        uri: 'features/checkout.feature',
        source: current.source.replace('Checkout', 'Basket'),
        expectedRevision: current.revision,
      })
      throw new Error('expected conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentConflictError)
      if (!(error instanceof DocumentConflictError)) throw error
      expect(error.code).toBe('conflict')
      expect(error.uri).toBe('features/checkout.feature')
      expect(error.diskSource).toContain('Feature: Changed on disk')
    }
    expect(
      await Bun.file(join(root, 'features', 'checkout.feature')).text(),
    ).toContain('Feature: Changed on disk')
  })

  test('notifies watchers when a Specification file changes on disk', async () => {
    const root = await project()
    const workspace = createSpecificationWorkspace({
      root,
      globs: 'features/**/*.feature',
    })
    const events: Array<{ uri: string; source: string }> = []
    const stop = await workspace.watch((event) => {
      events.push(event)
    })
    try {
      await Bun.write(
        join(root, 'features', 'checkout.feature'),
        checkoutSource.replace('Checkout', 'Search'),
      )
      const deadline = Date.now() + 5_000
      while (
        Date.now() < deadline &&
        !events.some((event) => event.source.includes('Feature: Search'))
      ) {
        await Bun.sleep(25)
      }
      expect(
        events.some((event) => event.uri === 'features/checkout.feature'),
      ).toBe(true)
      expect(
        events.some((event) => event.source.includes('Feature: Search')),
      ).toBe(true)
    } finally {
      stop()
    }
  })

  test('collects Gherkin tags and steps for editor autocomplete', async () => {
    const workspace = createSpecificationWorkspace({
      root: await project(),
      globs: 'features/**/*.feature',
    })
    const catalog = await workspace.completions()
    expect(catalog.tags).toContain('@pickle:state:active')
    expect(catalog.steps).toContain('Then payment is captured')
  })

  test('creates an accepted AI Specification in the draft state without writing during propose', async () => {
    const root = await project()
    const workspace = createSpecificationWorkspace({
      root,
      globs: 'features/**/*.feature',
    })
    const proposal = await workspace.propose({
      prompt: 'Search the catalog',
      uri: 'features/search.feature',
      author: async () => ({
        source: `@pickle:id:specsearchaaaaaaa @pickle:state:active
Feature: Search
  Scenario: Query the catalog
    Then results are shown
`,
      }),
    })
    expect(proposal.source).toContain('@pickle:state:draft')
    expect(proposal.source).not.toContain('@pickle:state:active')
    expect(proposal.diff).toContain('+Feature: Search')
    expect(
      await Bun.file(join(root, 'features', 'search.feature')).exists(),
    ).toBe(false)
    const written = await workspace.write({
      uri: 'features/search.feature',
      source: proposal.source,
      create: true,
    })
    expect(written.specification.name).toBe('Search')
    expect(
      await Bun.file(join(root, 'features', 'search.feature')).text(),
    ).toContain('@pickle:state:draft')
  })
})
