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
import { Textarea } from './components/ui/textarea'
import { GherkinEditor } from './gherkin-editor'
import type { GherkinCatalog } from './gherkin-language'
import { SpecificationMetadataForm } from './specification-metadata'
import { SpecificationOutline } from './specification-outline'

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

const emptyCatalog: GherkinCatalog = { tags: [], steps: [] }

function reasonMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
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
  namespaces?: readonly string[]
  linkTemplates?: Readonly<Record<string, string>>
  api: <T>(path: string, init?: RequestInit) => Promise<T>
  onCatalogChange: () => Promise<void>
  onCreated?: (uri: string) => void
  onError: (message: string | undefined) => void
  onModeChange?: (mode: 'view' | 'edit') => void
}) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [buffer, setBuffer] = useState<SpecificationBuffer>()
  const [source, setSource] = useState('')
  const [savedSource, setSavedSource] = useState('')
  const [catalog, setCatalog] = useState<GherkinCatalog>(emptyCatalog)
  const [prompt, setPrompt] = useState('')
  const [newUri, setNewUri] = useState('')
  const [review, setReview] = useState<ReviewState>()
  const [conflict, setConflict] = useState<ConflictState>()
  const [discardOpen, setDiscardOpen] = useState(false)
  const dirtyRef = useRef(false)
  const dirty = source !== savedSource
  dirtyRef.current = dirty

  async function load(uri: string) {
    const loaded = await props.api<SpecificationBuffer>(
      `/api/documents?uri=${encodeURIComponent(uri)}`,
    )
    setBuffer(loaded)
    setSource(loaded.source)
    setSavedSource(loaded.source)
    setConflict(undefined)
    const nextCatalog = await props
      .api<GherkinCatalog>('/api/documents/completions')
      .catch(() => emptyCatalog)
    setCatalog(nextCatalog)
  }

  const loadRef = useRef(load)
  const catalogRef = useRef(props.onCatalogChange)
  const errorRef = useRef(props.onError)
  const modeChangeRef = useRef(props.onModeChange)
  loadRef.current = load
  catalogRef.current = props.onCatalogChange
  errorRef.current = props.onError
  modeChangeRef.current = props.onModeChange

  function setEditorMode(next: 'view' | 'edit') {
    setMode(next)
    modeChangeRef.current?.(next)
  }

  useEffect(() => {
    setMode('view')
    modeChangeRef.current?.('view')
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
    const socket = new WebSocket(
      `${protocol}//${location.host}/api/workspace/events`,
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
      const nextConflict = conflictFromReason(reason)
      if (!nextConflict) throw reason
      setReview(undefined)
      setConflict(nextConflict)
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
    setReview(undefined)
    setConflict(undefined)
    await props.onCatalogChange()
  }

  async function save() {
    props.onError(undefined)
    try {
      const preview = await props.api<SpecificationPreview>(
        '/api/documents/preview',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ uri: buffer?.uri, source }),
        },
      )
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
      const proposal = await props.api<SpecificationPreview>(
        '/api/documents/propose',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt,
            uri,
            currentSource: creating ? undefined : source,
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

  function requestView() {
    if (dirty) {
      setDiscardOpen(true)
      return
    }
    setEditorMode('view')
  }

  function discardEdits() {
    if (!buffer) return
    setSource(buffer.source)
    setSavedSource(buffer.source)
    setDiscardOpen(false)
    setEditorMode('view')
  }

  if (!buffer) {
    return (
      <p className="text-sm text-muted-foreground">Opening Specification…</p>
    )
  }

  return (
    <div
      className={
        mode === 'edit' ? 'flex min-h-0 flex-1 flex-col gap-3' : 'space-y-3'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p
            role="status"
            aria-label="Active model"
            className="font-mono text-xs text-muted-foreground"
          >
            {props.model
              ? `${props.model.provider} / ${props.model.name}`
              : 'Model not configured'}
          </p>
          {mode === 'edit' && dirty ? (
            <p
              role="status"
              className="font-mono text-xs text-muted-foreground"
            >
              Unsaved Gherkin
            </p>
          ) : null}
        </div>
        {mode === 'view' ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditorMode('edit')}
          >
            Edit Specification
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={requestView}>
              View Specification
            </Button>
            <Button type="button" onClick={() => void save()} disabled={!dirty}>
              Save Specification
            </Button>
          </div>
        )}
      </div>
      {mode === 'view' ? (
        <>
          <SpecificationMetadataForm
            key={buffer.uri}
            buffer={buffer}
            namespaces={props.namespaces ?? []}
            templates={props.linkTemplates}
            api={props.api}
            onReview={setReview}
            onWrite={write}
            onError={props.onError}
          />
          <SpecificationOutline specification={buffer.specification} />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <GherkinEditor
            source={source}
            catalog={catalog}
            onChange={setSource}
          />
          <div className="space-y-2 rounded-lg border border-border bg-card p-3">
            <Label htmlFor="specification-prompt">AI assistance</Label>
            <Textarea
              id="specification-prompt"
              aria-label="AI prompt"
              placeholder="Describe a change or a new Specification"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className="space-y-1">
              <Label htmlFor="new-specification-uri">
                New Specification path
              </Label>
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
        </div>
      )}
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
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Discard unsaved Gherkin?</DialogTitle>
            <DialogDescription>
              View mode will reload the last saved Specification and drop local
              edits.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDiscardOpen(false)}
            >
              Keep editing
            </Button>
            <Button type="button" onClick={discardEdits}>
              Discard edits
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
