import { BrowserIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { StudioScenario } from '../../server/contracts'
import type { SpecificationsWorkbenchModel } from './specifications-workbench-model'

type PreviewEmptyStateProps = {
  model: SpecificationsWorkbenchModel
  selectedScenario?: StudioScenario
}

type PreviewEmptyCopy = {
  description: string
  title: string
}

export function PreviewEmptyState(props: PreviewEmptyStateProps) {
  const copy = previewEmptyCopy(props)
  return (
    <div className="flex min-h-72 flex-1 items-center justify-center bg-muted/10 p-6 text-center xl:min-h-0">
      <div className="max-w-sm space-y-2 text-pretty">
        <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
          <HugeiconsIcon icon={BrowserIcon} strokeWidth={1.5} aria-hidden />
        </div>
        <h3 className="text-sm font-semibold">{copy.title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {copy.description}
        </p>
      </div>
    </div>
  )
}

export function EmptyFocus() {
  return (
    <EmptyEvidenceState
      title="No Scenario selected"
      description="Choose a running or completed Scenario from the queue to inspect its evidence."
    />
  )
}

export function EmptyTimeline() {
  return (
    <EmptyEvidenceState
      title="No timeline yet"
      description="Run a Scenario to see each browser action in execution order."
    />
  )
}

export function EmptyArtifacts() {
  return (
    <EmptyEvidenceState
      title="No artifacts yet"
      description="Screenshots and recordings from the selected Scenario appear here."
    />
  )
}

export function EmptyDiagnostics() {
  return (
    <EmptyEvidenceState
      title="No diagnostics yet"
      description="Console, network, and runner diagnostics appear here."
    />
  )
}

function previewEmptyCopy(props: PreviewEmptyStateProps): PreviewEmptyCopy {
  if (props.model.kind === 'batch' && props.model.phase === 'running') {
    return {
      title: 'Waiting for the browser',
      description:
        'The preview appears when the focused Scenario opens a page.',
    }
  }
  if (props.model.kind === 'batch') {
    return {
      title: 'No browser frame retained',
      description: 'This completed attempt does not include a browser frame.',
    }
  }
  if (props.selectedScenario) {
    return {
      title: 'Scenario ready to run',
      description: `Run “${props.selectedScenario.name}” to follow its browser here.`,
    }
  }
  return {
    title: 'Select a Scenario',
    description:
      'Choose a Scenario from the Specifications sidebar to inspect or run it.',
  }
}

function EmptyEvidenceState(props: { description: string; title: string }) {
  return (
    <div className="space-y-1 p-4">
      <p className="text-sm font-medium">{props.title}</p>
      <p className="max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
        {props.description}
      </p>
    </div>
  )
}
