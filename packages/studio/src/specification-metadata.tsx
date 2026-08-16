import { useEffect, useState } from 'react'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
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

export function SpecificationMetadataForm(props: {
  buffer: SpecificationBuffer
  namespaces: readonly string[]
  templates?: Readonly<Record<string, string>>
  api: <T>(path: string, init?: RequestInit) => Promise<T>
  onReview: (input: {
    title: string
    description: string
    diff: string
    confirmLabel: string
    onConfirm: () => Promise<void>
  }) => void
  onWrite: (source: string) => Promise<void>
  onError: (message: string | undefined) => void
}) {
  const tags = props.buffer.specification.tags
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

  async function save() {
    props.onError(undefined)
    try {
      const preview = await props.api<SpecificationPreview>(
        '/api/documents/preview',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            uri: props.buffer.uri,
            source: props.buffer.source,
            metadata: {
              state,
              tags: tagText
                .split(/\s+/)
                .map((tag) => tag.trim())
                .filter(Boolean),
              links,
            },
          }),
        },
      )
      if (!preview.diff) return
      props.onReview({
        title: 'Review Specification metadata',
        description:
          'State, tags, and external links update Gherkin tags. Confirm to write the Specification.',
        diff: preview.diff,
        confirmLabel: 'Save metadata',
        onConfirm: () => props.onWrite(preview.source),
      })
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  return (
    <section
      aria-label="Specification metadata"
      className="space-y-3 rounded-lg border border-border bg-card px-4 py-3"
    >
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Specification state</p>
        <div className="flex flex-wrap gap-1">
          {specificationStates.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={state === value ? 'default' : 'outline'}
              aria-pressed={state === value}
              onClick={() => setState(value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="specification-tags">Tags</Label>
        <Input
          id="specification-tags"
          aria-label="Specification tags"
          value={tagText}
          onChange={(event) => setTagText(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">External links</p>
        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet.</p>
        ) : (
          <ul aria-label="External links" className="space-y-1">
            {links.map((link) => {
              const template = props.templates?.[link.namespace]
              const href = template
                ? template.replaceAll('{id}', link.id)
                : undefined
              return (
                <li
                  key={`${link.namespace}:${link.id}`}
                  className="flex items-center justify-between gap-2 font-mono text-xs"
                >
                  {href ? (
                    <Button variant="link" render={<a href={href} />}>
                      {link.namespace}:{link.id}
                    </Button>
                  ) : (
                    <span>
                      {link.namespace}:{link.id}
                    </span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`Remove ${link.namespace}:${link.id}`}
                    onClick={() =>
                      setLinks((current) =>
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
              )
            })}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            aria-label="Link namespace"
            placeholder="jira"
            value={namespace}
            onChange={(event) => setNamespace(event.target.value)}
          />
          <Input
            aria-label="Link id"
            placeholder="PROJ-12"
            value={linkId}
            onChange={(event) => setLinkId(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!namespace.trim() || !linkId.trim()}
            onClick={() => {
              setLinks((current) => [
                ...current,
                { namespace: namespace.trim(), id: linkId.trim() },
              ])
              setLinkId('')
            }}
          >
            Add link
          </Button>
        </div>
      </div>
      <Button type="button" onClick={() => void save()}>
        Save metadata
      </Button>
    </section>
  )
}
