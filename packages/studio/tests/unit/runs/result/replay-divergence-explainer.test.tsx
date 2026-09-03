import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ReplayDivergenceExplainer } from '../../../../src/features/runs/result/replay-divergence-explainer'

function stagePositions(markup: string): number[] {
  return [
    markup.indexOf('1 · Divergence'),
    markup.indexOf('2 · Sealed prefix'),
    markup.indexOf('3 · Adaptive'),
  ]
}

test('renders an ordered same-attempt continuation without cache identity', () => {
  const markup = renderToStaticMarkup(
    <ReplayDivergenceExplainer
      explanation={{
        divergence: {
          attempt: 1,
          stepIndex: 2,
          stepText: 'Then payment is captured',
        },
        sealedPrefix: {
          stepCount: 2,
          boundaryStepText: 'When the customer checks out',
        },
        fallback: { kind: 'continued-same-attempt', attempt: 1 },
      }}
    />,
  )

  const positions = stagePositions(markup)
  expect(positions.every((position) => position >= 0)).toBe(true)
  expect(positions).toEqual([...positions].sort((left, right) => left - right))
  expect(markup).toContain('Then payment is captured')
  expect(markup).toContain('2 steps replayed and sealed')
  expect(markup).toContain('Through When the customer checks out')
  expect(markup).toContain('Continued in attempt 1')
  expect(markup).toContain(
    'Adaptive continued from the divergence step without restarting the Scenario.',
  )
  expect(markup).not.toContain('project-key-do-not-render')
})

test('renders an ordered next-attempt restart', () => {
  const markup = renderToStaticMarkup(
    <ReplayDivergenceExplainer
      explanation={{
        divergence: {
          attempt: 1,
          stepIndex: 0,
          stepText: 'Given an order exists',
        },
        sealedPrefix: { stepCount: 0 },
        fallback: { kind: 'restarted-next-attempt', attempt: 2 },
      }}
    />,
  )

  const positions = stagePositions(markup)
  expect(positions.every((position) => position >= 0)).toBe(true)
  expect(positions).toEqual([...positions].sort((left, right) => left - right))
  expect(markup).toContain('No steps replayed')
  expect(markup).toContain('Replay diverged at the first Scenario step.')
  expect(markup).toContain('Restarted as attempt 2')
  expect(markup).toContain(
    'Adaptive restarted the Scenario after the Replay attempt ended.',
  )
})
