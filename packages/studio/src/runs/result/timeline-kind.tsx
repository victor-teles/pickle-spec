import {
  Alert02Icon,
  BrowserIcon,
  CursorPointer02Icon,
  FileImageIcon,
  PlayCircleIcon,
  Task01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import type { ComponentProps } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/utils'
import type { TimelineEntryKind } from './result-evidence'

type TimelineKindPresentation = {
  icon: IconSvgElement
  badgeClassName: string
  solidClassName: string
}

const timelineKindPresentation: Record<
  TimelineEntryKind,
  TimelineKindPresentation
> = {
  Step: {
    icon: Task01Icon,
    badgeClassName: 'border-indigo-400/30 bg-indigo-400/12 text-indigo-300',
    solidClassName: 'bg-indigo-400 text-indigo-950',
  },
  'Resolved action': {
    icon: CursorPointer02Icon,
    badgeClassName: 'border-cyan-400/30 bg-cyan-400/12 text-cyan-300',
    solidClassName: 'bg-cyan-400 text-cyan-950',
  },
  'Browser activity': {
    icon: BrowserIcon,
    badgeClassName: 'border-teal-400/30 bg-teal-400/12 text-teal-300',
    solidClassName: 'bg-teal-400 text-teal-950',
  },
  'Run event': {
    icon: PlayCircleIcon,
    badgeClassName: 'border-amber-400/30 bg-amber-400/12 text-amber-300',
    solidClassName: 'bg-amber-400 text-amber-950',
  },
  'Diagnostic entry': {
    icon: Alert02Icon,
    badgeClassName: 'border-rose-400/30 bg-rose-400/12 text-rose-300',
    solidClassName: 'bg-rose-400 text-rose-950',
  },
  'Test artifact': {
    icon: FileImageIcon,
    badgeClassName: 'border-fuchsia-400/30 bg-fuchsia-400/12 text-fuchsia-300',
    solidClassName: 'bg-fuchsia-400 text-fuchsia-950',
  },
}

export const timelineEntryKinds = [
  'Step',
  'Resolved action',
  'Browser activity',
  'Run event',
  'Diagnostic entry',
  'Test artifact',
] as const satisfies readonly TimelineEntryKind[]

type TimelineKindIconProps = {
  kind: TimelineEntryKind
  className?: string
}

export function TimelineKindIcon(props: TimelineKindIconProps) {
  return (
    <HugeiconsIcon
      icon={timelineKindPresentation[props.kind].icon}
      strokeWidth={2}
      className={props.className}
      aria-hidden="true"
    />
  )
}

export function TimelineKindBadge(
  props: ComponentProps<typeof Badge> & { kind: TimelineEntryKind },
) {
  const { kind, className, ...badgeProps } = props
  return (
    <Badge
      className={cn(
        'border normal-case tracking-normal',
        timelineKindPresentation[kind].badgeClassName,
        className,
      )}
      {...badgeProps}
    >
      <TimelineKindIcon kind={kind} className="size-3" />
      {kind}
    </Badge>
  )
}

type TimelineKindFilterProps = {
  kind: TimelineEntryKind
  selected: boolean
  onPressedChange: (selected: boolean) => void
}

export function TimelineKindFilter(props: TimelineKindFilterProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      aria-pressed={props.selected}
      onClick={() => props.onPressedChange(!props.selected)}
      className={cn(
        'h-6 rounded-full border normal-case tracking-normal transition-[background-color,border-color,color,opacity]',
        props.selected
          ? timelineKindPresentation[props.kind].badgeClassName
          : 'border-input bg-background text-muted-foreground opacity-60 hover:opacity-100',
      )}
    >
      <TimelineKindIcon kind={props.kind} className="size-3" />
      {props.kind}
    </Button>
  )
}

export function timelineKindSolidClassName(kind: TimelineEntryKind): string {
  return timelineKindPresentation[kind].solidClassName
}
