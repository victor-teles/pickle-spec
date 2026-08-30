import type { RunsFilters } from '../../app/studio-route'
import { runFilterStates } from '../../app/studio-route'
import { Button, buttonVariants } from '../../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import { Input } from '../../components/ui/input'
import type { FilterOption, RunFilterOptions } from '../hooks/use-runs-dashboard'

type RunFiltersProps = {
  filters: RunsFilters
  options: RunFilterOptions
  onClearFilters: () => void
  onUpdateFilters: (patch: Partial<RunsFilters>) => void
}

export function RunFilters(props: RunFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1 space-y-1">
        <label htmlFor="run-search" className="text-xs text-muted-foreground">
          Search Runs
        </label>
        <Input
          id="run-search"
          type="search"
          value={props.filters.q ?? ''}
          placeholder="Run ID, suite, Specification, or target"
          onChange={(event) =>
            props.onUpdateFilters({
              q: event.currentTarget.value || undefined,
            })
          }
        />
      </div>
      <FilterMenu
        label="State"
        value={props.filters.state}
        options={runFilterStates.map((value) => ({ value, label: value }))}
        onValue={(state) =>
          props.onUpdateFilters({
            state: runFilterStates.find((candidate) => candidate === state),
          })
        }
      />
      <FilterMenu
        label="Specification"
        value={props.filters.specification}
        options={props.options.specifications}
        onValue={(specification) => props.onUpdateFilters({ specification })}
      />
      <FilterMenu
        label="Target"
        value={props.filters.profile}
        options={props.options.profiles}
        onValue={(profile) => props.onUpdateFilters({ profile })}
      />
      <FilterMenu
        label="Suite"
        value={props.filters.suite}
        options={props.options.suites}
        onValue={(suite) => props.onUpdateFilters({ suite })}
      />
      <Button
        type="button"
        variant="ghost"
        disabled={Object.keys(props.filters).length === 0}
        onClick={props.onClearFilters}
      >
        Clear filters
      </Button>
    </div>
  )
}

function FilterMenu(props: {
  label: string
  value?: string
  options: readonly FilterOption[]
  onValue: (value: string | undefined) => void
}) {
  const allValue = '__all__'
  const selected = props.options.find((option) => option.value === props.value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className={buttonVariants({ variant: 'outline' })}
      >
        {props.label}: {selected?.label ?? 'All'}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{props.label}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={props.value ?? allValue}
            onValueChange={(value) =>
              props.onValue(value === allValue ? undefined : value)
            }
          >
            <DropdownMenuRadioItem value={allValue}>All</DropdownMenuRadioItem>
            {props.options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
