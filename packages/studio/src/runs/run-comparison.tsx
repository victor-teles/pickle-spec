import type { TestRunComparison } from '@pickle-spec/runner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'

export function RunComparison(props: { comparison: TestRunComparison }) {
  const rows = [
    ...props.comparison.pairs.map((pair) => ({
      key: `pair:${pair.scenarioId}:${pair.executionTargetProfileId}`,
      scenario: pair.candidate.scenario.name,
      profile: pair.executionTargetProfileId,
      baseline: pair.baseline.state,
      candidate: pair.candidate.state,
      changes: pair.changes.join(', '),
    })),
    ...props.comparison.removed.map((side) => ({
      key: `removed:${side.scenarioId}:${side.executionTargetProfileId}`,
      scenario: side.result.scenario.name,
      profile: side.executionTargetProfileId,
      baseline: side.result.state,
      candidate: 'Not run',
      changes: 'removed',
    })),
    ...props.comparison.added.map((side) => ({
      key: `added:${side.scenarioId}:${side.executionTargetProfileId}`,
      scenario: side.result.scenario.name,
      profile: side.executionTargetProfileId,
      baseline: 'Not run',
      candidate: side.result.state,
      changes: 'added',
    })),
  ]

  return (
    <section className="space-y-2">
      <h2 className="studio-display text-sm">Run comparison</h2>
      <div className="overflow-auto rounded-xl border border-border bg-card">
        <Table aria-label="Run comparison">
          <TableHeader>
            <TableRow>
              <TableHead>Scenario</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Baseline</TableHead>
              <TableHead>Candidate</TableHead>
              <TableHead>Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{row.scenario}</TableCell>
                <TableCell>{row.profile}</TableCell>
                <TableCell>{row.baseline}</TableCell>
                <TableCell>{row.candidate}</TableCell>
                <TableCell>{row.changes}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            These Test runs have identical compatible results.
          </p>
        ) : null}
      </div>
    </section>
  )
}
