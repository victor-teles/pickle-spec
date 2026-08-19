import type { ExecutionPlan, TestResult } from '@pickle-spec/runner'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components/ui/table'
import { cn } from './lib/utils'
import type { StudioPlanReview } from './server'
import { ResolvedActionList, TestResultTimeline } from './test-result-timeline'

type StudioApi = <Value>(path: string, init?: RequestInit) => Promise<Value>

type PlansPanelProps = {
  adaptedResultsPolicy: 'accept' | 'reject'
  running: boolean
  api: StudioApi
}

function reviewKey(review: StudioPlanReview): string {
  return `${review.scenario.id}\0${review.executionTargetProfileId}`
}

function valueOrNotSet(value: string | undefined): string {
  return value ?? 'Not set'
}

function reasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function resolvedActions(plan: ExecutionPlan | undefined, step: number) {
  return plan?.steps[step]?.resolvedActions
}

function PlanComparison(props: { review: StudioPlanReview }) {
  const { approved, candidate } = props.review
  const metadata = [
    [
      'Scenario revision',
      approved?.scenarioRevision,
      candidate?.scenarioRevision,
    ],
    [
      'Target profile',
      approved?.executionTargetProfileId,
      candidate?.executionTargetProfileId,
    ],
    ['Plan format', approved?.planFormatVersion, candidate?.planFormatVersion],
    [
      'Application revision',
      approved?.applicationRevision,
      candidate?.applicationRevision,
    ],
  ] as const
  const stepCount = Math.max(
    approved?.steps.length ?? 0,
    candidate?.steps.length ?? 0,
  )

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table aria-label="Plan comparison">
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Approved</TableHead>
            <TableHead>Candidate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {metadata.map(([label, approvedValue, candidateValue]) => (
            <TableRow key={label}>
              <TableHead scope="row">{label}</TableHead>
              <TableCell className="font-mono">
                {valueOrNotSet(approvedValue)}
              </TableCell>
              <TableCell className="font-mono">
                {valueOrNotSet(candidateValue)}
              </TableCell>
            </TableRow>
          ))}
          {Array.from({ length: stepCount }, (_, index) => index + 1).map(
            (stepNumber) => (
              <TableRow key={stepNumber}>
                <TableHead scope="row">Step {stepNumber} actions</TableHead>
                <TableCell className="min-w-64 whitespace-normal">
                  <ResolvedActionList
                    actions={resolvedActions(approved, stepNumber - 1)}
                  />
                </TableCell>
                <TableCell className="min-w-64 whitespace-normal">
                  <ResolvedActionList
                    actions={resolvedActions(candidate, stepNumber - 1)}
                  />
                </TableCell>
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function ResultEvidence(props: { result: TestResult }) {
  return (
    <div className="min-h-0 space-y-4 overflow-auto">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="adaptation">{props.result.state}</Badge>
        <span className="text-muted-foreground">
          {props.result.scenario.name} ·{' '}
          {props.result.executionTargetProfile.id}
        </span>
      </div>
      <TestResultTimeline
        result={props.result}
        ariaLabel="Originating result timeline"
        showHeading={false}
      />
    </div>
  )
}

export function PlansPanel(props: PlansPanelProps) {
  const [reviews, setReviews] = useState<StudioPlanReview[]>([])
  const [selectedKey, setSelectedKey] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [promotionOpen, setPromotionOpen] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const next = await props.api<StudioPlanReview[]>('/api/plans')
      setReviews(next)
      setSelectedKey((current) =>
        current && next.some((review) => reviewKey(review) === current)
          ? current
          : next[0]
            ? reviewKey(next[0])
            : undefined,
      )
      setError(undefined)
    } catch (reason) {
      setError(reasonMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [props.api])

  useEffect(() => {
    void reload()
  }, [reload])

  const selected = useMemo(
    () => reviews.find((review) => reviewKey(review) === selectedKey),
    [reviews, selectedKey],
  )

  async function promote() {
    if (!selected?.candidateRevision) return
    try {
      await props.api('/api/plans/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scenarioId: selected.scenario.id,
          executionTargetProfileId: selected.executionTargetProfileId,
          expectedCandidateRevision: selected.candidateRevision,
          confirmed: true,
        }),
      })
      setPromotionOpen(false)
      await reload()
    } catch (reason) {
      setError(reasonMessage(reason))
      setPromotionOpen(false)
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">Plans</h2>
          <p className="text-sm text-muted-foreground">
            Review candidate plans before they replace approved plans.
          </p>
        </div>
        <Badge variant="default">
          CI adapted results: {props.adaptedResultsPolicy}
        </Badge>
      </header>
      {error ? (
        <p role="alert" className="px-6 pt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="p-6 text-sm text-muted-foreground">Loading plans…</p>
      ) : reviews.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">
          No approved or candidate plans found.
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[18rem_1fr]">
          <nav
            aria-label="Execution plans"
            className="min-h-0 border-b border-border p-2 lg:border-r lg:border-b-0"
          >
            <ul className="space-y-1 overflow-auto">
              {reviews.map((review) => {
                const key = reviewKey(review)
                return (
                  <li key={key}>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`${review.scenario.name} · ${review.executionTargetProfileId}`}
                      aria-current={key === selectedKey ? 'true' : undefined}
                      className={cn(
                        'h-auto w-full min-w-0 justify-start px-3 py-2 text-left',
                        key === selectedKey &&
                          'bg-accent text-accent-foreground',
                      )}
                      onClick={() => setSelectedKey(key)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {review.scenario.name}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {review.executionTargetProfileId}
                        </span>
                      </span>
                      {review.approved ? <Badge>approved</Badge> : null}
                      {review.candidate ? (
                        <Badge variant="adaptation">candidate</Badge>
                      ) : null}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </nav>
          {selected ? (
            <section className="min-h-0 space-y-5 overflow-auto px-6 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{selected.scenario.name}</h3>
                  <p className="font-mono text-xs text-muted-foreground">
                    {selected.executionTargetProfileId}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.evidence ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEvidenceOpen(true)}
                    >
                      View originating test result
                    </Button>
                  ) : null}
                  {selected.candidate ? (
                    <Button
                      type="button"
                      disabled={props.running || !selected.candidateRevision}
                      onClick={() => setPromotionOpen(true)}
                    >
                      Promote candidate
                    </Button>
                  ) : null}
                </div>
              </div>
              <PlanComparison review={selected} />
              {!selected.candidate ? (
                <p className="text-sm text-muted-foreground">
                  No candidate plan
                </p>
              ) : selected.evidence ? null : (
                <p className="text-sm text-muted-foreground">
                  Originating test result unavailable
                </p>
              )}
            </section>
          ) : null}
        </div>
      )}

      <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[85vh] sm:max-w-3xl"
        >
          <DialogHeader>
            <DialogTitle>Originating test result</DialogTitle>
            <DialogDescription>
              {selected?.evidence?.testRunId}
            </DialogDescription>
          </DialogHeader>
          {selected?.evidence?.result ? (
            <ResultEvidence result={selected.evidence.result} />
          ) : (
            <p className="text-sm text-muted-foreground">
              This test result is no longer available locally.
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Close
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={promotionOpen} onOpenChange={setPromotionOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Promote candidate plan?</DialogTitle>
            <DialogDescription>
              This replaces the approved plan for {selected?.scenario.name} on{' '}
              {selected?.executionTargetProfileId} and removes the local
              candidate.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="button" onClick={() => void promote()}>
              Confirm promotion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
