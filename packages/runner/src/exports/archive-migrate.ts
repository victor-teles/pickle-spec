import { z } from 'zod'
import { testRunSchemaVersion } from '../execution/run-scenario'
import { publicRunEvent, recordableTestResult } from '../results/public-results'
import {
  parseRunEvent,
  parseRunSchema,
  parseTestRunManifest,
} from '../results/test-run-schema'
import type { RunArchive, RunArchiveArtifact } from './archive'

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

function incompatibleArchiveSchema(version: unknown): never {
  throw new Error(
    `Run archive schema version ${String(version)} is unsupported. ` +
      'The archive was not changed; export it again with this Pickle version.',
  )
}

export function parseRunArchive(value: unknown): RunArchive {
  const archive = parseRunSchema(archiveEnvelopeSchema, value, 'Run archive')
  if (archive.schemaVersion !== testRunSchemaVersion) {
    incompatibleArchiveSchema(archive.schemaVersion)
  }
  const manifest = parseTestRunManifest(
    archive.manifest,
    incompatibleArchiveSchema,
  )
  return {
    schemaVersion: testRunSchemaVersion,
    kind: 'run-archive',
    manifest: {
      ...manifest,
      results: manifest.results.map(recordableTestResult),
    },
    events: archive.events.map((event) =>
      publicRunEvent(parseRunEvent(event, incompatibleArchiveSchema)),
    ),
    artifacts: archive.artifacts,
  }
}
