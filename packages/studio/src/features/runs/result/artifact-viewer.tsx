import type { TestArtifact, TestResultState } from '@pickle-spec/runner'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import {
  type ArtifactLoadFailure,
  artifactLoadFailureGuidance,
  artifactUrl,
  artifactViewerKind,
} from './result-evidence'

type ArtifactViewerProps = {
  artifact: TestArtifact
  resultState: TestResultState
  scenarioName: string
  stepText: string
}

type TextLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; text: string }
  | { kind: 'error'; failure: ArtifactLoadFailure; detail?: string }

const maximumInlineLogBytes = 10 * 1024 * 1024
const maximumRenderedLogLines = 1_000
const oversizedLogDetail =
  'This log is larger than the 10 MiB inline-view limit. Download it to inspect the complete file.'

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function failedResponse(response: Response): TextLoadState {
  return {
    kind: 'error',
    failure: response.status === 404 ? 'missing' : 'load-failed',
    detail: `Artifact request returned ${response.status}.`,
  }
}

function oversizedLog(
  sizeBytes: number | undefined,
): TextLoadState | undefined {
  return sizeBytes !== undefined && sizeBytes > maximumInlineLogBytes
    ? { kind: 'error', failure: 'load-failed', detail: oversizedLogDetail }
    : undefined
}

async function fetchTextArtifact(
  href: string,
  signal: AbortSignal,
): Promise<TextLoadState> {
  const metadata = await fetch(href, { method: 'HEAD', signal })
  if (!metadata.ok) return failedResponse(metadata)
  const contentLength = Number(metadata.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maximumInlineLogBytes) {
    return { kind: 'error', failure: 'load-failed', detail: oversizedLogDetail }
  }
  const response = await fetch(href, { signal })
  if (!response.ok) return failedResponse(response)
  const bytes = await response.arrayBuffer()
  try {
    return {
      kind: 'loaded',
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    }
  } catch {
    return { kind: 'error', failure: 'corrupt' }
  }
}

async function classifyMediaFailure(
  href: string,
): Promise<ArtifactLoadFailure> {
  try {
    const response = await fetch(href, { method: 'HEAD' })
    if (response.status === 404) return 'missing'
    return response.ok ? 'corrupt' : 'load-failed'
  } catch {
    return 'load-failed'
  }
}

function ImageArtifact(props: ArtifactViewerProps) {
  const href = artifactUrl(props.artifact.path)
  const [revision, setRevision] = useState(0)
  const [failure, setFailure] = useState<ArtifactLoadFailure>()
  const [previewOpen, setPreviewOpen] = useState(false)
  const alt = `${props.artifact.kind} from ${props.resultState} result for ${props.scenarioName}: ${props.stepText}`
  const previewSrc = `${href}&preview=${revision}`
  if (failure) {
    return (
      <ArtifactFailure
        failure={failure}
        action="Retry image preview"
        onRetry={() => {
          setRevision((value) => value + 1)
          setFailure(undefined)
        }}
      />
    )
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        aria-label="Open screenshot preview"
        aria-haspopup="dialog"
        className="h-auto w-full cursor-zoom-in justify-start overflow-hidden border-border bg-muted/20 p-0 hover:bg-muted/30"
        onClick={() => setPreviewOpen(true)}
      >
        <img
          key={revision}
          alt={alt}
          src={previewSrc}
          loading="lazy"
          className="max-h-[32rem] w-full object-contain"
          onError={() => void classifyMediaFailure(href).then(setFailure)}
        />
      </Button>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-[min(96vw,80rem)]">
          <DialogHeader>
            <DialogTitle>{props.artifact.kind}</DialogTitle>
            <DialogDescription>{props.stepText}</DialogDescription>
          </DialogHeader>
          <img
            alt={alt}
            src={previewSrc}
            className="max-h-[75vh] w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

function VideoArtifact(props: ArtifactViewerProps) {
  const [state, setState] = useState<
    'idle' | 'loaded' | { failure: ArtifactLoadFailure }
  >('idle')
  if (typeof state === 'object') {
    return (
      <ArtifactFailure
        failure={state.failure}
        action="Retry recording preview"
        onRetry={() => setState('idle')}
      />
    )
  }
  if (state === 'idle') {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-4 text-center text-muted-foreground">
        <p>The recording stays unloaded until you choose to play it.</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => setState('loaded')}
        >
          Load recording
        </Button>
      </div>
    )
  }
  return (
    // biome-ignore lint/a11y/useMediaCaption: Mobile screen recordings do not contain an audio track.
    <video
      aria-label={`Recording for ${props.scenarioName}: ${props.stepText}`}
      controls
      playsInline
      preload="metadata"
      className="max-h-[32rem] w-full rounded-md border border-border bg-black"
      onError={() =>
        void classifyMediaFailure(artifactUrl(props.artifact.path)).then(
          (failure) => setState({ failure }),
        )
      }
    >
      <source
        src={artifactUrl(props.artifact.path)}
        type={props.artifact.mediaType}
      />
      This browser cannot play this recording. Download it instead.
    </video>
  )
}

function TextArtifact(props: ArtifactViewerProps) {
  const [loadState, setLoadState] = useState<TextLoadState>({ kind: 'idle' })
  const [query, setQuery] = useState('')
  const request = useRef<AbortController | undefined>(undefined)
  useEffect(
    () => () => {
      request.current?.abort()
    },
    [],
  )

  async function loadText() {
    const sizeFailure = oversizedLog(props.artifact.sizeBytes)
    if (sizeFailure) {
      setLoadState(sizeFailure)
      return
    }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoadState({ kind: 'loading' })
    try {
      setLoadState(
        await fetchTextArtifact(
          artifactUrl(props.artifact.path),
          controller.signal,
        ),
      )
    } catch (reason) {
      if (controller.signal.aborted) return
      setLoadState({
        kind: 'error',
        failure: 'load-failed',
        detail: errorMessage(reason),
      })
    }
  }

  if (loadState.kind !== 'loaded') {
    return <UnloadedTextArtifact state={loadState} onLoad={loadText} />
  }

  return (
    <LoadedTextArtifact
      artifactPath={props.artifact.path}
      text={loadState.text}
      query={query}
      onQueryChange={setQuery}
    />
  )
}

function UnloadedTextArtifact(props: {
  state: Exclude<TextLoadState, { kind: 'loaded' }>
  onLoad: () => Promise<void>
}) {
  const guidance =
    props.state.kind === 'error'
      ? artifactLoadFailureGuidance(props.state.failure)
      : 'The device log stays unloaded until you need to search it.'
  let label = 'Load device log'
  if (props.state.kind === 'loading') label = 'Loading device log…'
  else if (props.state.kind === 'error') label = 'Retry loading device log'
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-4 text-center text-muted-foreground">
      <p>{guidance}</p>
      {props.state.kind === 'error' && props.state.detail ? (
        <p className="break-words text-xs">{props.state.detail}</p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={props.state.kind === 'loading'}
        onClick={() => void props.onLoad()}
      >
        {label}
      </Button>
    </div>
  )
}

function LoadedTextArtifact(props: {
  artifactPath: string
  text: string
  query: string
  onQueryChange: (query: string) => void
}) {
  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    props.onQueryChange(event.target.value)
  }

  const normalizedQuery = props.query.toLocaleLowerCase()
  const matchingLines = props.text
    .split('\n')
    .filter(
      (line) =>
        !normalizedQuery || line.toLocaleLowerCase().includes(normalizedQuery),
    )
  const renderedLines = matchingLines.slice(0, maximumRenderedLogLines)
  return (
    <div className="min-w-0 space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`device-log-search-${props.artifactPath}`}>
          Search device log
        </Label>
        <Input
          id={`device-log-search-${props.artifactPath}`}
          type="search"
          value={props.query}
          onChange={handleQueryChange}
          placeholder="Find text in the complete log"
        />
      </div>
      {matchingLines.length > maximumRenderedLogLines ? (
        <p className="text-xs text-muted-foreground">
          Showing the first {maximumRenderedLogLines.toLocaleString()} of{' '}
          {matchingLines.length.toLocaleString()} matching lines. Refine the
          search or download the complete log.
        </p>
      ) : null}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/20 p-3 font-mono text-xs">
        {renderedLines.join('\n') || 'No device-log lines match this search.'}
      </pre>
    </div>
  )
}

function ArtifactFailure(props: {
  failure: ArtifactLoadFailure
  action: string
  onRetry: () => void
}) {
  return (
    <div
      role="status"
      className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-4 text-center text-muted-foreground"
    >
      <p>{artifactLoadFailureGuidance(props.failure)}</p>
      <Button type="button" variant="outline" onClick={props.onRetry}>
        {props.action}
      </Button>
    </div>
  )
}

export function ArtifactViewer(props: ArtifactViewerProps) {
  const viewer = artifactViewerKind(props.artifact)
  if (viewer === 'image') return <ImageArtifact {...props} />
  if (viewer === 'video') return <VideoArtifact {...props} />
  if (viewer === 'text') return <TextArtifact {...props} />
  return (
    <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-muted-foreground">
      This artifact has no inline viewer. Download it to inspect the original
      file.
    </div>
  )
}
