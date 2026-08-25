import { Skeleton } from './components/ui/skeleton'
import { cn } from './lib/utils'

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
      <header className="studio-topbar flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:flex-nowrap sm:px-8 sm:py-2">
        <Skeleton className="h-7 w-44" />
        <div className="flex items-center gap-2 max-sm:order-3 max-sm:w-full">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </header>
      <div className="studio-stage grid min-h-0 flex-1 lg:grid-cols-[18rem_1fr]">
        <aside className="specification-rail hidden space-y-2 border-r border-border p-3 lg:block">
          <Skeleton className="mb-4 h-6 w-28" />
          {railRows.map((row) => (
            <Skeleton key={row} className="h-11 w-full rounded-full" />
          ))}
        </aside>
        <div className="space-y-5 p-8">
          <LedgerSkeleton />
        </div>
      </div>
    </main>
  )
}

export { LedgerLoadingSkeleton, LedgerRowsSkeleton, StudioShellSkeleton }
