import type {
  EvidencePersistencePolicy,
  TestRunExportRequest,
} from '@pickle-spec/runner'
import type { SelectionOptions } from '@pickle-spec/spec'
import type { WebAdapterOptions } from '@pickle-spec/web'
import type { ApplicationOutputOptions } from './run/application-output'
import type { RunReporterName } from './run/run-reporter'

export interface RunCommandInput {
  pattern?: string
  configPath?: string
  extensionsPath?: string
  suite?: string
  profiles?: string[]
  selection: SelectionOptions
  retries?: number
  concurrency?: number
  language?: string
  scenarioTimeoutMs?: number
  stepTimeoutMs?: number
  reuseServer?: boolean
  headed?: boolean
  screenshotMode?: NonNullable<WebAdapterOptions['screenshots']>['mode']
  applicationRevision?: string
  outputs?: TestRunExportRequest[]
  force?: boolean
  allArtifacts?: boolean
  rerunId?: string
  failures?: boolean
  fast?: boolean
  refreshCache?: boolean
  cacheOnly?: boolean
  reporter?: RunReporterName
  applicationOutput?: ApplicationOutputOptions
  evidencePersistence?: EvidencePersistencePolicy
}

export interface StudioCommandInput {
  configPath?: string
  extensionsPath?: string
  remoteHost?: string
  open: boolean
  port?: number
}

export interface ProjectCommandInput {
  configPath?: string
  extensionsPath?: string
}

export interface MigrateCommandInput {
  configPath?: string
  yes?: boolean
}

export interface CompareCommandInput {
  baselineId: string
  candidateId: string
}

export interface ImportCommandInput {
  archivePath: string
}

export interface ExportCommandInput {
  runId: string
  outputs: TestRunExportRequest[]
  allArtifacts: boolean
  force: boolean
}

export interface AppsCommandInput {
  platform: 'android' | 'ios'
  all: boolean
}

export interface CacheCommandInput {
  operation: 'inspect' | 'clear'
}

export interface DoctorCommandInput extends ProjectCommandInput {
  verbose: boolean
}

export interface CliActions {
  run(input: RunCommandInput): Promise<number>
  studio(input: StudioCommandInput): Promise<number>
  init(): Promise<number>
  check(input: ProjectCommandInput): Promise<number>
  migrate(input: MigrateCommandInput): Promise<number>
  compare(input: CompareCommandInput): Promise<number>
  importArchive(input: ImportCommandInput): Promise<number>
  exportRun(input: ExportCommandInput): Promise<number>
  apps(input: AppsCommandInput): Promise<number>
  cache(input: CacheCommandInput): Promise<number>
  doctor(input: DoctorCommandInput): Promise<number>
}
