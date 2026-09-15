import { createHash } from 'node:crypto'
import {
  idTagPrefix,
  stateTagPrefix,
  rowIdColumn,
  specificationStates,
} from './metadata'
import type { SpecificationState } from './metadata'
export * from './metadata'

export function idValues(tags: readonly string[]): string[] {
  return tags
    .filter((tag) => tag.startsWith(idTagPrefix))
    .map((tag) => tag.slice(idTagPrefix.length))
}

export function stateValues(tags: readonly string[]): string[] {
  return tags
    .filter((tag) => tag.startsWith(stateTagPrefix))
    .map((tag) => tag.slice(stateTagPrefix.length))
}

function specificationState(
  value: string | undefined,
): SpecificationState | undefined {
  return specificationStates.find((state) => state === value)
}

type SpecificationIdentity = {
  id?: string
  state?: SpecificationState
}

export function identityFromTags(
  tags: readonly string[],
): SpecificationIdentity {
  const id = idValues(tags)[0]
  const state = specificationState(stateValues(tags)[0])
  const identity: SpecificationIdentity = {}
  if (id) identity.id = id
  if (state) identity.state = state
  return identity
}

export function examplesRowId(
  header: readonly string[],
  cells: readonly string[],
): string | undefined {
  const index = header.indexOf(rowIdColumn)
  const value = index >= 0 ? cells[index]?.trim() : undefined
  return value || undefined
}

export function identifierDigest(parts: readonly string[]): string {
  const hasher = createHash('sha256')
  hasher.update(parts.join('\0'))
  return hasher.digest('hex').slice(0, 16)
}

function explicitId(tags: readonly string[]): string | undefined {
  return idValues(tags)[0] || undefined
}

export function resolveSpecificationId(
  uri: string,
  name: string,
  tags: readonly string[],
): string {
  return explicitId(tags) ?? identifierDigest(['specification', uri, name])
}

export function resolveScenarioId(
  uri: string,
  specificationName: string,
  name: string,
  tags: readonly string[],
): string {
  return (
    explicitId(tags) ??
    identifierDigest(['scenario', uri, specificationName, name])
  )
}

export function resolveExamplesId(
  uri: string,
  specificationName: string,
  scenarioName: string,
  name: string,
  tags: readonly string[],
): string {
  return (
    explicitId(tags) ??
    identifierDigest(['examples', uri, specificationName, scenarioName, name])
  )
}

export function resolveExamplesRowId(
  uri: string,
  specificationName: string,
  scenarioName: string,
  examplesName: string,
  header: readonly string[],
  cells: readonly string[],
): string {
  const explicit = examplesRowId(header, cells)
  if (explicit) return explicit
  const values = cells.filter((_, index) => header[index] !== rowIdColumn)
  return identifierDigest([
    'examples-row',
    uri,
    specificationName,
    scenarioName,
    examplesName,
    ...values,
  ])
}
