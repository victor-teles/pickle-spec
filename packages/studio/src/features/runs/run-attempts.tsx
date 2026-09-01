import type {
  ScenarioAttempt,
  TestResult,
  TestRunManifest,
} from '@pickle-spec/runner'
import { useMemo } from 'react'
import { Button } from '../../components/ui/button'
import { Label } from '../../components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import type { StudioApi } from '../../lib/studio-api'
import type {
  StudioRunRequest,
  StudioRunSnapshot,
} from '../../server/contracts'
import { defaultRunAttemptLocation } from './result/live-result-follow'
import {
  type LiveResultInspection,
  liveViewportFor,
} from './result/live-result-inspection'
import { locationFromResult } from './result/live-result-projection'
import { findInspectedResult } from './result/result-evidence'
import type { ResultInspectionLocation } from './result/result-inspection'
import { ResultInspector } from './result/result-inspector'

type RunAttempt = { result: TestResult; attempt: ScenarioAttempt }

type RunAttemptsProps = {
  api: StudioApi
  runId: string
  manifest: TestRunManifest
  snapshot: StudioRunSnapshot
  selectedLocation?: ResultInspectionLocation
  live?: LiveResultInspection
  running: boolean
  runsBlocked: boolean
  onOpenArtifact: (
    location: ResultInspectionLocation,
    artifactIndex: number,
  ) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
  onSelectLocation: (location: ResultInspectionLocation) => void
}

export function RunAttempts(props: RunAttemptsProps) {
  const attempts = useMemo(
    () =>
      props.manifest.results.flatMap((result) =>
        result.attempts.map((attempt) => ({ result, attempt })),
      ),
    [props.manifest.results],
  )
  const selectedLocation = selectedAttemptLocation(
    props.snapshot,
    props.selectedLocation,
  )
  return (
    <section className="space-y-2" aria-labelledby="run-results-title">
      <RunAttemptPicker
        {...props}
        attempts={attempts}
        selectedLocation={selectedLocation}
      />
      {attempts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
          {props.running
            ? 'Waiting for the first Scenario to start.'
            : 'This Test run has no results.'}
        </div>
      ) : (
        selectedLocation && (
          <ResultInspector
            api={props.api}
            location={selectedLocation}
            snapshot={props.snapshot}
            connection={props.live?.connection}
            liveViewport={
              props.live
                ? liveViewportFor(props.live, selectedLocation)
                : undefined
            }
            onOpenArtifact={(artifactIndex) =>
              props.onOpenArtifact(selectedLocation, artifactIndex)
            }
            onTabChange={(tab) =>
              props.onSelectLocation({ ...selectedLocation, tab })
            }
          />
        )
      )}
    </section>
  )
}

function RunAttemptPicker(
  props: RunAttemptsProps & {
    attempts: readonly RunAttempt[]
  },
) {
  const selectedLocation = props.selectedLocation
  const selected = selectedLocation
    ? props.attempts.find(
        (item) => attemptKey(item) === locationKey(selectedLocation),
      )
    : undefined
  function selectAttempt(value: string | null) {
    const item = props.attempts.find((attempt) => attemptKey(attempt) === value)
    if (!item) return
    props.onSelectLocation(
      locationFromResult('', props.runId, item.result, item.attempt),
    )
  }
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0 basis-full space-y-2 sm:flex-1">
        <div className="flex items-baseline gap-2">
          <h2 id="run-results-title" className="studio-display text-sm">
            Test results
          </h2>
          <span className="text-xs text-muted-foreground">
            {props.attempts.length}{' '}
            {props.attempts.length === 1 ? 'attempt' : 'attempts'}
          </span>
        </div>
        {props.attempts.length > 0 ? (
          <div className="max-w-2xl space-y-1.5">
            <Label htmlFor="run-attempt-select">Attempt</Label>
            <Select
              value={selected ? attemptKey(selected) : null}
              onValueChange={selectAttempt}
            >
              <SelectTrigger
                id="run-attempt-select"
                aria-label="Attempt"
                className="h-auto min-h-9 w-full py-2"
              >
                <SelectValue placeholder="Select an attempt">
                  {selected ? attemptLabel(selected) : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  <SelectLabel>Scenario attempts</SelectLabel>
                  {props.attempts.map((item) => (
                    <SelectItem key={attemptKey(item)} value={attemptKey(item)}>
                      {attemptLabel(item)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      {selected ? <SelectedAttemptActions {...props} {...selected} /> : null}
    </div>
  )
}

function SelectedAttemptActions(props: RunAttemptsProps & RunAttempt) {
  const { result } = props
  const rerunScenario = () =>
    void props.onRerun({
      rerunId: props.runId,
      scenarioId: result.scenario.id,
      scenarioName: result.scenario.id ? undefined : result.scenario.name,
    })
  const rerunTarget = () =>
    void props.onRerun({
      rerunId: props.runId,
      profiles: [result.executionTargetProfile.id],
    })
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={props.runsBlocked}
        onClick={rerunScenario}
      >
        Rerun Scenario
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={props.runsBlocked}
        onClick={rerunTarget}
      >
        Rerun target
      </Button>
    </div>
  )
}

function attemptKey({ result, attempt }: RunAttempt): string {
  return `${result.specification.uri}:${result.scenario.id ?? result.scenario.name}:${result.scenario.examplesRowId ?? ''}:${result.executionTargetProfile.id}:${attempt.attempt}`
}

function locationKey(location: ResultInspectionLocation): string {
  return `${location.specificationUri}:${location.scenarioId}:${location.examplesRowId ?? ''}:${location.profileId}:${location.attempt}`
}

function attemptLabel({ result, attempt }: RunAttempt): string {
  return `${result.scenario.name} · ${result.executionTargetProfile.id} · Attempt ${attempt.attempt} · ${attempt.state}`
}

function selectedAttemptLocation(
  snapshot: StudioRunSnapshot,
  selected: ResultInspectionLocation | undefined,
): ResultInspectionLocation | undefined {
  return selected && findInspectedResult(snapshot, selected)
    ? selected
    : defaultRunAttemptLocation(snapshot)
}
