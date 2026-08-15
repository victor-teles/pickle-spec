import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ResolvedAction } from './run-scenario'

export interface PlanApplicability {
  scenarioId: string
  scenarioRevision: string
  executionTargetProfileId: string
  planFormatVersion: string
  applicationRevision?: string
}

export interface ExecutionPlanStep {
  resolvedActions: ResolvedAction[]
}

export interface ExecutionPlan extends PlanApplicability {
  schemaVersion: 1
  steps: ExecutionPlanStep[]
}

export interface ExecutionPlanStore {
  findApproved(query: PlanApplicability): Promise<ExecutionPlan | undefined>
  saveCandidate(plan: ExecutionPlan): Promise<void>
}

export function planApplies(
  plan: ExecutionPlan,
  query: PlanApplicability,
): boolean {
  return (
    plan.scenarioId === query.scenarioId &&
    plan.scenarioRevision === query.scenarioRevision &&
    plan.executionTargetProfileId === query.executionTargetProfileId &&
    plan.planFormatVersion === query.planFormatVersion &&
    plan.applicationRevision === query.applicationRevision
  )
}

export function createMemoryPlanStore(
  approved: readonly ExecutionPlan[] = [],
): ExecutionPlanStore {
  const plans = [...approved]
  return {
    async findApproved(query) {
      return plans.find((plan) => planApplies(plan, query))
    },
    async saveCandidate() {},
  }
}

function planFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-') || 'plan'
}

function planPath(
  root: string,
  kind: 'plans' | 'candidates',
  plan: Pick<PlanApplicability, 'executionTargetProfileId' | 'scenarioId'>,
): string {
  return join(
    root,
    '.pickle',
    kind,
    planFileName(plan.executionTargetProfileId),
    `${planFileName(plan.scenarioId)}.json`,
  )
}

function isExecutionPlan(value: unknown): value is ExecutionPlan {
  if (typeof value !== 'object' || value === null) return false
  const plan = value as ExecutionPlan
  return (
    plan.schemaVersion === 1 &&
    typeof plan.scenarioId === 'string' &&
    typeof plan.scenarioRevision === 'string' &&
    typeof plan.executionTargetProfileId === 'string' &&
    typeof plan.planFormatVersion === 'string' &&
    Array.isArray(plan.steps)
  )
}

export function createFilePlanStore(root: string): ExecutionPlanStore {
  return {
    async findApproved(query) {
      const path = planPath(root, 'plans', query)
      if (!(await Bun.file(path).exists())) return undefined
      const parsed: unknown = JSON.parse(await Bun.file(path).text())
      if (!isExecutionPlan(parsed) || !planApplies(parsed, query)) {
        return undefined
      }
      return parsed
    },
    async saveCandidate(plan) {
      const path = planPath(root, 'candidates', plan)
      await mkdir(dirname(path), { recursive: true })
      await Bun.write(path, `${JSON.stringify(plan, null, 2)}\n`)
    },
  }
}
