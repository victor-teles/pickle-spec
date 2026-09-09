import { configurationParser } from '@pickle-spec/configuration'
import { z } from 'zod'
import {
  authoredPlanRunSchemaVersion,
  testRunSchemaVersion,
} from '../execution/run-scenario'
import { runEventSchema } from './schema/run-event-schema'
import {
  testResultSchema,
  testRunManifestSchema,
} from './schema/test-result-schema'

export type IncompatibleSchema = (version: string) => never

const parseSchemaVersion = configurationParser(
  z.object({ schemaVersion: z.unknown() }),
  'Invalid schema envelope',
)

function versionedRunParser<T>(schema: z.ZodType<T>, label: string) {
  const parse = configurationParser(schema, `Invalid ${label}`)
  return (incompatible: IncompatibleSchema) => {
    const parser = z.unknown().transform((value) => {
      const envelope = parseSchemaVersion(value)
      if (
        envelope.schemaVersion !== testRunSchemaVersion &&
        envelope.schemaVersion !== authoredPlanRunSchemaVersion
      ) {
        incompatible(String(envelope.schemaVersion))
      }
      return parse(value)
    })
    return parser.parse.bind(parser)
  }
}

export const parseTestRunManifest = versionedRunParser(
  testRunManifestSchema,
  'Test run manifest',
)
export const parseRunEvent = versionedRunParser(runEventSchema, 'Run event')
export const validateTestResult = versionedRunParser(
  testResultSchema,
  'Test result',
)
