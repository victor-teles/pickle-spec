import { useEffect, useMemo, useRef } from 'react'
import { Button } from '../../components/ui/button'
import { ResultMark } from '../../components/ui/result-mark'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import type { StudioScenario } from '../../server/contracts'
import {
  cellKey,
  isSelectedCell,
  type MatrixCell,
} from '../runs/result/run-view'
import { RunControlButton } from '../runs/run-control-button'
import { isBusyOrigin, type RunOrigin } from '../runs/run-origin'

type ScenarioTableProps = {
  cells: readonly MatrixCell[]
  focusRequest: number
  focusedScenarioId?: string
  focusTargetId?: string
  onRun: (scenario: StudioScenario) => void
  onSelect: (cell: MatrixCell) => void
  origin?: RunOrigin
  profiles: readonly string[]
  running: boolean
  scenarios: readonly StudioScenario[]
  selected?: MatrixCell
}

export function ScenarioTable(props: ScenarioTableProps) {
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const cellsByScenarioAndProfile = useMemo(
    () =>
      new Map(
        props.cells.map((cell) => [
          cellKey(cell.scenarioId, cell.profileId),
          cell,
        ]),
      ),
    [props.cells],
  )

  useEffect(() => {
    if (!props.focusTargetId || props.focusRequest === 0) return
    const row = rowRefs.current.get(props.focusTargetId)
    row?.scrollIntoView({ block: 'nearest' })
    row?.focus({ preventScroll: true })
  }, [props.focusRequest, props.focusTargetId])

  function registerRow(id: string, row: HTMLTableRowElement | null) {
    if (row) rowRefs.current.set(id, row)
    else rowRefs.current.delete(id)
  }

  return (
    <div className="scenario-table w-full min-w-0 max-w-full shrink-0 overflow-auto">
      <Table
        aria-label="Scenarios"
        className="text-xs"
        style={{ tableLayout: 'fixed' }}
      >
        <TableHeader>
          <TableRow>
            <TableHead className="w-[48%]">Scenario</TableHead>
            {props.profiles.map((profile) => (
              <TableHead
                key={profile}
                className="w-auto truncate px-1.5 sm:w-32 sm:px-3"
                title={profile}
              >
                {profile}
              </TableHead>
            ))}
            <TableHead className="w-[16%] px-1.5 text-right sm:w-20 sm:px-3">
              <span className="sr-only">Run</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.scenarios.length === 0 ? (
            <EmptyScenarioRow profileCount={props.profiles.length} />
          ) : (
            props.scenarios.map((scenario) => (
              <ScenarioRow
                key={scenario.id}
                cells={cellsByScenarioAndProfile}
                focused={scenario.id === props.focusedScenarioId}
                onRegister={registerRow}
                onRun={props.onRun}
                onSelect={props.onSelect}
                origin={props.origin}
                profiles={props.profiles}
                running={props.running}
                scenario={scenario}
                selected={props.selected}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function EmptyScenarioRow({ profileCount }: { profileCount: number }) {
  return (
    <TableRow>
      <TableCell
        colSpan={2 + profileCount}
        className="py-5 text-muted-foreground"
      >
        This Specification has no Scenarios.
      </TableCell>
    </TableRow>
  )
}

type ScenarioRowProps = {
  cells: ReadonlyMap<string, MatrixCell>
  focused: boolean
  onRegister: (id: string, row: HTMLTableRowElement | null) => void
  onRun: (scenario: StudioScenario) => void
  onSelect: (cell: MatrixCell) => void
  origin?: RunOrigin
  profiles: readonly string[]
  running: boolean
  scenario: StudioScenario
  selected?: MatrixCell
}

function ScenarioRow(props: ScenarioRowProps) {
  function handleRef(row: HTMLTableRowElement | null) {
    props.onRegister(props.scenario.id, row)
  }

  function handleRun() {
    props.onRun(props.scenario)
  }

  return (
    <TableRow
      ref={handleRef}
      tabIndex={-1}
      data-state={props.focused ? 'selected' : undefined}
      className="outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/35"
    >
      <TableHead
        scope="row"
        className="max-w-0 truncate"
        title={props.scenario.name}
      >
        {props.scenario.name}
      </TableHead>
      {props.profiles.map((profile) => (
        <ScenarioResultCell
          key={profile}
          cell={props.cells.get(cellKey(props.scenario.id, profile))}
          onSelect={props.onSelect}
          profile={profile}
          scenarioName={props.scenario.name}
          selected={props.selected}
        />
      ))}
      <TableCell className="w-[16%] px-1 text-right sm:w-20 sm:px-3">
        {props.scenario.canRun !== false ? (
          <RunControlButton
            size="sm"
            variant="outline"
            blocked={props.running}
            busy={isBusyOrigin(props.origin, {
              kind: 'scenario',
              scenarioId: props.scenario.id,
            })}
            aria-label={`Run Scenario ${props.scenario.name}`}
            onClick={handleRun}
          >
            Run
          </RunControlButton>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

type ScenarioResultCellProps = {
  cell?: MatrixCell
  onSelect: (cell: MatrixCell) => void
  profile: string
  scenarioName: string
  selected?: MatrixCell
}

function ScenarioResultCell(props: ScenarioResultCellProps) {
  const { cell } = props
  if (!cell) {
    return (
      <TableCell className="w-auto px-1.5 sm:w-32 sm:px-3">
        <span className="block truncate text-muted-foreground">pending</span>
      </TableCell>
    )
  }
  const selectedCell = cell

  function handleSelect() {
    props.onSelect(selectedCell)
  }

  return (
    <TableCell className="w-auto px-1.5 sm:w-32 sm:px-3">
      <Button
        type="button"
        size="sm"
        variant={matrixCellVariant(cell.state)}
        aria-label={`${props.scenarioName} ${props.profile} ${cell.state}`}
        aria-pressed={isSelectedCell(props.selected, cell)}
        className="max-w-full animate-in px-1 fade-in zoom-in-95 duration-120 motion-reduce:animate-none sm:px-3"
        onClick={handleSelect}
      >
        <ResultMark key={cell.state} state={cell.state} />
        <span className="hidden sm:inline">{cell.state}</span>
      </Button>
    </TableCell>
  )
}

function matrixCellVariant(state: MatrixCell['state']) {
  if (state === 'failed' || state === 'infrastructure-error') {
    return 'destructive'
  }
  if (state === 'passed') return 'passed'
  return 'outline'
}
