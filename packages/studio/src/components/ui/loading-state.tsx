import { useEffect, useState } from 'react'
import { cn } from '../../lib/utils'
import { Spinner } from './spinner'

type LoadingStateProps = {
  label?: string
  className?: string
}

function formatElapsed(deciseconds: number) {
  const total = deciseconds / 10
  if (total < 60) return `${total.toFixed(1)}s`
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`
}

function useElapsed() {
  const [deciseconds, setDeciseconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setDeciseconds((value) => value + 1), 100)
    return () => clearInterval(timer)
  }, [])
  return formatElapsed(deciseconds)
}

function LoadingState({ label = 'running', className }: LoadingStateProps) {
  const elapsed = useElapsed()
  return (
    <div className={cn('flex w-fit items-center gap-2.5', className)}>
      <span role="status" className="flex items-center gap-2.5">
        <Spinner />
        <span className="shimmer-label text-xs font-medium">{label}</span>
      </span>
      <span
        aria-hidden="true"
        className="font-mono text-[0.625rem] text-muted-foreground tabular-nums"
      >
        {elapsed}
      </span>
    </div>
  )
}

export { LoadingState }
