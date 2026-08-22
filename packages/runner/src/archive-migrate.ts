import { z } from 'zod'
import type { RunArchive, RunArchiveArtifact } from './archive'
import { publicRunEvent, recordableTestResult } from './public-results'
import { testRunSchemaVersion } from './run-scenario'
import { parseRunEvent, parseTestRunManifest } from './test-run-schema'

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

function parsed<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new Error(result.error.issues[0]?.message ?? `Invalid ${label}`)
}

function incompatibleArchiveSchema(version: unknown): never {
  throw new Error(
    `Run archive schema version ${String(version)} is unsupported. ` +
      'The archive was not changed; export it again with this Pickle version.',
  )
}

export function parseRunArchive(value: unknown): RunArchive {
  const archive = parsed(archiveEnvelopeSchema, value, 'Run archive')
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
