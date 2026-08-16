// biome-ignore-all lint/suspicious/noArrayIndexKey: Gherkin children are ordered and may share names
import { useEffect, useRef, useState } from 'react'
import { Button } from './components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Textarea } from './components/ui/textarea'

export type StructuredStep = {
  keyword: string
  text: string
}

export type StructuredExamples = {
  name: string
  tags: string[]
  header: string[]
  rows: string[][]
}

export type StructuredScenario = {
  kind: 'scenario'
  keyword: string
  name: string
  tags: string[]
  steps: StructuredStep[]
  examples: StructuredExamples[]
}

export type StructuredBackground = {
  kind: 'background'
  name: string
  steps: StructuredStep[]
}

export type StructuredRule = {
  kind: 'rule'
  name: string
  tags: string[]
  children: Array<StructuredBackground | StructuredScenario>
}

export type StructuredChild =
  | StructuredBackground
  | StructuredScenario
  | StructuredRule

export type StructuredSpecification = {
  name: string
  tags: string[]
  children: StructuredChild[]
}

export type SpecificationBuffer = {
  uri: string
  source: string
  revision: string
  specification: StructuredSpecification
}

export type SpecificationPreview = SpecificationBuffer & { diff: string }

export type StudioAuthoringModel = {
  provider: string
  name: string
}

type ReviewState = {
  title: string
  description: string
  diff: string
  confirmLabel: string
  onConfirm: () => Promise<void>
}

type ConflictState = {
  diskSource: string
  revision: string
  diff: string
}

type DiskChangedEvent = {
  type: string
  uri: string
  source: string
  revision: string
}

type DocumentConflictPayload = {
  code: 'conflict'
  diskSource: string
  revision: string
  diff: string
}

function reasonMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

function cloneSpecification(
  specification: StructuredSpecification,
): StructuredSpecification {
  return structuredClone(specification)
}

function tagsInput(tags: readonly string[]): string {
  return tags.join(' ')
}

function parseTags(value: string): string[] {
  return value.split(/\s+/).filter((tag) => tag.length > 0)
}

function conflictFromReason(reason: unknown): ConflictState | undefined {
  if (!(reason instanceof Error)) return
  try {
    const payload = JSON.parse(reason.message) as DocumentConflictPayload
    if (payload.code !== 'conflict') return
    return {
      diskSource: payload.diskSource,
      revision: payload.revision,
      diff: payload.diff,
    }
  } catch {
    return
  }
}

export function SpecificationEditor(props: {
  uri: string
  model?: StudioAuthoringModel
  api: <T>(path: string, init?: RequestInit) => Promise<T>
  onCatalogChange: () => Promise<void>
  onCreated?: (uri: string) => void
  onError: (message: string | undefined) => void
}) {
  const [view, setView] = useState<'structured' | 'source'>('structured')
  const [buffer, setBuffer] = useState<SpecificationBuffer>()
  const [source, setSource] = useState('')
  const [specification, setSpecification] = useState<StructuredSpecification>()
  const [savedSource, setSavedSource] = useState('')
  const [formDirty, setFormDirty] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [newUri, setNewUri] = useState('')
  const [review, setReview] = useState<ReviewState>()
  const [conflict, setConflict] = useState<ConflictState>()
  const dirtyRef = useRef(false)
  const dirty = source !== savedSource || formDirty
  dirtyRef.current = dirty

  async function load(uri: string) {
    const loaded = await props.api<SpecificationBuffer>(
      `/api/documents?uri=${encodeURIComponent(uri)}`,
    )
    setBuffer(loaded)
    setSource(loaded.source)
    setSavedSource(loaded.source)
    setSpecification(cloneSpecification(loaded.specification))
    setFormDirty(false)
    setConflict(undefined)
  }

  const loadRef = useRef(load)
  const catalogRef = useRef(props.onCatalogChange)
  const errorRef = useRef(props.onError)
  loadRef.current = load
  catalogRef.current = props.onCatalogChange
  errorRef.current = props.onError

  useEffect(() => {
    let cancelled = false
    void loadRef.current(props.uri).catch((reason: unknown) => {
      if (!cancelled) errorRef.current(reasonMessage(reason))
    })
    return () => {
      cancelled = true
    }
  }, [props.uri])

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const token = new URLSearchParams(location.search).get('token') ?? ''
    const socket = new WebSocket(
      `${protocol}//${location.host}/api/workspace/events?token=${encodeURIComponent(token)}`,
    )
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as DiskChangedEvent
      if (event.type !== 'disk-changed') return
      void catalogRef.current()
      if (event.uri !== props.uri) return
      if (!dirtyRef.current) {
        void loadRef.current(props.uri)
        return
      }
      setConflict({
        diskSource: event.source,
        revision: event.revision,
        diff: '',
      })
    }
    return () => socket.close()
  }, [props.uri])

  function updateSpecification(
    updater: (current: StructuredSpecification) => void,
  ) {
    setFormDirty(true)
    setSpecification((current) => {
      if (!current) return current
      const next = cloneSpecification(current)
      updater(next)
      return next
    })
  }

  function applyPreview(preview: SpecificationPreview) {
    setSource(preview.source)
    setSpecification(cloneSpecification(preview.specification))
    setBuffer((current) =>
      current
        ? {
            ...current,
            source: preview.source,
            specification: preview.specification,
          }
        : current,
    )
    return preview
  }

  async function previewStructured() {
    if (!buffer || !specification) return
    return applyPreview(
      await props.api<SpecificationPreview>('/api/documents/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          uri: buffer.uri,
          source: buffer.source,
          specification,
          diffAgainst: savedSource,
        }),
      }),
    )
  }

  async function previewSource() {
    if (!buffer) return
    return applyPreview(
      await props.api<SpecificationPreview>('/api/documents/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uri: buffer.uri, source }),
      }),
    )
  }

  async function write(
    nextSource: string,
    options: { create?: boolean; uri?: string } = {},
  ) {
    if (!buffer) return
    const uri = options.uri ?? buffer.uri
    let written: SpecificationBuffer
    try {
      written = await props.api<SpecificationBuffer>('/api/documents', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          uri,
          source: nextSource,
          expectedRevision: options.create ? undefined : buffer.revision,
          create: options.create,
        }),
      })
    } catch (reason) {
      const conflict = conflictFromReason(reason)
      if (!conflict) throw reason
      setReview(undefined)
      setConflict(conflict)
      return
    }
    if (options.create && options.uri && options.uri !== buffer.uri) {
      setReview(undefined)
      setConflict(undefined)
      await props.onCatalogChange()
      props.onCreated?.(options.uri)
      return
    }
    setBuffer(written)
    setSource(written.source)
    setSavedSource(written.source)
    setSpecification(cloneSpecification(written.specification))
    setFormDirty(false)
    setReview(undefined)
    setConflict(undefined)
    await props.onCatalogChange()
  }

  async function saveStructured() {
    props.onError(undefined)
    try {
      const preview = await previewStructured()
      if (!preview) return
      setReview({
        title: 'Review source diff',
        description:
          'Structured edits write this Gherkin diff. Confirm before the Specification file changes.',
        diff: preview.diff || 'No source changes.',
        confirmLabel: 'Write source',
        onConfirm: () => write(preview.source),
      })
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  async function saveSource() {
    props.onError(undefined)
    try {
      const preview = await previewSource()
      if (!preview) return
      await write(preview.source)
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  async function propose() {
    if (!buffer) return
    props.onError(undefined)
    try {
      const creating = Boolean(newUri.trim())
      const uri = creating ? newUri.trim() : buffer.uri
      const currentSource =
        !creating && view === 'structured'
          ? (await previewStructured())?.source
          : source
      const proposal = await props.api<SpecificationPreview>(
        '/api/documents/propose',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt,
            uri,
            currentSource: creating ? undefined : currentSource,
          }),
        },
      )
      setReview({
        title: 'Review AI proposal',
        description:
          'AI assistance proposes Gherkin. Accept to write the Specification after review.',
        diff: proposal.diff,
        confirmLabel: 'Accept proposal',
        onConfirm: () =>
          write(proposal.source, creating ? { create: true, uri } : {}),
      })
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  async function changeView(next: string) {
    const selected = next === 'source' ? 'source' : 'structured'
    props.onError(undefined)
    try {
      if (selected === 'source' && view === 'structured')
        await previewStructured()
      if (selected === 'structured' && view === 'source') await previewSource()
      setView(selected)
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  if (!buffer || !specification) {
    return (
      <p className="text-sm text-muted-foreground">Opening Specification…</p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          role="status"
          aria-label="Active model"
          className="font-mono text-xs text-muted-foreground"
        >
          {props.model
            ? `${props.model.provider} / ${props.model.name}`
            : 'Model not configured'}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void (view === 'structured' ? saveStructured() : saveSource())
          }
        >
          Save Specification
        </Button>
      </div>
      <Tabs value={view} onValueChange={changeView}>
        <TabsList aria-label="Specification views">
          <TabsTrigger value="structured">Structured</TabsTrigger>
          <TabsTrigger value="source">Source</TabsTrigger>
        </TabsList>
        <TabsContent value="structured" className="space-y-4 pt-3">
          <StructuredForm
            specification={specification}
            onChange={updateSpecification}
          />
        </TabsContent>
        <TabsContent value="source" className="space-y-3 pt-3">
          <Label htmlFor="specification-source">Gherkin source</Label>
          <Textarea
            id="specification-source"
            aria-label="Gherkin source"
            className="min-h-64"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </TabsContent>
      </Tabs>
      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <Label htmlFor="specification-prompt">AI assistance</Label>
        <Textarea
          id="specification-prompt"
          aria-label="AI prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="space-y-1">
          <Label htmlFor="new-specification-uri">New Specification path</Label>
          <Input
            id="new-specification-uri"
            aria-label="New Specification path"
            placeholder="features/search.feature"
            value={newUri}
            onChange={(event) => setNewUri(event.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!prompt.trim()}
          onClick={() => void propose()}
        >
          Propose Specification
        </Button>
      </div>
      <Dialog
        open={Boolean(review)}
        onOpenChange={(open) => {
          if (!open) setReview(undefined)
        }}
      >
        <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{review?.title}</DialogTitle>
            <DialogDescription>{review?.description}</DialogDescription>
          </DialogHeader>
          <section
            aria-label="Source diff"
            className="max-h-80 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs"
          >
            <pre>{review?.diff}</pre>
          </section>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReview(undefined)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() =>
                void review?.onConfirm().catch((reason: unknown) => {
                  props.onError(reasonMessage(reason))
                })
              }
            >
              {review?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(conflict)}
        onOpenChange={(open) => {
          if (!open) setConflict(undefined)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Specification changed on disk</DialogTitle>
            <DialogDescription>
              {dirty
                ? 'This buffer has local edits. Review the disk version before writing.'
                : 'The Specification file changed outside Studio.'}
            </DialogDescription>
          </DialogHeader>
          <section
            aria-label="Disk version"
            className="max-h-80 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs"
          >
            <pre>{conflict?.diff || conflict?.diskSource}</pre>
          </section>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void load(props.uri)}
            >
              Load from disk
            </Button>
            <Button type="button" onClick={() => setConflict(undefined)}>
              Keep editing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StructuredForm(props: {
  specification: StructuredSpecification
  onChange: (updater: (current: StructuredSpecification) => void) => void
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="feature-name">Feature</Label>
          <Input
            id="feature-name"
            aria-label="Feature name"
            value={props.specification.name}
            onChange={(event) =>
              props.onChange((current) => {
                current.name = event.target.value
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="feature-tags">Feature tags</Label>
          <Input
            id="feature-tags"
            aria-label="Feature tags"
            value={tagsInput(props.specification.tags)}
            onChange={(event) =>
              props.onChange((current) => {
                current.tags = parseTags(event.target.value)
              })
            }
          />
        </div>
      </div>
      {props.specification.children.map((child, index) => (
        <ChildEditor
          key={`${child.kind}-${index}`}
          child={child}
          onChange={(next) =>
            props.onChange((current) => {
              current.children[index] = next
            })
          }
        />
      ))}
    </div>
  )
}

function ChildEditor(props: {
  child: StructuredChild
  onChange: (child: StructuredChild) => void
}) {
  if (props.child.kind === 'background') {
    const background = props.child
    return (
      <StepsEditor
        title={background.name || 'Background'}
        steps={background.steps}
        onChange={(steps) => props.onChange({ ...background, steps })}
      />
    )
  }
  if (props.child.kind === 'rule') {
    const rule = props.child
    return (
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Rule</Label>
            <Input
              aria-label="Rule name"
              value={rule.name}
              onChange={(event) =>
                props.onChange({ ...rule, name: event.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Rule tags</Label>
            <Input
              aria-label="Rule tags"
              value={tagsInput(rule.tags)}
              onChange={(event) =>
                props.onChange({
                  ...rule,
                  tags: parseTags(event.target.value),
                })
              }
            />
          </div>
        </div>
        {rule.children.map((child, index) => (
          <ChildEditor
            key={`${child.kind}-${index}`}
            child={child}
            onChange={(next) => {
              const children = [...rule.children]
              children[index] = next as
                | StructuredBackground
                | StructuredScenario
              props.onChange({ ...rule, children })
            }}
          />
        ))}
      </div>
    )
  }
  const scenario = props.child
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Scenario</Label>
          <Input
            aria-label="Scenario name"
            value={scenario.name}
            onChange={(event) =>
              props.onChange({ ...scenario, name: event.target.value })
            }
          />
        </div>
        <div className="space-y-1">
          <Label>Scenario tags</Label>
          <Input
            aria-label="Scenario tags"
            value={tagsInput(scenario.tags)}
            onChange={(event) =>
              props.onChange({
                ...scenario,
                tags: parseTags(event.target.value),
              })
            }
          />
        </div>
      </div>
      <StepsEditor
        title="Steps"
        steps={scenario.steps}
        onChange={(steps) => props.onChange({ ...scenario, steps })}
      />
      {scenario.examples.map((examples, index) => (
        <ExamplesEditor
          key={`${examples.name}-${index}`}
          examples={examples}
          onChange={(next) => {
            const list = [...scenario.examples]
            list[index] = next
            props.onChange({ ...scenario, examples: list })
          }}
        />
      ))}
    </div>
  )
}

function StepsEditor(props: {
  title: string
  steps: StructuredStep[]
  onChange: (steps: StructuredStep[]) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">{props.title}</p>
      {props.steps.map((step, index) => (
        <div
          key={`${step.keyword}-${index}`}
          className="grid grid-cols-[6rem_1fr] gap-2"
        >
          <Input
            aria-label={`Step ${index + 1} keyword`}
            value={step.keyword}
            onChange={(event) => {
              const steps = [...props.steps]
              steps[index] = { ...step, keyword: event.target.value }
              props.onChange(steps)
            }}
          />
          <Input
            aria-label={`Step ${index + 1} text`}
            value={step.text}
            onChange={(event) => {
              const steps = [...props.steps]
              steps[index] = { ...step, text: event.target.value }
              props.onChange(steps)
            }}
          />
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          props.onChange([...props.steps, { keyword: 'Then', text: '' }])
        }
      >
        Add step
      </Button>
    </div>
  )
}

function ExamplesEditor(props: {
  examples: StructuredExamples
  onChange: (examples: StructuredExamples) => void
}) {
  return (
    <div className="space-y-2">
      <Label>Examples</Label>
      <Input
        aria-label="Examples name"
        value={props.examples.name}
        onChange={(event) =>
          props.onChange({ ...props.examples, name: event.target.value })
        }
      />
      <Input
        aria-label="Examples tags"
        value={tagsInput(props.examples.tags)}
        onChange={(event) =>
          props.onChange({
            ...props.examples,
            tags: parseTags(event.target.value),
          })
        }
      />
      <Table aria-label="Examples data">
        <TableHeader>
          <TableRow>
            {props.examples.header.map((cell, index) => (
              <TableHead key={`${cell}-${index}`} className="px-2 py-1">
                <Input
                  aria-label={`Examples header ${index + 1}`}
                  value={cell}
                  onChange={(event) => {
                    const header = [...props.examples.header]
                    header[index] = event.target.value
                    props.onChange({ ...props.examples, header })
                  }}
                />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.examples.rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <TableCell
                  key={`${rowIndex}-${cellIndex}`}
                  className="px-2 py-1"
                >
                  <Input
                    aria-label={`Examples row ${rowIndex + 1} ${props.examples.header[cellIndex] ?? `column ${cellIndex + 1}`}`}
                    value={cell}
                    onChange={(event) => {
                      const rows = props.examples.rows.map((current) => [
                        ...current,
                      ])
                      rows[rowIndex]![cellIndex] = event.target.value
                      props.onChange({ ...props.examples, rows })
                    }}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          props.onChange({
            ...props.examples,
            rows: [...props.examples.rows, props.examples.header.map(() => '')],
          })
        }
      >
        Add Examples row
      </Button>
    </div>
  )
}
