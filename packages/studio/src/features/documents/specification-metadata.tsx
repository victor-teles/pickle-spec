import { useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button, ButtonLink } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import type { StudioApi } from '../../lib/studio-api'
import type {
  SpecificationBuffer,
  SpecificationPreview,
} from './specification-editor'

const specificationStates = ['draft', 'active', 'deprecated'] as const
type SpecificationState = (typeof specificationStates)[number]

type ExternalLink = { namespace: string; id: string }

function parseState(tags: readonly string[]): SpecificationState {
  const tag = tags.find((value) => value.startsWith('@pickle:state:'))
  const state = tag?.slice('@pickle:state:'.length)
  return specificationStates.find((value) => value === state) ?? 'active'
}

function parseAuthorTags(
  tags: readonly string[],
  namespaces: readonly string[],
) {
  return tags.filter((tag) => {
    if (tag.startsWith('@pickle:')) return false
    return !namespaces.some(
      (namespace) => namespace && tag.startsWith(`@${namespace}:`),
    )
  })
}

function parseLinks(
  tags: readonly string[],
  namespaces: readonly string[],
): ExternalLink[] {
  const links: ExternalLink[] = []
  for (const tag of tags) {
    for (const namespace of namespaces) {
      const prefix = `@${namespace}:`
      if (tag.startsWith(prefix) && tag.length > prefix.length) {
        links.push({ namespace, id: tag.slice(prefix.length) })
      }
    }
  }
  return links
}

function reasonMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

function LinkLabel(props: { link: ExternalLink; href?: string }) {
  const label = `${props.link.namespace}:${props.link.id}`
  if (!props.href) return <span className="font-mono text-xs">{label}</span>
  return (
    <ButtonLink variant="link" className="h-auto px-0" href={props.href}>
      {label}
    </ButtonLink>
  )
}

type SpecificationMetadataProps = {
  buffer: SpecificationBuffer
  source: string
  namespaces: readonly string[]
  templates?: Readonly<Record<string, string>>
  api: StudioApi
  onChange: (source: string) => void
  onError: (message: string | undefined) => void
}

export function SpecificationMetadataForm(props: SpecificationMetadataProps) {
  const metadata = useSpecificationMetadata(props)
  return metadata.editing ? (
    <MetadataEditor {...props} {...metadata} />
  ) : (
    <MetadataSummary {...props} {...metadata} />
  )
}

function useSpecificationMetadata(props: SpecificationMetadataProps) {
  const tags = props.buffer.specification.tags
  const [editing, setEditing] = useState(false)
  const [state, setState] = useState<SpecificationState>(() => parseState(tags))
  const [tagText, setTagText] = useState(() =>
    parseAuthorTags(tags, props.namespaces).join(' '),
  )
  const [links, setLinks] = useState<ExternalLink[]>(() =>
    parseLinks(tags, props.namespaces),
  )
  const [namespace, setNamespace] = useState(props.namespaces[0] ?? '')
  const [linkId, setLinkId] = useState('')

  useEffect(() => {
    const nextTags = props.buffer.specification.tags
    setState(parseState(nextTags))
    setTagText(parseAuthorTags(nextTags, props.namespaces).join(' '))
    setLinks(parseLinks(nextTags, props.namespaces))
  }, [props.buffer, props.namespaces])

  const save = async () => {
    props.onError(undefined)
    try {
      const preview = await previewMetadata(props, state, tagText, links)
      if (!preview.diff) {
        setEditing(false)
        return
      }
      props.onChange(preview.source)
      setEditing(false)
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  const authorTags = tagText
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean)

  return {
    authorTags,
    editing,
    linkId,
    links,
    namespace,
    save,
    setEditing,
    setLinkId,
    setLinks,
    setNamespace,
    setState,
    setTagText,
    state,
    tagText,
  }
}

function previewMetadata(
  props: SpecificationMetadataProps,
  state: SpecificationState,
  tagText: string,
  links: readonly ExternalLink[],
): Promise<SpecificationPreview> {
  return props.api('/api/documents/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      uri: props.buffer.uri,
      source: props.source,
      metadata: {
        state,
        tags: tagText
          .split(/\s+/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        links,
      },
    }),
  })
}

type MetadataState = ReturnType<typeof useSpecificationMetadata>

function MetadataSummary(props: SpecificationMetadataProps & MetadataState) {
  return (
    <section
      aria-label="Specification metadata"
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
    >
      <Badge>{props.state}</Badge>
      {props.authorTags.length > 0 ? (
        <p className="min-w-0 truncate font-mono text-[0.625rem] leading-4 text-muted-foreground">
          {props.authorTags.join(' ')}
        </p>
      ) : null}
      <MetadataLinks links={props.links} templates={props.templates} />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => props.setEditing(true)}
      >
        Edit metadata
      </Button>
    </section>
  )
}

function MetadataEditor(props: SpecificationMetadataProps & MetadataState) {
  return (
    <section
      aria-label="Specification metadata"
      className="space-y-3 rounded-lg border border-border bg-card px-3 py-2"
    >
      <div className="flex flex-wrap gap-1">
        {specificationStates.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={props.state === value ? 'default' : 'outline'}
            aria-pressed={props.state === value}
            onClick={() => props.setState(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <div className="space-y-1">
        <Label htmlFor="specification-tags">Tags</Label>
        <Input
          id="specification-tags"
          aria-label="Specification tags"
          value={props.tagText}
          onChange={(event) => props.setTagText(event.target.value)}
        />
      </div>
      <MetadataLinksEditor {...props} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => props.setEditing(false)}
        >
          Cancel
        </Button>
        <Button type="button" onClick={() => void props.save()}>
          Apply metadata
        </Button>
      </div>
    </section>
  )
}

function MetadataLinks(props: {
  links: readonly ExternalLink[]
  templates?: Readonly<Record<string, string>>
}) {
  if (props.links.length === 0) return null
  return (
    <ul
      aria-label="External links"
      className="flex flex-wrap items-center gap-x-2"
    >
      {props.links.map((link) => (
        <li key={`${link.namespace}:${link.id}`}>
          <LinkLabel link={link} href={linkHref(link, props.templates)} />
        </li>
      ))}
    </ul>
  )
}

function MetadataLinksEditor(
  props: MetadataState & Pick<SpecificationMetadataProps, 'templates'>,
) {
  const addLink = () => {
    props.setLinks((current) => [
      ...current,
      { namespace: props.namespace.trim(), id: props.linkId.trim() },
    ])
    props.setLinkId('')
  }
  return (
    <div className="space-y-2">
      {props.links.length === 0 ? null : (
        <ul aria-label="External links" className="space-y-1">
          {props.links.map((link) => (
            <li
              key={`${link.namespace}:${link.id}`}
              className="flex items-center justify-between gap-2 font-mono text-xs"
            >
              <LinkLabel link={link} href={linkHref(link, props.templates)} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`Remove ${link.namespace}:${link.id}`}
                onClick={() =>
                  props.setLinks((current) =>
                    current.filter(
                      (item) =>
                        item.namespace !== link.namespace ||
                        item.id !== link.id,
                    ),
                  )
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input
          aria-label="Link namespace"
          placeholder="jira"
          value={props.namespace}
          onChange={(event) => props.setNamespace(event.target.value)}
        />
        <Input
          aria-label="Link id"
          placeholder="PROJ-12"
          value={props.linkId}
          onChange={(event) => props.setLinkId(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!props.namespace.trim() || !props.linkId.trim()}
          onClick={addLink}
        >
          Add link
        </Button>
      </div>
    </div>
  )
}

function linkHref(
  link: ExternalLink,
  templates?: Readonly<Record<string, string>>,
): string | undefined {
  return templates?.[link.namespace]?.replaceAll('{id}', link.id)
}
