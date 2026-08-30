import { mkdir, rename } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type {
  EvidenceAvailability,
  StepExecution,
  TestArtifact,
} from '@pickle-spec/runner'

interface ReusedStepScreenshot {
  execution: StepExecution
  screenshot: {
    artifact: TestArtifact
    availability: EvidenceAvailability
  }
}

export async function reuseActionCompletionScreenshot(
  execution: StepExecution,
  path: string,
): Promise<ReusedStepScreenshot | undefined> {
  const actionIndex = execution.resolvedActions.findLastIndex(
    (candidate) => candidate.evidence?.screenshots.after.state === 'available',
  )
  if (actionIndex < 0) return
  const action = execution.resolvedActions[actionIndex]
  const evidence = action?.evidence
  const after = evidence?.screenshots.after
  if (!action || !evidence || after?.state !== 'available') return
  try {
    await mkdir(dirname(path), { recursive: true })
    await rename(after.artifact.path, path)
  } catch {
    return
  }
  const artifact = {
    ...after.artifact,
    path,
    name: basename(path),
  }
  const resolvedActions = execution.resolvedActions.with(actionIndex, {
    ...action,
    evidence: {
      ...evidence,
      screenshots: {
        ...evidence.screenshots,
        after: { ...after, artifact },
      },
    },
  })
  return {
    execution: { ...execution, resolvedActions },
    screenshot: {
      artifact,
      availability: { kind: 'screenshot', state: 'available' },
    },
  }
}
