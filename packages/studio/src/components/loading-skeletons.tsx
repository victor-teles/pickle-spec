import { cn } from '../lib/utils'
import { Skeleton } from './ui/skeleton'

const railRows = ['one', 'two', 'three', 'four', 'five', 'six'] as const
const ledgerRows = ['one', 'two', 'three'] as const

type LedgerLoadingSkeletonProps = {
  label: string
  className?: string
}

function SkeletonRows() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {ledgerRows.map((row) => (
        <div
          key={row}
          className="flex items-center gap-4 border-b border-border px-3 py-3 last:border-b-0"
        >
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="ml-auto h-6 w-20" />
        </div>
      ))}
    </div>
  )
}

function LedgerRowsSkeleton({ label, className }: LedgerLoadingSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={className}
    >
      <span className="sr-only">{label}</span>
      <SkeletonRows />
    </div>
  )
}

function LedgerLoadingSkeleton({
  label,
  className,
}: LedgerLoadingSkeletonProps) {
  return (
    <section
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn('space-y-3', className)}
    >
      <span className="sr-only">{label}</span>
      <LedgerSkeleton />
    </section>
  )
}

function LedgerSkeleton() {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
        <Skeleton className="h-7 w-24" />
      </div>
      <SkeletonRows />
    </>
  )
}

function StudioShellSkeleton() {
  return (
    <main
      role="status"
      aria-busy="true"
      aria-label="Opening project"
      className="studio-shell flex h-screen flex-col overflow-hidden"
    >
      <span className="sr-only">Opening project…</span>
      <header className="studio-topbar flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5 sm:flex-nowrap sm:px-4">
        <Skeleton className="h-7 w-44" />
        <div className="flex items-center gap-2 max-sm:order-3 max-sm:w-full">
          <Skeleton className="h-7 w-24 rounded-lg" />
          <Skeleton className="h-7 w-20 rounded-lg" />
          <Skeleton className="h-5 w-16 rounded-md" />
        </div>
      </header>
      <div className="studio-stage grid min-h-0 flex-1 lg:grid-cols-[16rem_1fr]">
        <aside className="specification-rail hidden space-y-2 border-r border-border p-3 lg:block">
          <Skeleton className="mb-4 h-6 w-28" />
          {railRows.map((row) => (
            <Skeleton key={row} className="h-9 w-full rounded-lg" />
          ))}
        </aside>
        <div className="space-y-4 p-5">
          <LedgerSkeleton />
        </div>
      </div>
    </main>
  )
}

export { LedgerLoadingSkeleton, LedgerRowsSkeleton, StudioShellSkeleton }
