import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
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

export interface CandidatePlanEvidence {
  testRunId: string
}

export interface CandidateExecutionPlan extends ExecutionPlan {
  evidence?: CandidatePlanEvidence
}

export interface ExecutionPlanReview {
  scenarioId: string
  executionTargetProfileId: string
  approved?: ExecutionPlan
  candidate?: CandidateExecutionPlan
  candidateRevision?: string
}

export interface PromoteCandidatePlanInput {
  scenarioId: string
  executionTargetProfileId: string
  expectedCandidateRevision: string
}

export interface FilePlanStoreOptions {
  candidateEvidence?: CandidatePlanEvidence
}

export interface ExecutionPlanStore {
  findApproved(query: PlanApplicability): Promise<ExecutionPlan | undefined>
  saveCandidate(plan: ExecutionPlan): Promise<void>
}

export interface ExecutionPlanReviewStore {
  listReviews(): Promise<ExecutionPlanReview[]>
  promoteCandidate(input: PromoteCandidatePlanInput): Promise<ExecutionPlan>
}

export interface FileExecutionPlanStore
  extends ExecutionPlanStore,
    ExecutionPlanReviewStore {}

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

const executionPlanSchema = z.object({
  schemaVersion: z.literal(1),
  scenarioId: z.string(),
  scenarioRevision: z.string(),
  executionTargetProfileId: z.string(),
  planFormatVersion: z.string(),
  applicationRevision: z.string().optional(),
  steps: z.array(z.object({ resolvedActions: z.array(z.unknown()) })),
})

const candidateExecutionPlanSchema = executionPlanSchema.extend({
  evidence: z.object({ testRunId: z.string() }).optional(),
})

function isExecutionPlan(value: unknown): value is ExecutionPlan {
  return executionPlanSchema.safeParse(value).success
}

function revisionOf(source: string): string {
  return new Bun.CryptoHasher('sha256').update(source).digest('hex')
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  )
}

async function replaceFile(path: string, source: string): Promise<void> {
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true })
  try {
    await Bun.write(temporaryPath, source)
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function withCandidateLock<Value>(
  candidatePath: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  const lockPath = `${candidatePath}.lock`
  await mkdir(dirname(candidatePath), { recursive: true })
  for (let attempt = 0; ; attempt += 1) {
    try {
      await mkdir(lockPath)
      break
    } catch (error) {
      if (!hasCode(error, 'EEXIST') || attempt >= 200) {
        throw new Error('The candidate plan is currently being updated', {
          cause: error,
        })
      }
      await Bun.sleep(10)
    }
  }
  try {
    return await operation()
  } finally {
    await rm(lockPath, { force: true, recursive: true })
  }
}

function approvedPlanFrom(candidate: CandidateExecutionPlan): ExecutionPlan {
  return {
    schemaVersion: candidate.schemaVersion,
    scenarioId: candidate.scenarioId,
    scenarioRevision: candidate.scenarioRevision,
    executionTargetProfileId: candidate.executionTargetProfileId,
    planFormatVersion: candidate.planFormatVersion,
    ...(candidate.applicationRevision !== undefined
      ? { applicationRevision: candidate.applicationRevision }
      : {}),
    steps: candidate.steps,
  }
}

export function createFilePlanStore(
  root: string,
  options: FilePlanStoreOptions = {},
): FileExecutionPlanStore {
  return {
    async findApproved(query) {
      const file = Bun.file(planPath(root, 'plans', query))
      if (!(await file.exists())) return undefined
      const parsed: unknown = JSON.parse(await file.text())
      if (!isExecutionPlan(parsed) || !planApplies(parsed, query)) {
        return undefined
      }
      return parsed
    },
    async saveCandidate(plan) {
      const path = planPath(root, 'candidates', plan)
      await withCandidateLock(path, () =>
        replaceFile(
          path,
          `${JSON.stringify(
            options.candidateEvidence
              ? { ...plan, evidence: options.candidateEvidence }
              : plan,
            null,
            2,
          )}\n`,
        ),
      )
    },
    async listReviews(): Promise<ExecutionPlanReview[]> {
      const reviews = new Map<string, ExecutionPlanReview>()
      const reviewFor = (plan: ExecutionPlan) => {
        const key = `${plan.scenarioId}\0${plan.executionTargetProfileId}`
        const review = reviews.get(key) ?? {
          scenarioId: plan.scenarioId,
          executionTargetProfileId: plan.executionTargetProfileId,
        }
        reviews.set(key, review)
        return review
      }
      const scan = async (kind: 'plans' | 'candidates') => {
        const directory = join(root, '.pickle', kind)
        try {
          await stat(directory)
        } catch (error) {
          if (hasCode(error, 'ENOENT')) return
          throw error
        }
        for await (const relativePath of new Bun.Glob('*/*.json').scan({
          cwd: directory,
          onlyFiles: true,
        })) {
          const source = await Bun.file(join(directory, relativePath)).text()
          const schema =
            kind === 'plans'
              ? executionPlanSchema
              : candidateExecutionPlanSchema
          const parsed = schema.safeParse(JSON.parse(source) as unknown)
          if (!parsed.success) continue
          const plan = parsed.data as CandidateExecutionPlan
          const review = reviewFor(plan)
          if (kind === 'plans') review.approved = plan
          else {
            review.candidate = plan
            review.candidateRevision = revisionOf(source)
          }
        }
      }
      await scan('plans')
      await scan('candidates')
      return [...reviews.values()].sort(
        (left, right) =>
          left.scenarioId.localeCompare(right.scenarioId) ||
          left.executionTargetProfileId.localeCompare(
            right.executionTargetProfileId,
          ),
      )
    },
    async promoteCandidate(input): Promise<ExecutionPlan> {
      const candidatePath = planPath(root, 'candidates', input)
      return withCandidateLock(candidatePath, async () => {
        const candidateFile = Bun.file(candidatePath)
        if (!(await candidateFile.exists())) {
          throw new Error('The candidate plan is no longer available')
        }
        const source = await candidateFile.text()
        if (revisionOf(source) !== input.expectedCandidateRevision) {
          throw new Error('The candidate plan changed after it was reviewed')
        }
        const parsed = candidateExecutionPlanSchema.safeParse(
          JSON.parse(source) as unknown,
        )
        if (!parsed.success) throw new Error('The candidate plan is invalid')
        const approved = approvedPlanFrom(parsed.data as CandidateExecutionPlan)
        const approvedPath = planPath(root, 'plans', approved)
        await replaceFile(
          approvedPath,
          `${JSON.stringify(approved, null, 2)}\n`,
        )
        await rm(candidatePath)
        return approved
      })
    },
  }
}
