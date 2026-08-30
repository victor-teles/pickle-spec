import {
  type Dispatch,
  type KeyboardEvent,
  type RefCallback,
  type RefObject,
  type SetStateAction,
  useEffect,
  useState,
} from 'react'
import { Button } from '../components/ui/button'
import { useVirtualWindow } from '../hooks/use-virtual-window'
import { cn } from '../lib/utils'
import { RunControlButton } from '../runs/run-control-button'
import { isBusyOrigin, type RunOrigin } from '../runs/run-origin'
import type { StudioSpecification } from '../server/contracts'

const specificationRowHeight = 36

type SpecificationListProps = {
  canRun: boolean
  onRunAll: () => void
  onSelect: (id: string) => void
  origin?: RunOrigin
  running: boolean
  selectedId?: string
  specifications: readonly StudioSpecification[]
}

function RunAllSpecifications(props: SpecificationListProps) {
  return (
    <div className="border-t border-border p-2">
      {props.canRun ? (
        <RunControlButton
          variant="outline"
          className="w-full"
          blocked={props.running || props.specifications.length === 0}
          busy={isBusyOrigin(props.origin, { kind: 'all' })}
          onClick={props.onRunAll}
        >
          Run all Specifications
        </RunControlButton>
      ) : null}
    </div>
  )
}

interface VirtualSpecificationRowsProps {
  after: number
  before: number
  containerRef: RefCallback<HTMLUListElement>
  onMoveFocus: (event: KeyboardEvent, index: number) => void
  onSelect: (id: string) => void
  selectedId?: string
  specifications: readonly StudioSpecification[]
  start: number
}

function VirtualSpecificationRows(props: VirtualSpecificationRowsProps) {
  return (
    <ul
      ref={props.containerRef}
      className="flex min-h-0 flex-1 flex-col overflow-auto px-2 pb-2"
    >
      {props.before > 0 ? (
        <li
          aria-hidden="true"
          className="shrink-0"
          style={{ height: props.before }}
        />
      ) : null}
      {props.specifications.map((specification, visibleIndex) => (
        <SpecificationListItem
          key={specification.id}
          current={specification.id === props.selectedId}
          index={props.start + visibleIndex}
          onMoveFocus={props.onMoveFocus}
          onSelect={props.onSelect}
          specification={specification}
        />
      ))}
      {props.after > 0 ? (
        <li
          aria-hidden="true"
          className="shrink-0"
          style={{ height: props.after }}
        />
      ) : null}
    </ul>
  )
}

function isVisibleIndex(index: number | undefined, start: number, end: number) {
  return index !== undefined && index >= start && index < end
}

function useSpecificationFocus(
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

export function SpecificationList(props: SpecificationListProps) {
  const virtual = useVirtualWindow<HTMLUListElement>({
    count: props.specifications.length,
    itemSize: specificationRowHeight,
  })
  const visibleSpecifications = props.specifications.slice(
    virtual.start,
    virtual.end,
  )
  const [pendingFocus, setPendingFocus] = useState<number>()
  const focusTargetVisible = isVisibleIndex(
    pendingFocus,
    virtual.start,
    virtual.end,
  )

  useSpecificationFocus(
    pendingFocus,
    setPendingFocus,
    focusTargetVisible,
    virtual.scrollRef,
  )

  function moveFocus(event: KeyboardEvent, index: number) {
    const nextIndex = nextSpecificationIndex(
      event.key,
      index,
      props.specifications.length,
    )
    if (nextIndex === undefined || nextIndex === index) return
    event.preventDefault()
    const list = virtual.scrollRef.current
    if (!list) return
    setPendingFocus(nextIndex)
    list.scrollTop = nextIndex * specificationRowHeight
  }

  return (
    <nav
      aria-label="Specifications"
      className="specification-rail flex h-full min-h-0 flex-col overflow-hidden border-b border-border lg:border-r lg:border-b-0"
    >
      <div className="flex h-11 shrink-0 items-center px-3">
        <h2 className="studio-display text-sm">Specifications</h2>
      </div>
      {props.specifications.length === 0 ? (
        <p className="px-3 pb-3 text-xs/relaxed text-muted-foreground">
          None in this project.
        </p>
      ) : (
        <VirtualSpecificationRows
          after={virtual.after}
          before={virtual.before}
          containerRef={virtual.containerRef}
          onMoveFocus={moveFocus}
          onSelect={props.onSelect}
          selectedId={props.selectedId}
          specifications={visibleSpecifications}
          start={virtual.start}
        />
      )}
      <RunAllSpecifications {...props} />
    </nav>
  )
}

type SpecificationListItemProps = {
  current: boolean
  index: number
  onMoveFocus: (event: KeyboardEvent, index: number) => void
  onSelect: (id: string) => void
  specification: StudioSpecification
}

function SpecificationListItem(props: SpecificationListItemProps) {
  function handleClick() {
    props.onSelect(props.specification.id)
  }

  function handleKeyDown(event: KeyboardEvent) {
    props.onMoveFocus(event, props.index)
  }

  return (
    <li className="shrink-0" style={{ height: specificationRowHeight }}>
      <Button
        type="button"
        variant="ghost"
        size="default"
        data-specification-index={props.index}
        aria-label={props.specification.name}
        aria-current={props.current ? 'true' : undefined}
        className={cn(
          'h-full w-full min-w-0 justify-between px-2.5 text-left text-xs',
          props.current && 'bg-accent font-medium text-accent-foreground',
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <span className="min-w-0 truncate">{props.specification.name}</span>
        <span aria-hidden="true" className="font-mono">
          {props.specification.scenarios.length}
        </span>
      </Button>
    </li>
  )
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
