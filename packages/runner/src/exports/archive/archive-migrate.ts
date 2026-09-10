import { configurationParser } from '@pickle-spec/configuration'
import { z } from 'zod'
import {
  authoredPlanRunSchemaVersion,
  testRunSchemaVersion,
} from '../../execution/run-scenario'
import {
  publicRunEvent,
  recordableTestResult,
} from '../../results/public-results'
import {
  parseRunEvent,
  parseTestRunManifest,
} from '../../results/test-run-schema'
import type { RunArchive, RunArchiveArtifact } from '../archive'

const archiveArtifactSchema: z.ZodType<RunArchiveArtifact> = z.object({
  path: z.string(),
  content: z.string(),
  mediaType: z.string().optional(),
})

const archiveEnvelopeSchema = z.object({
  schemaVersion: z.unknown(),
  kind: z.literal('run-archive'),
  manifest: z.unknown(),
  events: z.array(z.unknown()),
  artifacts: z.array(archiveArtifactSchema),
})

function incompatibleArchiveSchema(version: string): never {
  throw new Error(
    `Run archive schema version ${version} is unsupported. ` +
      'The archive was not changed; export it again with this Pickle version.',
  )
}

function projectArchive(
  archive: z.infer<typeof archiveEnvelopeSchema>,
): RunArchive {
  if (
    archive.schemaVersion !== testRunSchemaVersion &&
    archive.schemaVersion !== authoredPlanRunSchemaVersion
  ) {
    incompatibleArchiveSchema(String(archive.schemaVersion))
  }
  const schemaVersion = archive.schemaVersion
  const manifest = parseTestRunManifest(incompatibleArchiveSchema)(
    archive.manifest,
  )
  if (schemaVersion !== manifest.schemaVersion) {
    throw new Error('Run archive and manifest schema versions must match')
  }
  const events = archive.events.map((event) =>
    publicRunEvent(parseRunEvent(incompatibleArchiveSchema)(event)),
  )
  if (events.some((event) => event.schemaVersion > schemaVersion)) {
    throw new Error('Run event schema version exceeds its archive version')
  }
  return {
    schemaVersion,
    kind: 'run-archive',
    manifest: {
      ...manifest,
      results: manifest.results.map(recordableTestResult),
    },
    events,
    artifacts: archive.artifacts,
  }
}

export const parseRunArchive = configurationParser(
  archiveEnvelopeSchema.transform(projectArchive),
  'Invalid Run archive',
)
