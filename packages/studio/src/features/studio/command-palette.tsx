import type { TestRunSummary } from '@pickle-spec/runner'
import { useEffect, useMemo, useState } from 'react'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '../../components/ui/command'
import type {
  StudioProject,
  StudioRunsIndex,
  StudioScenario,
  StudioSpecification,
} from '../../server/contracts'
import {
  buildCommandPaletteItems,
  commandActionAvailability,
  limitCommandPaletteItems,
  matchesCommandQuery,
} from './command-palette-model'

export type CurrentScenario = {
  scenario: StudioScenario
  specification: StudioSpecification
}

type CommandPaletteProps = {
  activeProfileId?: string
  currentScenario?: CurrentScenario
  currentSpecification?: StudioSpecification
  index?: StudioRunsIndex
  onCancelRun: (runId: string) => void
  onJumpRun: (runId: string) => void
  onJumpSpecification: (
    specification: StudioSpecification,
    scenario?: StudioScenario,
  ) => void
  onOpenChange: (open: boolean) => void
  onRefreshSpecification: (specification: StudioSpecification) => void
  onSelectProfile: (profileId: string | undefined) => void
  onStartAll: () => void
  onStartScenario: (current: CurrentScenario) => void
  onStartSpecification: (specification: StudioSpecification) => void
  open: boolean
  project: StudioProject
  running: boolean
}

type PaletteAction = {
  disabled?: boolean
  label: string
  onSelect: () => void
  searchValue: string
}

type PaletteItems = ReturnType<typeof buildCommandPaletteItems>
type ProfileTarget = { profileId?: string; searchValue: string }
type SelectPaletteAction = (action: () => void) => void

function PaletteActions(props: {
  actions: readonly PaletteAction[]
  select: SelectPaletteAction
}) {
  if (props.actions.length === 0) return null
  return (
    <CommandGroup heading="Actions">
      {props.actions.map((action) => (
        <CommandItem
          key={action.label}
          value={action.searchValue}
          disabled={action.disabled}
          onSelect={() => props.select(action.onSelect)}
        >
          <span>{action.label}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

function PaletteSpecifications(props: {
  items: PaletteItems['specifications']
  onJump: CommandPaletteProps['onJumpSpecification']
  select: SelectPaletteAction
}) {
  if (props.items.length === 0) return null
  return (
    <CommandGroup heading="Specifications">
      {props.items.map(({ specification, searchValue }) => (
        <CommandItem
          key={specification.id}
          value={searchValue}
          onSelect={() => props.select(() => props.onJump(specification))}
        >
          <span className="min-w-0 flex-1 truncate">{specification.name}</span>
          <span className="max-w-48 truncate font-mono text-[0.625rem] text-foreground">
            {specification.uri}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

function PaletteScenarios(props: {
  items: PaletteItems['scenarios']
  onJump: CommandPaletteProps['onJumpSpecification']
  select: SelectPaletteAction
}) {
  if (props.items.length === 0) return null
  return (
    <CommandGroup heading="Scenarios">
      {props.items.map(({ scenario, specification, searchValue }) => (
        <CommandItem
          key={`${specification.id}:${scenario.id}`}
          value={searchValue}
          onSelect={() =>
            props.select(() => props.onJump(specification, scenario))
          }
        >
          <span className="min-w-0 flex-1 truncate">{scenario.name}</span>
          <span className="max-w-40 truncate text-foreground">
            {specification.name}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

function PaletteRuns(props: {
  items: PaletteItems['runs']
  onJump: CommandPaletteProps['onJumpRun']
  select: SelectPaletteAction
}) {
  if (props.items.length === 0) return null
  return (
    <CommandGroup heading="Runs">
      {props.items.map((run) => (
        <CommandItem
          key={run.id}
          value={run.searchValue}
          onSelect={() => props.select(() => props.onJump(run.id))}
        >
          <span className="min-w-0 flex-1 truncate font-mono">{run.id}</span>
          <span className="max-w-48 truncate text-foreground">
            {runDescription(run.active, run.summary)}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

function PaletteProfiles(props: {
  activeProfileId?: string
  items: readonly ProfileTarget[]
  onSelectProfile: CommandPaletteProps['onSelectProfile']
  select: SelectPaletteAction
}) {
  if (props.items.length === 0) return null
  return (
    <>
      <CommandSeparator />
      <CommandGroup heading="Run target">
        {props.items.map(({ profileId, searchValue }) => (
          <CommandItem
            key={profileId ?? 'all-profiles'}
            value={searchValue}
            data-checked={props.activeProfileId === profileId}
            aria-current={
              props.activeProfileId === profileId ? 'true' : undefined
            }
            onSelect={() =>
              props.select(() => props.onSelectProfile(profileId))
            }
          >
            {profileId ?? 'All profiles'}
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  )
}

function PaletteResults(props: {
  actions: readonly PaletteAction[]
  items: PaletteItems
  profiles: readonly ProfileTarget[]
  palette: CommandPaletteProps
  select: SelectPaletteAction
}) {
  const hasDestinations =
    props.items.specifications.length > 0 ||
    props.items.scenarios.length > 0 ||
    props.items.runs.length > 0
  return (
    <CommandList>
      <CommandEmpty>No Studio commands match this search.</CommandEmpty>
      <PaletteActions actions={props.actions} select={props.select} />
      {props.actions.length > 0 && hasDestinations ? (
        <CommandSeparator />
      ) : null}
      <PaletteSpecifications
        items={props.items.specifications}
        onJump={props.palette.onJumpSpecification}
        select={props.select}
      />
      <PaletteScenarios
        items={props.items.scenarios}
        onJump={props.palette.onJumpSpecification}
        select={props.select}
      />
      <PaletteRuns
        items={props.items.runs}
        onJump={props.palette.onJumpRun}
        select={props.select}
      />
      <PaletteProfiles
        activeProfileId={props.palette.activeProfileId}
        items={props.profiles}
        onSelectProfile={props.palette.onSelectProfile}
        select={props.select}
      />
    </CommandList>
  )
}

export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const items = useMemo(
    () =>
      buildCommandPaletteItems({
        project: props.project,
        index: props.index,
        query,
      }),
    [props.index, props.project, query],
  )
  const actions = contextualActions(props)
  const visibleActions = limitCommandPaletteItems(
    actions.filter((action) => matchesCommandQuery(action.searchValue, query)),
    query,
  )
  const visibleProfileTargets = limitCommandPaletteItems(
    [
      {
        profileId: undefined,
        searchValue: 'Profile execution target all profiles',
      },
      ...props.project.profiles.map((profileId) => ({
        profileId,
        searchValue: `Profile execution target ${profileId}`,
      })),
    ].filter((target) => matchesCommandQuery(target.searchValue, query)),
    query,
  )

  useEffect(() => {
    if (!props.open) setQuery('')
  }, [props.open])

  function select(action: () => void) {
    props.onOpenChange(false)
    requestAnimationFrame(action)
  }

  return (
    <CommandDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Studio commands"
      description="Jump to Studio work or run a contextual command."
      className="w-[calc(100%-1.5rem)] max-w-xl border-border bg-popover"
    >
      <Command shouldFilter={false} label="Studio command palette">
        <CommandInput
          aria-label="Search Studio commands"
          placeholder="Search Specifications, Scenarios, runs, and actions…"
          value={query}
          onValueChange={setQuery}
        />
        <PaletteResults
          actions={visibleActions}
          items={items}
          profiles={visibleProfileTargets}
          palette={props}
          select={select}
        />
      </Command>
    </CommandDialog>
  )
}

function contextualActions(props: CommandPaletteProps): PaletteAction[] {
  const projectCanRun = props.project.readiness?.ready ?? true
  const specificationCanRun =
    props.currentSpecification?.canRun ?? projectCanRun
  const availability = commandActionAvailability({
    hasScenario: Boolean(props.currentScenario),
    hasSpecification: Boolean(props.currentSpecification),
    hasSpecifications: props.project.specifications.length > 0,
    projectCanRun,
    running: props.running,
    scenarioCanRun: props.currentScenario?.scenario.canRun !== false,
    specificationCanRun,
  })
  const actions: PaletteAction[] = [
    {
      label: 'Run all Specifications',
      searchValue: 'Run start all Specifications',
      disabled: !availability.runAll,
      onSelect: props.onStartAll,
    },
  ]

  if (props.currentSpecification) {
    const specification = props.currentSpecification
    actions.push(
      {
        label: `Run ${specification.name}`,
        searchValue: `Run start current Specification ${specification.name} ${specification.uri}`,
        disabled: !availability.runSpecification,
        onSelect: () => props.onStartSpecification(specification),
      },
      {
        label: `Refresh cache for ${specification.name}`,
        searchValue: `Run refresh cache current Specification ${specification.name} ${specification.uri}`,
        disabled: !availability.refreshSpecification,
        onSelect: () => props.onRefreshSpecification(specification),
      },
    )
  }
  if (props.currentScenario) {
    const current = props.currentScenario
    actions.push({
      label: `Run Scenario ${current.scenario.name}`,
      searchValue: `Run start current Scenario ${current.scenario.name} ${current.scenario.id} ${current.specification.name}`,
      disabled: !availability.runScenario,
      onSelect: () => props.onStartScenario(current),
    })
  }
  for (const runId of props.index?.activeRunIds ?? []) {
    actions.push({
      label: `Cancel Test run ${runId}`,
      searchValue: `Cancel stop active Test run ${runId}`,
      onSelect: () => props.onCancelRun(runId),
    })
  }
  return actions
}

function runDescription(
  active: boolean,
  summary: TestRunSummary | undefined,
): string {
  if (active) return 'running'
  if (!summary) return 'Test run'
  const scope = summary.suite ?? summary.specificationUris.join(', ')
  return scope ? `${summary.state} · ${scope}` : summary.state
}
