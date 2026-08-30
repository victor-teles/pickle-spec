import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import type { StudioApi } from '../../lib/studio-api'
import { GherkinEditor } from './gherkin-editor'
import type { GherkinCatalog } from './gherkin-language'
import { SpecificationMetadataForm } from './specification-metadata'

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

type SpecificationEditorProps = {
  uri: string
  namespaces?: readonly string[]
  linkTemplates?: Readonly<Record<string, string>>
  api: StudioApi
  onCatalogChange: () => Promise<void>
  onCreated?: (uri: string) => void
  onError: (message: string | undefined) => void
  onModeChange?: (mode: 'view' | 'edit') => void
}

function useSpecificationEditorState() {
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
  return {
    buffer,
    catalog,
    conflict,
    dirty,
    dirtyRef,
    discardOpen,
    mode,
    newUri,
    prompt,
    review,
    savedSource,
    source,
    setBuffer,
    setCatalog,
    setConflict,
    setDiscardOpen,
    setMode,
    setNewUri,
    setPrompt,
    setReview,
    setSavedSource,
    setSource,
  }
}

type EditorState = ReturnType<typeof useSpecificationEditorState>

class SpecificationEditorController {
  constructor(
    private readonly props: SpecificationEditorProps,
    private readonly state: EditorState,
  ) {}

  setMode(mode: 'view' | 'edit'): void {
    this.state.setMode(mode)
    this.props.onModeChange?.(mode)
  }

  async load(uri: string): Promise<void> {
    const loaded = await this.props.api<SpecificationBuffer>(
      `/api/documents?uri=${encodeURIComponent(uri)}`,
    )
    this.state.setBuffer(loaded)
    this.state.setSource(loaded.source)
    this.state.setSavedSource(loaded.source)
    this.state.setConflict(undefined)
    const nextCatalog = await this.props
      .api<GherkinCatalog>('/api/documents/completions')
      .catch(() => emptyCatalog)
    this.state.setCatalog(nextCatalog)
  }

  async write(
    nextSource: string,
    options: { create?: boolean; uri?: string } = {},
  ): Promise<void> {
    if (!this.state.buffer) return
    const uri = options.uri ?? this.state.buffer.uri
    let written: SpecificationBuffer
    try {
      written = await this.props.api<SpecificationBuffer>('/api/documents', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          uri,
          source: nextSource,
          expectedRevision: options.create
            ? undefined
            : this.state.buffer.revision,
          create: options.create,
        }),
      })
    } catch (reason) {
      const nextConflict = conflictFromReason(reason)
      if (!nextConflict) throw reason
      this.state.setReview(undefined)
      this.state.setConflict(nextConflict)
      return
    }
    await this.acceptWritten(written, options, this.state.buffer.uri)
  }

  private async acceptWritten(
    written: SpecificationBuffer,
    options: { create?: boolean; uri?: string },
    currentUri: string,
  ) {
    if (options.create && options.uri && options.uri !== currentUri) {
      this.state.setReview(undefined)
      this.state.setConflict(undefined)
      await this.props.onCatalogChange()
      this.props.onCreated?.(options.uri)
      return
    }
    this.state.setBuffer(written)
    this.state.setSource(written.source)
    this.state.setSavedSource(written.source)
    this.state.setReview(undefined)
    this.state.setConflict(undefined)
    await this.props.onCatalogChange()
  }

  async save(): Promise<void> {
    this.props.onError(undefined)
    try {
      const preview = await this.props.api<SpecificationPreview>(
        '/api/documents/preview',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            uri: this.state.buffer?.uri,
            source: this.state.source,
          }),
        },
      )
      await this.write(preview.source)
    } catch (reason) {
      this.props.onError(reasonMessage(reason))
    }
  }

  async propose(): Promise<void> {
    if (!this.state.buffer) return
    this.props.onError(undefined)
    try {
      const creating = Boolean(this.state.newUri.trim())
      const uri = creating ? this.state.newUri.trim() : this.state.buffer.uri
      const proposal = await this.props.api<SpecificationPreview>(
        '/api/documents/propose',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: this.state.prompt,
            uri,
            currentSource: creating ? undefined : this.state.source,
          }),
        },
      )
      this.state.setReview({
        title: 'Review AI proposal',
        description:
          'AI assistance proposes Gherkin. Accept to write the Specification after review.',
        diff: proposal.diff,
        confirmLabel: 'Accept proposal',
        onConfirm: () =>
          this.write(proposal.source, creating ? { create: true, uri } : {}),
      })
    } catch (reason) {
      this.props.onError(reasonMessage(reason))
    }
  }

  requestView(): void {
    if (this.state.dirty) {
      this.state.setDiscardOpen(true)
      return
    }
    this.setMode('view')
  }

  discardEdits(): void {
    if (!this.state.buffer) return
    this.state.setSource(this.state.buffer.source)
    this.state.setSavedSource(this.state.buffer.source)
    this.state.setDiscardOpen(false)
    this.setMode('view')
  }
}

function useEditorSynchronization(
  props: SpecificationEditorProps,
  controller: SpecificationEditorController,
  state: EditorState,
): void {
  const controllerRef = useRef(controller)
  const catalogRef = useRef(props.onCatalogChange)
  const errorRef = useRef(props.onError)
  controllerRef.current = controller
  catalogRef.current = props.onCatalogChange
  errorRef.current = props.onError
  useEffect(
    () => synchronizeEditorDocument(props.uri, controllerRef, errorRef),
    [props.uri],
  )
  useEffect(
    () =>
      watchEditorDocument(
        props.uri,
        controllerRef,
        catalogRef,
        state.dirtyRef,
        state.setConflict,
      ),
    [props.uri, state.dirtyRef, state.setConflict],
  )
}

function synchronizeEditorDocument(
  uri: string,
  controller: React.RefObject<SpecificationEditorController>,
  error: React.RefObject<(message?: string) => void>,
) {
  controller.current.setMode('view')
  let cancelled = false
  void controller.current.load(uri).catch((reason: unknown) => {
    if (!cancelled) error.current(reasonMessage(reason))
  })
  return () => {
    cancelled = true
  }
}

function watchEditorDocument(
  uri: string,
  controller: React.RefObject<SpecificationEditorController>,
  onCatalogChange: React.RefObject<() => Promise<void>>,
  dirty: React.RefObject<boolean>,
  setConflict: EditorState['setConflict'],
) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(
    `${protocol}//${location.host}/api/workspace/events`,
  )
  socket.onmessage = (message) => {
    const event = JSON.parse(String(message.data)) as DiskChangedEvent
    if (event.type !== 'disk-changed') return
    void onCatalogChange.current()
    if (event.uri !== uri) return
    if (!dirty.current) return void controller.current.load(uri)
    setConflict({
      diskSource: event.source,
      revision: event.revision,
      diff: '',
    })
  }
  return () => socket.close()
}

export function SpecificationEditor(props: SpecificationEditorProps) {
  const state = useSpecificationEditorState()
  const controller = new SpecificationEditorController(props, state)
  useEditorSynchronization(props, controller, state)

  if (!state.buffer) {
    return (
      <p className="text-sm text-muted-foreground">Opening Specification…</p>
    )
  }
  return (
    <SpecificationEditorContent
      {...props}
      state={state}
      controller={controller}
    />
  )
}

function SpecificationEditorContent(
  props: SpecificationEditorProps & {
    state: EditorState
    controller: SpecificationEditorController
  },
) {
  const className =
    props.state.mode === 'edit'
      ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-auto'
      : undefined
  return (
    <div className={className}>
      {props.state.mode === 'view' ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => props.controller.setMode('edit')}
        >
          Edit Specification
        </Button>
      ) : (
        <EditorWorkspace {...props} />
      )}
      <ReviewDialog {...props} />
      <ConflictDialog {...props} />
      <DiscardDialog state={props.state} controller={props.controller} />
    </div>
  )
}

function EditorWorkspace(
  props: SpecificationEditorProps & {
    state: EditorState
    controller: SpecificationEditorController
  },
) {
  const { state } = props
  if (!state.buffer) return null
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {state.dirty ? (
          <p role="status" className="font-mono text-xs text-muted-foreground">
            Unsaved Gherkin
          </p>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => props.controller.requestView()}
          >
            View Specification
          </Button>
          <Button
            type="button"
            onClick={() => void props.controller.save()}
            disabled={!state.dirty}
          >
            Save Specification
          </Button>
        </div>
      </div>
      <SpecificationMetadataForm
        key={state.buffer.uri}
        buffer={state.buffer}
        source={state.source}
        namespaces={props.namespaces ?? []}
        templates={props.linkTemplates}
        api={props.api}
        onChange={state.setSource}
        onError={props.onError}
      />
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <GherkinEditor
          source={state.source}
          catalog={state.catalog}
          onChange={state.setSource}
        />
        <AiAssistance state={state} controller={props.controller} />
      </div>
    </>
  )
}

function AiAssistance(props: {
  state: EditorState
  controller: SpecificationEditorController
}) {
  return (
    <div className="space-y-2 self-start rounded-lg border border-border bg-card p-3">
      <Label htmlFor="specification-prompt">AI assistance</Label>
      <Textarea
        id="specification-prompt"
        aria-label="AI prompt"
        placeholder="Describe a change or a new Specification"
        value={props.state.prompt}
        onChange={(event) => props.state.setPrompt(event.target.value)}
      />
      <div className="space-y-1">
        <Label htmlFor="new-specification-uri">New Specification path</Label>
        <Input
          id="new-specification-uri"
          aria-label="New Specification path"
          placeholder="features/search.feature"
          value={props.state.newUri}
          onChange={(event) => props.state.setNewUri(event.target.value)}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={!props.state.prompt.trim()}
        onClick={() => void props.controller.propose()}
      >
        Propose Specification
      </Button>
    </div>
  )
}

function ReviewDialog(
  props: SpecificationEditorProps & { state: EditorState },
) {
  const review = props.state.review
  const confirm = () =>
    void review
      ?.onConfirm()
      .catch((reason: unknown) => props.onError(reasonMessage(reason)))
  return (
    <Dialog
      open={Boolean(review)}
      onOpenChange={(open) => {
        if (!open) props.state.setReview(undefined)
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
            onClick={() => props.state.setReview(undefined)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={confirm}>
            {review?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConflictDialog(
  props: SpecificationEditorProps & {
    state: EditorState
    controller: SpecificationEditorController
  },
) {
  const conflict = props.state.conflict
  return (
    <Dialog
      open={Boolean(conflict)}
      onOpenChange={(open) => {
        if (!open) props.state.setConflict(undefined)
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Specification changed on disk</DialogTitle>
          <DialogDescription>
            {props.state.dirty
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
            onClick={() => void props.controller.load(props.uri)}
          >
            Load from disk
          </Button>
          <Button
            type="button"
            onClick={() => props.state.setConflict(undefined)}
          >
            Keep editing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DiscardDialog(props: {
  state: EditorState
  controller: SpecificationEditorController
}) {
  return (
    <Dialog
      open={props.state.discardOpen}
      onOpenChange={props.state.setDiscardOpen}
    >
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
            onClick={() => props.state.setDiscardOpen(false)}
          >
            Keep editing
          </Button>
          <Button type="button" onClick={() => props.controller.discardEdits()}>
            Discard edits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
