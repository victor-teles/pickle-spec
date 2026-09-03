/* Hallmark · component: result explainer card · genre: technical · theme: DESIGN.md
 * states: non-interactive · contrast: pass
 * pre-emit critique: P5 H4 E4 S5 R5 V4
 */
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
    <Card size="sm" className="mb-4" aria-labelledby="replay-divergence-title">
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CardTitle id="replay-divergence-title" role="heading" aria-level={4}>
            Replay divergence
          </CardTitle>
          <Badge>Adaptive fallback</Badge>
        </div>
        <CardDescription>
          Replay stopped matching at this step. Adaptive execution took over.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid min-w-0 gap-3 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
          <li className="min-w-0 space-y-2 border-t border-border pt-3">
            <Badge>1 · Divergence</Badge>
            <p className="break-words font-mono text-xs text-foreground">
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
            <p className="break-words font-mono text-xs text-muted-foreground">
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
