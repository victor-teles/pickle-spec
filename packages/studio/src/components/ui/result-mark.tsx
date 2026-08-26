import { Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from '../../lib/utils'

export type ResultMarkState =
  | 'idle'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'infrastructure-error'

const settleClass =
  'size-3.5 origin-center animate-in fade-in zoom-in-95 duration-120 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:animate-none'

function ResultMark(props: { state: ResultMarkState; className?: string }) {
  if (props.state === 'passed') {
    return (
      <HugeiconsIcon
        icon={Tick02Icon}
        strokeWidth={2}
        aria-hidden
        className={cn(settleClass, 'text-passed', props.className)}
      />
    )
  }
  if (
    props.state === 'failed' ||
    props.state === 'infrastructure-error' ||
    props.state === 'cancelled'
  ) {
    return (
      <HugeiconsIcon
        icon={Cancel01Icon}
        strokeWidth={2}
        aria-hidden
        className={cn(settleClass, 'text-destructive', props.className)}
      />
    )
  }
  return null
}

export { ResultMark }
