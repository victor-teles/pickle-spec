import { type FocusEvent, useMemo, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { ResultMark } from '../../components/ui/result-mark'
import { cn } from '../../lib/utils'
import { resultBadgeVariant } from '../runs/result/result-presentation'
import {
  attentionCells,
  cellKey,
  isSelectedCell,
  type MatrixCell,
} from '../runs/result/run-view'

type AttentionListProps = {
  cells: readonly MatrixCell[]
  onSelect: (cell: MatrixCell) => void
  selected?: MatrixCell
}

export function AttentionList(props: AttentionListProps) {
  const attention = useMemo(() => attentionCells(props.cells), [props.cells])
  const [focusOrder, setFocusOrder] = useState<string[]>()
  const displayedCells = useMemo(
    () => cellsInFocusOrder(attention, focusOrder),
    [attention, focusOrder],
  )

  if (attention.length === 0) return null

  function handleFocus() {
    setFocusOrder(
      (current) =>
        current ??
        attention.map((cell) => cellKey(cell.scenarioId, cell.profileId)),
    )
  }

  function handleBlur(event: FocusEvent<HTMLUListElement>) {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return
    }
    setFocusOrder(undefined)
  }

  return (
    <div className="shrink-0">
      <h3 className="studio-display mb-2 text-sm">Needs attention</h3>
      <ul
        aria-label="Needs attention"
        aria-live="polite"
        className="space-y-2"
        onFocusCapture={handleFocus}
        onBlurCapture={handleBlur}
      >
        {displayedCells.map((cell) => (
          <AttentionItem
            key={cellKey(cell.scenarioId, cell.profileId)}
            cell={cell}
            onSelect={props.onSelect}
            selected={isSelectedCell(props.selected, cell)}
          />
        ))}
      </ul>
    </div>
  )
}

type AttentionItemProps = {
  cell: MatrixCell
  onSelect: (cell: MatrixCell) => void
  selected: boolean
}

function AttentionItem(props: AttentionItemProps) {
  function handleSelect() {
    props.onSelect(props.cell)
  }

  return (
    <li>
      <Button
        type="button"
        variant="outline"
        className={cn(
          'h-auto w-full min-w-0 flex-col items-stretch gap-1 rounded-xl bg-card px-3 py-2 text-left',
          props.selected ? 'border-foreground/25' : 'border-border',
        )}
        onClick={handleSelect}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            {props.cell.scenarioName}
          </span>
          <Badge
            variant={
              props.cell.state === 'running'
                ? 'running'
                : resultBadgeVariant(props.cell.state)
            }
          >
            <ResultMark key={props.cell.state} state={props.cell.state} />
            {props.cell.state}
          </Badge>
        </span>
        <span className="text-xs text-muted-foreground">
          {props.cell.profileId} · Inspect result
        </span>
      </Button>
    </li>
  )
}

function cellsInFocusOrder(
  cells: readonly MatrixCell[],
  focusOrder?: readonly string[],
) {
  if (!focusOrder) return cells
  const positions = new Map(
    focusOrder.map((key, index) => [key, index] as const),
  )
  return [...cells].sort((left, right) => {
    const fallback = focusOrder.length
    const leftPosition =
      positions.get(cellKey(left.scenarioId, left.profileId)) ?? fallback
    const rightPosition =
      positions.get(cellKey(right.scenarioId, right.profileId)) ?? fallback
    return leftPosition - rightPosition
  })
}
