import type {
  CacheOutcome,
  ExecutionCacheUncacheableReason,
  ExecutionMode,
} from '@pickle-spec/runner'

export type TestResultState =
  | 'passed'
  | 'passed-with-adaptation'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'infrastructure-error'

export type ScenarioRef = { name: string; id?: string }
export type ResolvedAction = { description: string }
export type TestArtifact = { kind: string; path: string; mediaType?: string }
export type StepResult = {
  step: { keyword: string; text: string }
  state: TestResultState
  resolvedActions: ResolvedAction[]
  message?: string
  artifacts?: TestArtifact[]
}
export type TestResult = {
  scenario: ScenarioRef
  executionTargetProfile: { id: string }
  state: TestResultState
  steps: StepResult[]
  executionMode?: ExecutionMode
  cacheOutcome?: CacheOutcome
  cacheUncacheableReason?: ExecutionCacheUncacheableReason
  inferenceCount?: number
  message?: string
}

export type ClientEvent =
  | { type: 'run-started'; run: { id: string } }
  | {
      type: 'scenario-started'
      scenario: ScenarioRef
      executionTargetProfile?: { id: string }
    }
  | {
      type: 'step-started'
      step: { keyword?: string; text: string }
      scenario?: ScenarioRef
      executionTargetProfile?: { id: string }
    }
  | {
      type: 'step-finished'
      result: StepResult
      scenario?: ScenarioRef
      executionTargetProfile?: { id: string }
    }
  | { type: 'scenario-finished'; result: TestResult }
  | { type: 'run-finished'; run: { id: string } }

export type MatrixCell = {
  scenarioId: string
  scenarioName: string
  profileId: string
  state: TestResultState | 'running'
  result?: TestResult
}

export type RunView = {
  phase: 'idle' | 'running' | 'finished'
  activity: string[]
  cells: MatrixCell[]
  selected?: MatrixCell
  pinned: boolean
}

export function emptyRunView(): RunView {
  return { phase: 'idle', activity: [], cells: [], pinned: false }
}

export function cellKey(scenarioId: string, profileId: string) {
  return `${scenarioId}:${profileId}`
}

export function needsAttention(state: TestResultState | 'running'): boolean {
  return (
    state === 'failed' ||
    state === 'infrastructure-error' ||
    state === 'passed-with-adaptation'
  )
}

export function resultPriority(state: TestResultState | 'running'): number {
  if (state === 'failed' || state === 'infrastructure-error') return 0
  if (state === 'passed-with-adaptation') return 1
  if (state === 'cancelled') return 2
  if (state === 'running') return 3
  if (state === 'skipped') return 5
  return 4
}

export function attentionCells(cells: MatrixCell[]): MatrixCell[] {
  return [...cells]
    .filter((cell) => needsAttention(cell.state))
    .sort(
      (left, right) =>
        resultPriority(left.state) - resultPriority(right.state) ||
        left.scenarioName.localeCompare(right.scenarioName),
    )
}

export function scenarioRows(
  cells: MatrixCell[],
): { id: string; name: string }[] {
  const seen = new Set<string>()
  const rows = []
  for (const cell of cells) {
    if (seen.has(cell.scenarioId)) continue
    seen.add(cell.scenarioId)
    rows.push({ id: cell.scenarioId, name: cell.scenarioName })
  }
  return rows
}

export function statusLabel(
  view: RunView,
): TestResultState | 'idle' | 'running' {
  if (view.phase === 'idle') return 'idle'
  if (view.phase === 'running') return 'running'
  const terminal = view.cells.filter((cell) => cell.state !== 'running')
  if (terminal.length === 0) return 'idle'
  const worst = [...terminal].sort(
    (left, right) => resultPriority(left.state) - resultPriority(right.state),
  )[0]
  return worst?.state ?? 'idle'
}

export function pinCell(view: RunView, cell: MatrixCell): RunView {
  const current =
    view.cells.find(
      (item) =>
        item.scenarioId === cell.scenarioId &&
        item.profileId === cell.profileId,
    ) ?? cell
  return { ...view, selected: current, pinned: true }
}

export function isSelectedCell(
  selected: MatrixCell | undefined,
  cell: MatrixCell,
) {
  return (
    selected?.scenarioId === cell.scenarioId &&
    selected?.profileId === cell.profileId
  )
}

export function reduceRun(view: RunView, event: ClientEvent): RunView {
  if (event.type === 'run-finished') return { ...view, phase: 'finished' }
  if (event.type === 'scenario-started')
    return applyScenarioStarted(view, event)
  if (event.type === 'step-started') return applyStepStarted(view, event)
  if (event.type === 'step-finished') return applyStepFinished(view, event)
  if (event.type === 'scenario-finished') {
    return applyScenarioFinished(view, event)
  }
  return view
}

function followSelection(
  view: RunView,
  cells: MatrixCell[],
): MatrixCell | undefined {
  if (view.pinned && view.selected) {
    return (
      cells.find(
        (cell) =>
          cell.scenarioId === view.selected?.scenarioId &&
          cell.profileId === view.selected?.profileId,
      ) ?? view.selected
    )
  }
  const [worst] = attentionCells(cells)
  if (worst) return worst
  if (view.selected) {
    const current = cells.find(
      (cell) =>
        cell.scenarioId === view.selected?.scenarioId &&
        cell.profileId === view.selected?.profileId,
    )
    if (current) return current
  }
  return cells.find((cell) => cell.state === 'running') ?? view.selected
}

function withCells(
  view: RunView,
  cells: MatrixCell[],
  extras: Partial<RunView> = {},
): RunView {
  const next = { ...view, cells, ...extras }
  return { ...next, selected: followSelection(next, cells) }
}

function scenarioIdOf(scenario: ScenarioRef) {
  return scenario.id ?? scenario.name
}

function rememberActivity(activity: string[], name: string) {
  return activity.includes(name) ? activity : [...activity, name]
}

function replaceCell(cells: MatrixCell[], cell: MatrixCell): MatrixCell[] {
  const key = cellKey(cell.scenarioId, cell.profileId)
  return [
    ...cells.filter((item) => cellKey(item.scenarioId, item.profileId) !== key),
    cell,
  ]
}

function findCell(
  cells: MatrixCell[],
  scenario: ScenarioRef | undefined,
  profileId: string | undefined,
): MatrixCell | undefined {
  if (!scenario || !profileId) return undefined
  const scenarioId = scenarioIdOf(scenario)
  return cells.find(
    (cell) => cell.scenarioId === scenarioId && cell.profileId === profileId,
  )
}

function applyScenarioStarted(
  view: RunView,
  event: Extract<ClientEvent, { type: 'scenario-started' }>,
): RunView {
  const activity = rememberActivity(view.activity, event.scenario.name)
  const profileId = event.executionTargetProfile?.id
  if (!profileId) return { ...view, activity }
  const existing = findCell(view.cells, event.scenario, profileId)
  if (existing?.state === 'running') return { ...view, activity }
  const cell: MatrixCell = {
    scenarioId: scenarioIdOf(event.scenario),
    scenarioName: event.scenario.name,
    profileId,
    state: 'running',
    result: {
      scenario: event.scenario,
      executionTargetProfile: { id: profileId },
      state: 'passed',
      steps: existing?.result?.steps ?? [],
    },
  }
  return withCells(view, replaceCell(view.cells, cell), { activity })
}

function applyStepStarted(
  view: RunView,
  event: Extract<ClientEvent, { type: 'step-started' }>,
): RunView {
  const cell = findCell(
    view.cells,
    event.scenario,
    event.executionTargetProfile?.id,
  )
  if (!cell?.result) return view
  const last = cell.result.steps.at(-1)
  if (
    last &&
    last.step.text === event.step.text &&
    last.resolvedActions.length === 0 &&
    !last.message
  ) {
    return view
  }
  const next: MatrixCell = {
    ...cell,
    result: {
      ...cell.result,
      steps: [
        ...cell.result.steps,
        {
          step: { keyword: event.step.keyword ?? '', text: event.step.text },
          state: 'passed',
          resolvedActions: [],
        },
      ],
    },
  }
  return withCells(view, replaceCell(view.cells, next))
}

function applyStepFinished(
  view: RunView,
  event: Extract<ClientEvent, { type: 'step-finished' }>,
): RunView {
  const cell = findCell(
    view.cells,
    event.scenario,
    event.executionTargetProfile?.id,
  )
  if (!cell?.result) return view
  const steps = [...cell.result.steps]
  const index = steps.findIndex(
    (step) =>
      step.step.text === event.result.step.text &&
      step.resolvedActions.length === 0 &&
      !step.message,
  )
  if (index === -1) steps.push(event.result)
  else steps[index] = event.result
  const next: MatrixCell = {
    ...cell,
    result: { ...cell.result, steps },
  }
  return withCells(view, replaceCell(view.cells, next))
}

function applyScenarioFinished(
  view: RunView,
  event: Extract<ClientEvent, { type: 'scenario-finished' }>,
): RunView {
  const cell: MatrixCell = {
    scenarioId: scenarioIdOf(event.result.scenario),
    scenarioName: event.result.scenario.name,
    profileId: event.result.executionTargetProfile.id,
    state: event.result.state,
    result: event.result,
  }
  return withCells(view, replaceCell(view.cells, cell), {
    activity: rememberActivity(view.activity, event.result.scenario.name),
  })
}
