import type { Feature } from '@cucumber/messages'
import { stateTagPrefix, stateValues } from './identity-core'
import {
  identityNodes,
  nodeLabel,
  parseIdentityDocument,
  type SpecificationSourceFile,
} from './identity-management'

export interface SpecificationMigrationChange {
  uri: string
  description: string
}

export interface SpecificationMigrationFile {
  uri: string
  source: string
  nextSource: string
}

export interface SpecificationMigrationPlan {
  changes: SpecificationMigrationChange[]
  files: SpecificationMigrationFile[]
}

type SourceEdit = { type: 'insert-line'; beforeLine: number; text: string }

function applyEdits(source: string, edits: readonly SourceEdit[]): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(newline)
  const orderedEdits = [...edits].sort(
    (left, right) => right.beforeLine - left.beforeLine,
  )
  for (const edit of orderedEdits) {
    lines.splice(edit.beforeLine - 1, 0, edit.text)
  }
  return lines.join(newline)
}

function tagLine(column: number, tags: readonly string[]): string {
  return `${' '.repeat(Math.max(column - 1, 0))}${tags.join(' ')}`
}

function migrateFile(
  file: SpecificationSourceFile,
  feature: Feature | undefined,
): { nextSource: string; changes: SpecificationMigrationChange[] } {
  if (!feature) return { nextSource: file.source, changes: [] }
  const featureNode = identityNodes(feature).find(
    (node) => node.kind === 'feature',
  )
  if (!featureNode || stateValues(featureNode.tags).length > 0) {
    return { nextSource: file.source, changes: [] }
  }

  const stateTag = `${stateTagPrefix}active`
  const edit: SourceEdit = {
    type: 'insert-line',
    beforeLine: featureNode.line,
    text: tagLine(featureNode.column, [stateTag]),
  }
  return {
    nextSource: applyEdits(file.source, [edit]),
    changes: [
      {
        uri: file.uri,
        description: `${nodeLabel(featureNode)}: add ${stateTag}`,
      },
    ],
  }
}

export function planSpecificationMigration(
  files: readonly SpecificationSourceFile[],
  language = 'en',
): SpecificationMigrationPlan {
  const changes: SpecificationMigrationChange[] = []
  const migratedFiles = files.map((file) => {
    const feature = parseIdentityDocument(file.source, language).feature
    const migrated = migrateFile(file, feature)
    changes.push(...migrated.changes)
    return {
      uri: file.uri,
      source: file.source,
      nextSource: migrated.nextSource,
    }
  })
  return { changes, files: migratedFiles }
}

export function formatMigrationPreview(
  plan: SpecificationMigrationPlan,
): string {
  if (plan.changes.length === 0) {
    return 'No Specification metadata changes needed'
  }
  const uris = [...new Set(plan.changes.map((change) => change.uri))]
  const sections = uris.map((uri) => {
    const lines = plan.changes
      .filter((change) => change.uri === uri)
      .map((change) => `  ${change.description}`)
    return `${uri}\n${lines.join('\n')}`
  })
  return `Migration preview\n\n${sections.join('\n\n')}\n`
}
