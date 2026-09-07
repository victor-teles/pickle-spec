import { configurationParser } from '@pickle-spec/configuration'
import { z } from 'zod'
import { testRunSchemaVersion } from '../../execution/run-scenario'
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
  if (archive.schemaVersion !== testRunSchemaVersion) {
    incompatibleArchiveSchema(String(archive.schemaVersion))
  }
  const manifest = parseTestRunManifest(incompatibleArchiveSchema)(
    archive.manifest,
  )
  return {
    schemaVersion: testRunSchemaVersion,
    kind: 'run-archive',
    manifest: {
      ...manifest,
      results: manifest.results.map(recordableTestResult),
    },
    events: archive.events.map((event) =>
      publicRunEvent(parseRunEvent(incompatibleArchiveSchema)(event)),
    ),
    artifacts: archive.artifacts,
  }
}

export const parseRunArchive = configurationParser(
  archiveEnvelopeSchema.transform(projectArchive),
  'Invalid Run archive',
)
