import type { Scenario, ScenarioStep } from './specification'

function stepDigest(step: ScenarioStep): string {
  return JSON.stringify([
    step.keyword,
    step.text,
    step.type,
    step.argument?.dataTable ?? null,
    step.argument?.docString ?? null,
  ])
}

export function scenarioRevision(scenario: Pick<Scenario, 'steps'>): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(scenario.steps.map(stepDigest).join('\0'))
  return hasher.digest('hex')
}
