type AllureStatus = 'failed' | 'broken' | 'passed' | 'skipped' | 'unknown'
type AllureStage = 'finished' | 'interrupted'

export interface AllureAttachment {
  name: string
  source: string
  type?: string
}

export interface AllureStep {
  name: string
  status: AllureStatus
  statusDetails?: AllureStatusDetails
  stage: AllureStage
  start: number
  stop: number
  steps: AllureStep[]
}

export interface AllureStatusDetails {
  message?: string
  flaky?: boolean
}

export interface AllureTestResult {
  uuid: string
  historyId: string
  testCaseId: string
  fullName: string
  name: string
  status: AllureStatus
  statusDetails?: AllureStatusDetails
  stage: AllureStage
  start: number
  stop: number
  labels: Array<{ name: string; value: string }>
  parameters: Array<{ name: string; value: string; excluded?: boolean }>
  attachments: AllureAttachment[]
  steps: AllureStep[]
}

export interface AllureResultFile {
  fileName: string
  result: AllureTestResult
}

export interface AllureAttachmentFile {
  sourcePath: string
  fileName: string
}

export interface AllureResultsProjection {
  results: AllureResultFile[]
  attachments: AllureAttachmentFile[]
}

export interface AllureArchiveOptions {
  artifactsDirectory: string
  maximumBytes?: number
}

export { projectAllureResults } from './allure/allure-results-projection'
export {
  assertAllureArtifactPath,
  createAllureResultsZip,
} from './allure/allure-results-zip'
