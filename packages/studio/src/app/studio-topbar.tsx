import { SearchIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { type StudioArea, studioAreas } from './use-studio-navigation'

type StudioTopbarProps = {
  area: StudioArea
  authoring: boolean
  projectName: string
  running: boolean
  onAreaChange: (area: StudioArea) => void
  onOpenCommands: () => void
}

export function StudioTopbar(props: StudioTopbarProps) {
  return (
    <header className="studio-topbar flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 sm:flex-nowrap sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="studio-wordmark shrink-0">Pickle Spec</span>
        <span aria-hidden="true" className="h-5 w-px bg-border" />
        <span className="studio-project-name hidden truncate sm:block">
          {props.projectName}
        </span>
      </div>
      {props.authoring ? null : (
        <nav
          aria-label="Studio"
          className="order-3 flex w-full items-center gap-0.5 sm:order-none sm:ml-auto sm:w-auto"
        >
          {studioAreas.map((area) => (
            <StudioAreaButton
              key={area}
              area={area}
              currentArea={props.area}
              onSelect={props.onAreaChange}
            />
          ))}
        </nav>
      )}
      {props.authoring ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="sm:w-44 sm:justify-start lg:w-52"
          aria-label="Open Studio commands"
          onClick={props.onOpenCommands}
        >
          <HugeiconsIcon icon={SearchIcon} strokeWidth={2} aria-hidden="true" />
          <span className="hidden sm:inline">Commands</span>
          <kbd className="ml-auto font-mono text-[0.6875rem] text-muted-foreground">
            ⌘K
          </kbd>
        </Button>
      )}
      {props.running ? (
        <Badge role="status" variant="running">
          running
        </Badge>
      ) : null}
    </header>
  )
}

type StudioAreaButtonProps = {
  area: StudioArea
  currentArea: StudioArea
  onSelect: (area: StudioArea) => void
}

function StudioAreaButton(props: StudioAreaButtonProps) {
  const current = props.area === props.currentArea

  function handleClick() {
    props.onSelect(props.area)
  }

  return (
    <Button
      size="sm"
      variant={current ? 'secondary' : 'ghost'}
      aria-current={current ? 'page' : undefined}
      onClick={handleClick}
    >
      {props.area}
    </Button>
  )
}
