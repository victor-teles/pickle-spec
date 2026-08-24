import type { TestArtifact, TestResultState } from '@pickle-spec/runner'
import { useEffect, useRef, useState } from 'react'
import { Button, ButtonLink } from './components/ui/button'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
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

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
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
    <ButtonLink
      variant="ghost"
      href={href}
      className="h-auto w-full justify-start overflow-hidden border-border bg-muted/20 p-0 hover:bg-muted/30"
    >
      <img
        key={revision}
        alt={`${props.artifact.kind} from ${props.resultState} result for ${props.scenarioName}: ${props.stepText}`}
        src={`${href}&preview=${revision}`}
        loading="lazy"
        className="max-h-[32rem] w-full object-contain"
        onError={() => void classifyMediaFailure(href).then(setFailure)}
      />
    </ButtonLink>
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
    if (
      props.artifact.sizeBytes !== undefined &&
      props.artifact.sizeBytes > maximumInlineLogBytes
    ) {
      setLoadState({
        kind: 'error',
        failure: 'load-failed',
        detail:
          'This log is larger than the 10 MiB inline-view limit. Download it to inspect the complete file.',
      })
      return
    }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoadState({ kind: 'loading' })
    try {
      const href = artifactUrl(props.artifact.path)
      const metadata = await fetch(href, {
        method: 'HEAD',
        signal: controller.signal,
      })
      if (!metadata.ok) {
        setLoadState({
          kind: 'error',
          failure: metadata.status === 404 ? 'missing' : 'load-failed',
          detail: `Artifact request returned ${metadata.status}.`,
        })
        return
      }
      const contentLength = Number(metadata.headers.get('content-length'))
      if (
        Number.isFinite(contentLength) &&
        contentLength > maximumInlineLogBytes
      ) {
        setLoadState({
          kind: 'error',
          failure: 'load-failed',
          detail:
            'This log is larger than the 10 MiB inline-view limit. Download it to inspect the complete file.',
        })
        return
      }
      const response = await fetch(href, {
        signal: controller.signal,
      })
      if (!response.ok) {
        setLoadState({
          kind: 'error',
          failure: response.status === 404 ? 'missing' : 'load-failed',
          detail: `Artifact request returned ${response.status}.`,
        })
        return
      }
      const bytes = await response.arrayBuffer()
      try {
        setLoadState({
          kind: 'loaded',
          text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        })
      } catch {
        setLoadState({ kind: 'error', failure: 'corrupt' })
      }
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
    return (
      <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-4 text-center text-muted-foreground">
        <p>
          {loadState.kind === 'error'
            ? artifactLoadFailureGuidance(loadState.failure)
            : 'The device log stays unloaded until you need to search it.'}
        </p>
        {loadState.kind === 'error' && loadState.detail ? (
          <p className="break-words text-xs">{loadState.detail}</p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={loadState.kind === 'loading'}
          onClick={() => void loadText()}
        >
          {loadState.kind === 'loading'
            ? 'Loading device log…'
            : loadState.kind === 'error'
              ? 'Retry loading device log'
              : 'Load device log'}
        </Button>
      </div>
    )
  }

  const normalizedQuery = query.toLocaleLowerCase()
  const matchingLines = loadState.text
    .split('\n')
    .filter(
      (line) =>
        !normalizedQuery || line.toLocaleLowerCase().includes(normalizedQuery),
    )
  const renderedLines = matchingLines.slice(0, maximumRenderedLogLines)
  return (
    <div className="min-w-0 space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`device-log-search-${props.artifact.path}`}>
          Search device log
        </Label>
        <Input
          id={`device-log-search-${props.artifact.path}`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
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
