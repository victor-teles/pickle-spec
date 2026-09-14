import { useId } from 'react'
import { Badge } from '../../../components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import type { ReplayDivergenceExplanation } from './replay-divergence'

type ReplayDivergenceExplainerProps = {
  explanation: ReplayDivergenceExplanation
}

function stepCountLabel(stepCount: number): string {
  if (stepCount === 0) return 'No steps replayed'
  return `${stepCount} ${stepCount === 1 ? 'step' : 'steps'} replayed and sealed`
}

export function ReplayDivergenceExplainer(
  props: ReplayDivergenceExplainerProps,
) {
  const titleId = useId()
  const { divergence, sealedPrefix, fallback } = props.explanation
  const prefixDetail = sealedPrefix.boundaryStepText
    ? `Through ${sealedPrefix.boundaryStepText}`
    : 'Replay diverged at the first Scenario step.'
  const fallbackTitle =
    fallback.kind === 'continued-same-attempt'
      ? `Continued in attempt ${fallback.attempt}`
      : `Restarted as attempt ${fallback.attempt}`
  const fallbackDetail =
    fallback.kind === 'continued-same-attempt'
      ? 'Adaptive continued from the divergence step without restarting the Scenario.'
      : 'Adaptive restarted the Scenario after the Replay attempt ended.'

  return (
    <Card
      size="sm"
      role="region"
      className="@container/replay mb-4"
      aria-labelledby={titleId}
    >
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CardTitle id={titleId} role="heading" aria-level={4}>
            Replay divergence
          </CardTitle>
          <Badge>Adaptive fallback</Badge>
        </div>
        <CardDescription>
          Replay stopped matching at this step. Adaptive execution took over.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid min-w-0 gap-4 @2xl/replay:grid-cols-3">
          <li className="min-w-0 space-y-2 border-t border-border pt-3">
            <Badge>1 · Divergence</Badge>
            <p className="font-mono text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {divergence.stepText}
            </p>
            <p className="text-xs text-muted-foreground">
              Scenario step {divergence.stepIndex + 1} · Replay attempt{' '}
              {divergence.attempt}
            </p>
          </li>
          <li className="min-w-0 space-y-2 border-t border-border pt-3">
            <Badge>2 · Sealed prefix</Badge>
            <p className="text-sm font-medium text-foreground">
              {stepCountLabel(sealedPrefix.stepCount)}
            </p>
            <p className="font-mono text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {prefixDetail}
            </p>
          </li>
          <li className="min-w-0 space-y-2 border-t border-border pt-3">
            <Badge>3 · Adaptive</Badge>
            <p className="text-sm font-medium text-foreground">
              {fallbackTitle}
            </p>
            <p className="text-xs text-muted-foreground">{fallbackDetail}</p>
          </li>
        </ol>
      </CardContent>
    </Card>
  )
}
