import { useEffect, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../../components/ui/accordion'
import { Button } from '../../components/ui/button'
import {
  ResultMark,
  type ResultMarkState,
} from '../../components/ui/result-mark'
import { Spinner } from '../../components/ui/spinner'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs'
import type {
  StudioRunRequest,
  StudioScenario,
  StudioSpecification,
} from '../../server/contracts'
import type { ResultInspectionLocation } from '../runs/result/result-inspection'
import { durationLabel } from '../runs/run-format'
import type {
  BatchWorkbenchModel,
  SpecificationsWorkbenchModel,
  WorkbenchTarget,
} from './specifications-workbench-model'

type WorkbenchRailProps = {
  canRun: boolean
  model: SpecificationsWorkbenchModel
  onInspectLocation: (location: ResultInspectionLocation) => void
  onRun: (request: StudioRunRequest) => void
  onSelectScenario: (
    specification: StudioSpecification,
    scenario: StudioScenario,
  ) => void
  onSelectSpecification: (id: string) => void
  running: boolean
  selectedScenarioId?: string
  selectedSpecificationId?: string
}

export function WorkbenchRail(props: WorkbenchRailProps) {
  const runKey = props.model.kind === 'batch' ? props.model.runId : 'browse'
  const [tab, setTab] = useState(
    props.model.kind === 'batch' ? 'queue' : 'specifications',
  )

  useEffect(() => {
    setTab(runKey === 'browse' ? 'specifications' : 'queue')
  }, [runKey])

  return (
    <aside className="flex min-h-0 min-w-0 flex-col xl:overflow-hidden">
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="min-h-0 flex-1 gap-0 overflow-hidden"
      >
        <div className="shrink-0 border-b border-border px-3 py-2">
          <TabsList variant="line" aria-label="Specifications workbench rail">
            <TabsTrigger value="queue">Queue</TabsTrigger>
            <TabsTrigger value="specifications">Specifications</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="queue" className="min-h-0 overflow-auto">
          {props.model.kind === 'batch' ? (
            <QueueGroups {...props} model={props.model} />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              Start Run all to monitor the queue here.
            </p>
          )}
        </TabsContent>
        <TabsContent
          value="specifications"
          className="min-h-0 overflow-auto p-2"
        >
          <SpecificationTargets {...props} />
        </TabsContent>
      </Tabs>
      {props.model.kind === 'batch' ? (
        <p className="shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {props.model.totals.scheduled} tests in this run
        </p>
      ) : null}
    </aside>
  )
}

function SpecificationTargets(props: WorkbenchRailProps) {
  return (
    <Accordion
      multiple
      defaultValue={props.model.specifications.map(
        (specification) => specification.id,
      )}
      className="rounded-none border-0"
    >
      {props.model.specifications.map((specification) => (
        <SpecificationTarget
          key={specification.id}
          {...props}
          specification={specification}
        />
      ))}
    </Accordion>
  )
}

function SpecificationTarget(
  props: WorkbenchRailProps & { specification: StudioSpecification },
) {
  const selected = props.specification.id === props.selectedSpecificationId

  function handleRunSpecification() {
    props.onSelectSpecification(props.specification.id)
    props.onRun({ paths: [props.specification.uri] })
  }

  return (
    <AccordionItem value={props.specification.id}>
      <AccordionTrigger
        className={selected ? 'bg-secondary px-3 py-2' : 'px-3 py-2'}
        onClick={() => props.onSelectSpecification(props.specification.id)}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {props.specification.name}
        </span>
        <span className="text-xs text-muted-foreground">
          {props.specification.scenarios.length}
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-2 pb-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mb-1 w-full"
          disabled={
            props.running ||
            !props.canRun ||
            props.specification.canRun === false
          }
          onClick={handleRunSpecification}
        >
          Run Specification
        </Button>
        <ul className="space-y-0.5">
          {props.specification.scenarios.map((scenario) => (
            <ScenarioTarget key={scenario.id} {...props} scenario={scenario} />
          ))}
        </ul>
      </AccordionContent>
    </AccordionItem>
  )
}

function ScenarioTarget(
  props: WorkbenchRailProps & {
    scenario: StudioScenario
    specification: StudioSpecification
  },
) {
  const selected =
    props.specification.id === props.selectedSpecificationId &&
    props.scenario.id === props.selectedScenarioId

  function handleSelect() {
    props.onSelectScenario(props.specification, props.scenario)
  }

  function handleRun() {
    handleSelect()
    props.onRun({
      paths: [props.specification.uri],
      scenarioId: props.scenario.id,
    })
  }

  return (
    <li className="flex min-w-0 items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant={selected ? 'secondary' : 'ghost'}
        aria-pressed={selected}
        className="h-auto min-w-0 flex-1 justify-start px-2 py-1.5 text-left"
        onClick={handleSelect}
      >
        <span className="truncate">{props.scenario.name}</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={`Run Scenario ${props.scenario.name}`}
        disabled={
          props.running ||
          !props.canRun ||
          props.specification.canRun === false ||
          props.scenario.canRun === false
        }
        onClick={handleRun}
      >
        Run
      </Button>
    </li>
  )
}

function QueueGroups(
  props: WorkbenchRailProps & { model: BatchWorkbenchModel },
) {
  return (
    <Accordion
      multiple
      defaultValue={['running', 'queued', 'completed']}
      className="rounded-none border-0"
    >
      <QueueGroup
        value="running"
        label="Now running"
        model={props.model}
        targets={props.model.running}
        onInspectLocation={props.onInspectLocation}
      />
      <QueueGroup
        value="queued"
        label="Up next"
        model={props.model}
        targets={props.model.queued}
        onInspectLocation={props.onInspectLocation}
      />
      <QueueGroup
        value="completed"
        label="Completed"
        model={props.model}
        targets={props.model.completed}
        onInspectLocation={props.onInspectLocation}
      />
    </Accordion>
  )
}

function QueueGroup(props: {
  label: string
  model: BatchWorkbenchModel
  onInspectLocation: (location: ResultInspectionLocation) => void
  targets: readonly WorkbenchTarget[]
  value: string
}) {
  return (
    <AccordionItem value={props.value}>
      <AccordionTrigger className="px-3 py-2">
        {props.label} ({props.targets.length})
      </AccordionTrigger>
      <AccordionContent className="px-0 pb-0">
        <ul>
          {props.targets.map((target) => (
            <QueueTarget
              key={target.key}
              model={props.model}
              target={target}
              onInspectLocation={props.onInspectLocation}
            />
          ))}
        </ul>
      </AccordionContent>
    </AccordionItem>
  )
}

function QueueTarget(props: {
  model: BatchWorkbenchModel
  onInspectLocation: (location: ResultInspectionLocation) => void
  target: WorkbenchTarget
}) {
  const state = targetState(props.target)
  const content = (
    <>
      <TargetStateMark state={state} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {props.target.specificationName}
        </span>
        <span className="block truncate text-[0.6875rem] text-muted-foreground">
          {props.target.scenarioName} · {props.target.profileId}
        </span>
      </span>
      <span className="shrink-0 text-right text-[0.6875rem]">
        <span className={stateLabelClass(state)}>{state}</span>
        {props.target.kind === 'queued' ? null : (
          <span className="block font-mono text-muted-foreground">
            {durationLabel(props.target.durationMs)}
          </span>
        )}
      </span>
    </>
  )

  if (props.target.kind === 'queued') {
    return (
      <li className="flex min-w-0 items-center gap-2 px-3 py-2">{content}</li>
    )
  }
  const location = props.target.location
  const selected = sameLocation(props.model.location, location)
  return (
    <li>
      <Button
        type="button"
        variant={selected ? 'secondary' : 'ghost'}
        aria-pressed={selected}
        className="h-auto w-full min-w-0 justify-start rounded-none px-3 py-2 text-left"
        onClick={() => props.onInspectLocation(location)}
      >
        {content}
      </Button>
    </li>
  )
}

function targetState(target: WorkbenchTarget): ResultMarkState | 'queued' {
  if (target.kind === 'queued') return 'queued'
  if (target.kind === 'running') return 'running'
  return target.state
}

function TargetStateMark(props: { state: ResultMarkState | 'queued' }) {
  return props.state === 'running' ? (
    <Spinner className="text-primary" />
  ) : (
    <ResultMark state={props.state === 'queued' ? 'idle' : props.state} />
  )
}

function stateLabelClass(state: string): string {
  if (state === 'passed') return 'text-passed'
  if (state === 'failed' || state === 'infrastructure-error') {
    return 'text-destructive'
  }
  return 'text-muted-foreground'
}

function sameLocation(
  left: ResultInspectionLocation | undefined,
  right: ResultInspectionLocation,
): boolean {
  return (
    left?.runId === right.runId &&
    left.specificationUri === right.specificationUri &&
    left.scenarioId === right.scenarioId &&
    left.examplesRowId === right.examplesRowId &&
    left.profileId === right.profileId &&
    left.attempt === right.attempt
  )
}
