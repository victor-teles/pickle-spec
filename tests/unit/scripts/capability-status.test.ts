import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const inventoryPath = resolve(repositoryRoot, 'docs/capability-status.md')
const targetColumns = [
  'Local web',
  'Attached CDP',
  'Browserbase',
  'Android Emulator',
  'iOS Simulator',
]
const allowedStatuses = ['Implemented', 'Verified', 'Unsupported', 'Unverified']

type MarkdownTable = {
  heading: string
  header: string[]
  rows: string[][]
}

function tableUnderHeading(markdown: string, heading: string): MarkdownTable {
  const section = markdown.match(
    new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'),
  )?.[1]
  const lines = section?.split('\n') ?? []
  const tableStart = lines.findIndex((line) => line.startsWith('| QA task |'))
  const tableLines = lines
    .slice(tableStart)
    .filter((line) => line.startsWith('|'))
  const cells = tableLines.map((line) =>
    line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim()),
  )

  return { heading, header: cells[0] ?? [], rows: cells.slice(2) }
}

function markdownAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>()
  for (const match of markdown.matchAll(/^#{1,6} (.+)$/gm)) {
    const anchor = match[1]
      .toLowerCase()
      .replace(/[`*_~]/g, '')
      .replace(/[^\p{L}\p{N} -]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
    anchors.add(anchor)
  }
  return anchors
}

describe('ENG-01 capability inventory acceptance', () => {
  test('records a full source revision and two five-target task matrices', async () => {
    const inventory = await Bun.file(inventoryPath).text()
    const revision = inventory.match(/source revision\s+`([0-9a-f]+)`/i)?.[1]
    const tables = [
      tableUnderHeading(inventory, 'Set up and run a Scenario'),
      tableUnderHeading(inventory, 'Watch execution and inspect evidence'),
    ]

    expect(revision).toMatch(/^[0-9a-f]{40}$/)
    for (const table of tables) {
      expect(table.header).toEqual(['QA task', ...targetColumns])
      expect(table.rows.length, `${table.heading} must contain task rows`).toBeGreaterThan(0)
      for (const row of table.rows) {
        expect(row).toHaveLength(6)
        for (const cell of row.slice(1)) {
          expect(cell).toMatch(new RegExp(`\\b(?:${allowedStatuses.join('|')})\\b`))
          expect(cell).toMatch(/\[[^\]]+\]\([^\)]+\)/)
        }
      }
    }

    const tasks = tables.flatMap((table) => table.rows.map(([task]) => task))
    for (const category of [
      /setup/i,
      /assertions/i,
      /screenshots and action evidence/i,
      /recordings, traces, and diagnostics/i,
      /Replay a complete Scenario/i,
      /Cancel a Test run/i,
      /Run in CI/i,
      /execution plan before running/i,
      /Edit, validate, activate, or roll back a durable plan/i,
    ]) {
      expect(tasks.some((task) => category.test(task)), `missing task ${category}`).toBe(true)
    }
  })

  test('resolves every local inventory link and Markdown anchor', async () => {
    const inventory = await Bun.file(inventoryPath).text()
    const links = [...inventory.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)].map(
      (match) => match[1],
    )

    for (const link of links) {
      if (/^(?:https?:|mailto:)/.test(link)) continue
      const [relativePath, fragment] = link.split('#')
      const targetPath = relativePath
        ? resolve(repositoryRoot, 'docs', decodeURIComponent(relativePath))
        : inventoryPath

      expect(await Bun.file(targetPath).exists(), `missing link target ${link}`).toBe(true)
      if (fragment) {
        const target = await Bun.file(targetPath).text()
        expect(markdownAnchors(target).has(decodeURIComponent(fragment)), `missing anchor ${link}`).toBe(true)
      }
    }
  })

  test('keeps roadmap follow, filmstrip, and picture-in-picture status separate', async () => {
    const roadmap = await Bun.file(resolve(repositoryRoot, 'ROADMAP.md')).text()

    expect(roadmap).toMatch(/^- \[x\] Follow mode:/m)
    expect(roadmap).toMatch(/^- \[ \] Concurrent target filmstrip:/m)
    expect(roadmap).toMatch(/^- \[ \] Picture-in-picture:/m)
    expect(roadmap).not.toContain('Follow mode and picture-in-picture')
    expect(roadmap).not.toContain('Studio does not yet provide live target video')
    expect(roadmap).not.toMatch(/\b(?:Bone|teal|oxide|amber)\b/)
    expect(roadmap).toMatch(/\[DESIGN\.md\]\(DESIGN\.md\)/)
  })
})
