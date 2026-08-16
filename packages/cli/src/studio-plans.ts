import { createFilePlanStore } from '@pickle-spec/runner'
import type {
  StudioPlanGateway,
  StudioPlanReview,
  StudioProject,
} from '@pickle-spec/studio'
import { loadPersistedRun } from './execute-run'

async function loadStudioPlanReviews(
  root: string,
  project: StudioProject,
): Promise<StudioPlanReview[]> {
  const reviews = await createFilePlanStore(root).listReviews()
  const scenarioNames = new Map(
    project.specifications.flatMap((specification) =>
      specification.scenarios.map((scenario) => [scenario.id, scenario.name]),
    ),
  )

  return Promise.all(
    reviews.map(async (review) => {
      const testRunId = review.candidate?.evidence?.testRunId
      let evidence: StudioPlanReview['evidence']
      if (testRunId) {
        try {
          const { manifest } = await loadPersistedRun(root, testRunId)
          const result = manifest.results.find(
            (item) =>
              item.scenario.id === review.scenarioId &&
              item.executionTargetProfile.id ===
                review.executionTargetProfileId,
          )
          evidence = result ? { testRunId, result } : { testRunId }
        } catch {
          evidence = { testRunId }
        }
      }
      return {
        scenario: {
          id: review.scenarioId,
          name: scenarioNames.get(review.scenarioId) ?? review.scenarioId,
        },
        executionTargetProfileId: review.executionTargetProfileId,
        ...(review.approved ? { approved: review.approved } : {}),
        ...(review.candidate ? { candidate: review.candidate } : {}),
        ...(review.candidateRevision
          ? { candidateRevision: review.candidateRevision }
          : {}),
        ...(evidence ? { evidence } : {}),
      }
    }),
  )
}

export function createStudioPlanGateway(
  root: string,
  loadProject: () => Promise<StudioProject>,
): StudioPlanGateway {
  const store = createFilePlanStore(root)
  return {
    async list() {
      return loadStudioPlanReviews(root, await loadProject())
    },
    promote: (input) => store.promoteCandidate(input),
  }
}
