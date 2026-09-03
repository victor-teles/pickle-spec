import { SearchIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useEffect,
  useState,
} from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../../components/ui/accordion'
import { Badge } from '../../components/ui/badge'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '../../components/ui/input-group'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs'
import { useVirtualWindow } from '../../hooks/use-virtual-window'
import { cn } from '../../lib/utils'
import type { StudioSpecification } from '../../server/contracts'
import { RunControlButton } from '../runs/run-control-button'
import { isBusyOrigin, type RunOrigin } from '../runs/run-origin'
import type {
  SpecificationIndexEntry,
  SpecificationIndexScope,
} from './specification-index'

type SpecificationListProps = {
  canRun: boolean
  entries: readonly SpecificationIndexEntry[]
  onQueryChange: (query: string) => void
  onRunAll: () => void
  onScopeChange: (scope: SpecificationIndexScope) => void
  onSelect: (id: string) => void
  origin?: RunOrigin
  query: string
  running: boolean
  scope: SpecificationIndexScope
  selectedActions?: ReactNode
  selectedDetail?: ReactNode
  selectedHeadingRef: RefObject<HTMLHeadingElement | null>
  selectedId?: string
  specifications: readonly StudioSpecification[]
}

const specificationIndexScopes: readonly SpecificationIndexScope[] = [
  'all',
  'specifications',
  'scenarios',
]
const specificationIndexRowHeight = 58

function isSpecificationIndexScope(
  value: string,
): value is SpecificationIndexScope {
  return specificationIndexScopes.some((scope) => scope === value)
}

function scopeLabel(scope: SpecificationIndexScope): string {
  if (scope === 'specifications') return 'Specifications'
  if (scope === 'scenarios') return 'Scenarios'
  return 'All'
}

function emptyIndexMessage(props: SpecificationListProps): string {
  if (!props.specifications.length) return 'No Specifications in this project.'
  if (props.query.trim())
    return `No ${scopeLabel(props.scope)} match this filter.`
  return `No ${scopeLabel(props.scope)} to show.`
}

export function SpecificationList(props: SpecificationListProps) {
  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    props.onQueryChange(event.currentTarget.value)
  }

  function handleScopeChange(value: string) {
    if (isSpecificationIndexScope(value)) props.onScopeChange(value)
  }

  return (
    <nav
      aria-label="Specifications"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <h1 className="sr-only">Specifications</h1>
      <Tabs
        value={props.scope}
        onValueChange={handleScopeChange}
        className="min-h-0 flex-1 gap-0 overflow-hidden"
      >
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-5">
          <TabsList variant="line" aria-label="Filter Specifications index">
            {specificationIndexScopes.map((scope) => (
              <TabsTrigger key={scope} value={scope}>
                {scopeLabel(scope)}
              </TabsTrigger>
            ))}
          </TabsList>
          <InputGroup className="w-full sm:ml-auto sm:w-72">
            <InputGroupAddon>
              <HugeiconsIcon
                icon={SearchIcon}
                strokeWidth={2}
                aria-hidden="true"
              />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Filter Specifications and Scenarios"
              placeholder="Filter Specifications and Scenarios"
              value={props.query}
              onChange={handleQueryChange}
            />
          </InputGroup>
          <RunAllSpecifications {...props} />
        </div>
        {specificationIndexScopes.map((scope) => (
          <TabsContent
            key={scope}
            value={scope}
            className="min-h-0 overflow-auto p-3 data-ending-style:hidden sm:p-5"
          >
            <SpecificationIndexEntries {...props} />
          </TabsContent>
        ))}
      </Tabs>
    </nav>
  )
}

function SpecificationIndexEntries(props: SpecificationListProps) {
  const { moveFocus, virtual } = useVirtualSpecificationIndex(
    props.entries.length,
  )
  const visibleEntries = props.entries.slice(virtual.start, virtual.end)

  function handleSpecificationChange(value: string[]) {
    const specificationId = value[0]
    if (specificationId && specificationId !== props.selectedId) {
      props.onSelect(specificationId)
    }
  }

  if (!props.entries.length) {
    return (
      <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {emptyIndexMessage(props)}
      </p>
    )
  }

  return (
    <Accordion
      render={<ul ref={virtual.containerRef} />}
      value={props.selectedId ? [props.selectedId] : []}
      onValueChange={handleSpecificationChange}
      className="h-full min-h-0 overflow-auto"
    >
      <SpecificationIndexSpacer height={virtual.before} />
      {visibleEntries.map((entry, visibleIndex) => (
        <SpecificationIndexItem
          key={entry.specification.id}
          current={entry.specification.id === props.selectedId}
          entry={entry}
          index={virtual.start + visibleIndex}
          onMoveFocus={moveFocus}
          selectedActions={props.selectedActions}
          selectedDetail={props.selectedDetail}
          selectedHeadingRef={props.selectedHeadingRef}
        />
      ))}
      <SpecificationIndexSpacer height={virtual.after} />
    </Accordion>
  )
}

function SpecificationIndexSpacer(props: { height: number }) {
  return props.height > 0 ? (
    <li
      aria-hidden="true"
      className="shrink-0"
      style={{ height: props.height }}
    />
  ) : null
}

type SpecificationIndexItemProps = {
  current: boolean
  entry: SpecificationIndexEntry
  index: number
  onMoveFocus: (event: KeyboardEvent, index: number) => void
  selectedActions?: ReactNode
  selectedDetail?: ReactNode
  selectedHeadingRef: RefObject<HTMLHeadingElement | null>
}

function SpecificationIndexItem(props: SpecificationIndexItemProps) {
  const { specification } = props.entry

  function handleKeyDown(event: KeyboardEvent) {
    props.onMoveFocus(event, props.index)
  }

  return (
    <AccordionItem
      value={specification.id}
      render={<li />}
      className="data-open:bg-transparent"
    >
      <div
        className={cn(
          'flex min-w-0 flex-wrap items-center gap-2 px-2 py-1.5 sm:px-3',
          props.current && 'bg-muted/50',
        )}
      >
        <AccordionTrigger
          headerRef={props.current ? props.selectedHeadingRef : undefined}
          data-specification-index={props.index}
          aria-label={specification.name}
          aria-current={props.current ? 'page' : undefined}
          className="min-h-10 min-w-0 items-center gap-3 px-2 text-left hover:no-underline"
          onKeyDown={handleKeyDown}
        >
          <span className="flex min-w-0 flex-1 items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {specification.name}
            </span>
            <span className="hidden min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted-foreground md:block">
              {specification.uri}
            </span>
          </span>
          <Badge aria-label={`${props.entry.scenarios.length} Scenarios`}>
            {props.entry.scenarios.length}
          </Badge>
        </AccordionTrigger>
        {props.current ? (
          <div className="flex w-full flex-wrap items-center gap-2 px-2 pb-1 sm:w-auto sm:px-0 sm:pb-0">
            {props.selectedActions}
          </div>
        ) : null}
      </div>
      <AccordionContent animated={false} className="-mx-2 pb-0">
        {props.current ? props.selectedDetail : null}
      </AccordionContent>
    </AccordionItem>
  )
}

function isVisibleIndex(index: number | undefined, start: number, end: number) {
  return index !== undefined && index >= start && index < end
}

function useVirtualSpecificationIndex(count: number) {
  const virtual = useVirtualWindow<HTMLUListElement>({
    count,
    itemSize: specificationIndexRowHeight,
  })
  const [pendingFocus, setPendingFocus] = useState<number>()
  const focusTargetVisible = isVisibleIndex(
    pendingFocus,
    virtual.start,
    virtual.end,
  )

  useSpecificationIndexFocus(
    pendingFocus,
    setPendingFocus,
    focusTargetVisible,
    virtual.scrollRef,
  )

  function moveFocus(event: KeyboardEvent, index: number) {
    const nextIndex = nextSpecificationIndex(event.key, index, count)
    if (nextIndex === undefined || nextIndex === index) return
    event.preventDefault()
    const list = virtual.scrollRef.current
    if (!list) return
    setPendingFocus(nextIndex)
    list.scrollTop = nextIndex * specificationIndexRowHeight
  }

  return { moveFocus, virtual }
}

function useSpecificationIndexFocus(
  pendingFocus: number | undefined,
  setPendingFocus: Dispatch<SetStateAction<number | undefined>>,
  focusTargetVisible: boolean,
  scrollRef: RefObject<HTMLUListElement | null>,
): void {
  useEffect(() => {
    if (pendingFocus === undefined || !focusTargetVisible) return
    const target = scrollRef.current?.querySelector<HTMLElement>(
      `[data-specification-index="${pendingFocus}"]`,
    )
    if (!target) return
    target.focus()
    setPendingFocus(undefined)
  }, [focusTargetVisible, pendingFocus, scrollRef, setPendingFocus])
}

function nextSpecificationIndex(key: string, index: number, count: number) {
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, index + 1)
    case 'ArrowUp':
      return Math.max(0, index - 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return
  }
}

function RunAllSpecifications(props: SpecificationListProps) {
  if (!props.canRun) return null
  return (
    <RunControlButton
      variant="outline"
      blocked={props.running || props.specifications.length === 0}
      busy={isBusyOrigin(props.origin, { kind: 'all' })}
      onClick={props.onRunAll}
    >
      Run all Specifications
    </RunControlButton>
  )
}
