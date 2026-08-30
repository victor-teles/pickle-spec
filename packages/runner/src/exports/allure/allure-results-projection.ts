import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type {
  ScenarioAttempt,
  TestArtifact,
  TestResult,
  TestResultState,
  TestStepResult,
} from '../../execution/run-scenario'
import type { TestRunManifest } from '../../results/test-run-store'
import type {
  AllureAttachmentFile,
  AllureResultFile,
  AllureResultsProjection,
  AllureStep,
  AllureTestResult,
} from '../allure-results'

type AllureStatus = AllureTestResult['status']
type AllureStage = AllureTestResult['stage']
type AllureStatusDetails = NonNullable<AllureTestResult['statusDetails']>

const extensionByMediaType: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/json': '.json',
  'application/zip': '.zip',
  'text/plain': '.txt',
}

function opaqueId(...parts: Array<string | number | undefined>): string {
  return createHash('sha256')
    .update(parts.map((part) => part ?? '').join('\0'))
    .digest('hex')
}

function uuidFrom(...parts: Array<string | number | undefined>): string {
  const hex = opaqueId(...parts).slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function time(value: string): number {
  return new Date(value).getTime()
}

function allureStatus(state: TestResultState): AllureStatus {
  if (state === 'infrastructure-error' || state === 'cancelled') return 'broken'
  return state
}

function allureStage(state: TestResultState): AllureStage {
  return state === 'cancelled' ? 'interrupted' : 'finished'
}

function statusDetails(
  message: string | undefined,
  flaky = false,
): AllureStatusDetails | undefined {
  if (!message && !flaky) return undefined
  return {
    ...(message ? { message } : {}),
    ...(flaky ? { flaky: true } : {}),
  }
}

function actionStep(description: string, step: TestStepResult): AllureStep {
  return {
    name: description,
    status: 'passed',
    stage: 'finished',
    start: time(step.startedAt),
    stop: time(step.finishedAt),
    steps: [],
  }
}

function allureStep(step: TestStepResult): AllureStep {
  const details = statusDetails(step.message)
  return {
    name: `${step.step.keyword} ${step.step.text}`,
    status: allureStatus(step.state),
    ...(details ? { statusDetails: details } : {}),
    stage: allureStage(step.state),
    start: time(step.startedAt),
    stop: time(step.finishedAt),
    steps: step.resolvedActions.map(({ description }) =>
      actionStep(description, step),
    ),
  }
}

function attachmentExtension(artifact: TestArtifact): string {
  return (
    (artifact.mediaType
      ? extensionByMediaType[artifact.mediaType]
      : undefined) ??
    extname(artifact.path) ??
    ''
  )
}

function attemptArtifacts(attempt: ScenarioAttempt): TestArtifact[] {
  return attempt.steps.flatMap((step) => step.artifacts ?? [])
}

function allureAttachments(
  attempt: ScenarioAttempt,
  uuid: string,
): Array<{
  descriptor: AllureTestResult['attachments'][number]
  file: AllureAttachmentFile
}> {
  return attemptArtifacts(attempt).map((artifact, index) => {
    const fileName = `${uuid}-${index + 1}-attachment${attachmentExtension(artifact)}`
    return {
      descriptor: {
        name: artifact.name ?? artifact.kind,
        source: fileName,
        type: artifact.mediaType,
      },
      file: { sourcePath: artifact.path, fileName },
    }
  })
}

function allureParameters(
  result: TestResult,
  attempt: ScenarioAttempt,
): AllureTestResult['parameters'] {
  return [
    ...(result.scenario.examplesRowId
      ? [{ name: 'examplesRowId', value: result.scenario.examplesRowId }]
      : []),
    {
      name: 'executionTargetProfile',
      value: result.executionTargetProfile.id,
    },
    { name: 'attempt', value: String(attempt.attempt), excluded: true },
  ]
}

function projectAttempt(
  manifest: TestRunManifest,
  result: TestResult,
  attempt: ScenarioAttempt,
): { result: AllureResultFile; attachments: AllureAttachmentFile[] } {
  const scenarioId =
    result.scenario.id ??
    opaqueId(result.specification.uri, result.scenario.name)
  const historyId = opaqueId(
    scenarioId,
    result.scenario.examplesRowId,
    result.executionTargetProfile.id,
  )
  const uuid = uuidFrom(
    manifest.id,
    scenarioId,
    result.scenario.examplesRowId,
    result.executionTargetProfile.id,
    attempt.attempt,
  )
  const attachments = allureAttachments(attempt, uuid)
  const parameters = allureParameters(result, attempt)
  const details = statusDetails(attempt.message, result.flaky)
  const testResult: AllureTestResult = {
    uuid,
    historyId,
    testCaseId: scenarioId,
    fullName: `${result.specification.uri}#${result.scenario.name}`,
    name: result.scenario.name,
    status: allureStatus(attempt.state),
    ...(details ? { statusDetails: details } : {}),
    stage: allureStage(attempt.state),
    start: time(attempt.startedAt),
    stop: time(attempt.finishedAt),
    labels: [
      { name: 'framework', value: 'pickle-spec' },
      { name: 'parentSuite', value: result.specification.name },
      { name: 'suite', value: result.specification.uri },
      { name: 'feature', value: result.specification.name },
      { name: 'story', value: result.scenario.name },
      {
        name: 'executionTargetProfile',
        value: result.executionTargetProfile.id,
      },
    ],
    parameters,
    attachments: attachments.map(({ descriptor }) => descriptor),
    steps: attempt.steps.map(allureStep),
  }
  return {
    result: { fileName: `${uuid}-result.json`, result: testResult },
    attachments: attachments.map(({ file }) => file),
  }
}

export function projectAllureResults(
  manifest: TestRunManifest,
): AllureResultsProjection {
  const results: AllureResultFile[] = []
  const attachments: AllureAttachmentFile[] = []
  for (const testResult of manifest.results) {
    for (const attempt of testResult.attempts) {
      const projected = projectAttempt(manifest, testResult, attempt)
      results.push(projected.result)
      attachments.push(...projected.attachments)
    }
  }
  return { results, attachments }
}
