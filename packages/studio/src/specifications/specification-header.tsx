import type { RefObject } from 'react'
import type { StudioApi } from '../app/studio-api'
import { SpecificationEditor } from '../authoring/specification-editor'
import { Button } from '../components/ui/button'
import { cn } from '../lib/utils'
import { RunControlButton } from '../runs/run-control-button'
import { isBusyOrigin, type RunOrigin } from '../runs/run-origin'
import type { StudioRunRequest, StudioSpecification } from '../server/contracts'

type SpecificationHeaderProps = {
  api: StudioApi
  authoring: boolean
  canRun: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
  linkTemplates?: Readonly<Record<string, string>>
  namespaces: readonly string[]
  onAuthoringChange: (authoring: boolean) => void
  onCancelRun: () => void
  onCatalogChange: () => Promise<void>
  onCreated: (uri: string) => void
  onError: (message: string | undefined) => void
  onRun: (request: StudioRunRequest) => void
  origin?: RunOrigin
  runId?: string
  running: boolean
  runReasons?: readonly string[]
  specification: StudioSpecification
}

function SpecificationIdentity(props: SpecificationHeaderProps) {
  return (
    <div className="min-w-0 space-y-1">
      <h1
        ref={props.headingRef}
        tabIndex={-1}
        className="studio-display text-lg leading-tight outline-none sm:text-xl"
      >
        {props.specification.name}
      </h1>
      <p className="truncate font-mono text-[0.6875rem] text-muted-foreground sm:text-xs">
        {props.specification.uri}
      </p>
    </div>
  )
}

export function SpecificationHeader(props: SpecificationHeaderProps) {
  function handleModeChange(mode: 'view' | 'edit') {
    props.onAuthoringChange(mode === 'edit')
  }

  function handleCancel() {
    props.onCancelRun()
  }

  function handleRun() {
    props.onRun({ paths: [props.specification.uri] })
  }

  return (
    <header
      className={cn(
        'specification-heading border-b border-border px-3 py-3 sm:px-5 sm:py-4',
        props.authoring
          ? 'flex min-h-0 flex-1 flex-col space-y-3'
          : 'shrink-0 space-y-3',
      )}
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <SpecificationIdentity {...props} />
        {props.authoring && props.running && props.runId ? (
          <Button type="button" variant="destructive" onClick={handleCancel}>
            Cancel test run
          </Button>
        ) : null}
      </div>
      {!props.canRun && props.runReasons?.length ? (
        <p role="status" className="text-sm text-muted-foreground">
          {props.runReasons.join(' ')}
        </p>
      ) : null}
      <div
        className={cn(
          props.authoring
            ? 'flex min-h-0 flex-1 flex-col'
            : 'flex flex-wrap items-center gap-2',
        )}
      >
        <div
          className={cn(
            props.authoring
              ? 'flex min-h-0 flex-1 flex-col'
              : 'flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:shrink-0 sm:justify-end',
          )}
        >
          {props.authoring ? null : (
            <SpecificationRunActions
              canRun={props.canRun}
              hasRunId={Boolean(props.runId)}
              onCancel={handleCancel}
              onRun={handleRun}
              origin={props.origin}
              running={props.running}
            />
          )}
          <SpecificationEditor
            uri={props.specification.uri}
            namespaces={props.namespaces}
            linkTemplates={props.linkTemplates}
            api={props.api}
            onModeChange={handleModeChange}
            onCatalogChange={props.onCatalogChange}
            onCreated={props.onCreated}
            onError={props.onError}
          />
        </div>
      </div>
    </header>
  )
}

type SpecificationRunActionsProps = {
  canRun: boolean
  hasRunId: boolean
  onCancel: () => void
  onRun: () => void
  origin?: RunOrigin
  running: boolean
}

function SpecificationRunActions(props: SpecificationRunActionsProps) {
  if (!props.canRun && !props.running) return null
  return (
    <>
      <RunControlButton
        busy={isBusyOrigin(props.origin, { kind: 'specification' })}
        blocked={props.running}
        onClick={props.onRun}
      >
        Run Specification
      </RunControlButton>
      {props.running && props.hasRunId ? (
        <Button type="button" variant="destructive" onClick={props.onCancel}>
          Cancel test run
        </Button>
      ) : null}
    </>
  )
}
