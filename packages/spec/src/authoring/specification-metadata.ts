import type { Feature } from '@cucumber/messages'
import type { SpecificationState } from '../identity/identity'
import {
  applyReplacements,
  offsetAt,
  tagReplacement,
} from './source-operations'
import { parseGherkinDocument, tagNames } from './specification-document'

export interface ExternalLink {
  namespace: string
  id: string
}

export interface SpecificationMetadata {
  state?: SpecificationState
  tags?: readonly string[]
  links?: readonly ExternalLink[]
}

const stateTagPrefix = '@pickle:state:'
const idTagPrefix = '@pickle:id:'
const requiresTagPrefix = '@pickle:requires:'

function normalizedTag(tag: string): string {
  const value = tag.trim()
  return value.startsWith('@') ? value : `@${value}`
}

function linkTagPrefix(namespace: string): string {
  return `@${namespace}:`
}

function isLinkTag(tag: string, namespaces: readonly string[]): boolean {
  return namespaces.some(
    (namespace) =>
      namespace.length > 0 && tag.startsWith(linkTagPrefix(namespace)),
  )
}

function featureFrom(source: string, language: string): Feature {
  const feature = parseGherkinDocument(source, language).feature
  if (!feature) throw new Error('Specification does not contain a Feature')
  return feature
}

export function parseExternalLinks(
  tags: readonly string[],
  namespaces: readonly string[],
): ExternalLink[] {
  const links: ExternalLink[] = []
  for (const tag of tags) {
    for (const namespace of namespaces) {
      const prefix = linkTagPrefix(namespace)
      if (!tag.startsWith(prefix)) continue
      const id = tag.slice(prefix.length)
      if (id) links.push({ namespace, id })
    }
  }
  return links
}

export function authorTags(
  tags: readonly string[],
  namespaces: readonly string[] = [],
): string[] {
  return tags.filter(
    (tag) => !tag.startsWith('@pickle:') && !isLinkTag(tag, namespaces),
  )
}

function nextFeatureTags(
  current: readonly string[],
  metadata: SpecificationMetadata,
): string[] {
  const linkNamespaces = [
    ...new Set((metadata.links ?? []).map((link) => link.namespace)),
  ]
  const identity = current.filter((tag) => tag.startsWith(idTagPrefix))
  const requires = current.filter((tag) => tag.startsWith(requiresTagPrefix))
  const state = metadata.state
    ? [`${stateTagPrefix}${metadata.state}`]
    : current.filter((tag) => tag.startsWith(stateTagPrefix))
  const links = metadata.links
    ? metadata.links
        .filter((link) => link.namespace.trim() && link.id.trim())
        .map(
          (link) => `${linkTagPrefix(link.namespace.trim())}${link.id.trim()}`,
        )
    : parseExternalLinks(current, linkNamespaces).map(
        (link) => `${linkTagPrefix(link.namespace)}${link.id}`,
      )
  const authors = metadata.tags
    ? authorTags(
        metadata.tags.map(normalizedTag).filter((tag) => tag.length > 1),
        linkNamespaces,
      )
    : authorTags(current, linkNamespaces)
  return [...identity, ...state, ...authors, ...links, ...requires]
}

export function applySpecificationMetadata(
  source: string,
  metadata: SpecificationMetadata,
  language = 'en',
): string {
  const feature = featureFrom(source, language)
  const replacement = tagReplacement(
    source,
    feature.tags,
    nextFeatureTags(tagNames(feature.tags), metadata),
    feature.location,
  )
  return replacement ? applyReplacements(source, [replacement]) : source
}

export function ensureSpecificationState(
  source: string,
  state: SpecificationState,
  language = 'en',
): string {
  const feature = featureFrom(source, language)
  const current = feature.tags.find((tag) =>
    tag.name.startsWith(stateTagPrefix),
  )
  const nextTag = `${stateTagPrefix}${state}`
  if (current?.name === nextTag) return source
  if (current) {
    const start = offsetAt(source, current.location)
    return applyReplacements(source, [
      { start, end: start + current.name.length, text: nextTag },
    ])
  }
  const replacement = tagReplacement(
    source,
    feature.tags,
    [...tagNames(feature.tags), nextTag],
    feature.location,
  )
  return replacement ? applyReplacements(source, [replacement]) : source
}
