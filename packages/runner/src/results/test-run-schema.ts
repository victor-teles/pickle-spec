import { z } from 'zod'
import type { RunEvent, TestResult } from '../execution/run-scenario'
import { testRunSchemaVersion } from '../execution/run-scenario'
import { runEventSchema } from './schema/run-event-schema'
import {
  testResultSchema,
  testRunManifestSchema,
} from './schema/test-result-schema'
import type { TestRunManifest } from './test-run-store'

type IncompatibleSchema = (version: unknown) => never

const schemaVersionSchema = z.object({ schemaVersion: z.unknown() })

export function parseRunSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new Error(result.error.issues[0]?.message ?? `Invalid ${label}`)
}

function requireCurrentSchema(
  value: unknown,
  incompatible: IncompatibleSchema,
): void {
  const envelope = parseRunSchema(schemaVersionSchema, value, 'schema envelope')
  if (envelope.schemaVersion !== testRunSchemaVersion) {
    incompatible(envelope.schemaVersion)
  }
}

export function parseTestRunManifest(
  value: unknown,
  incompatible: IncompatibleSchema,
): TestRunManifest {
  requireCurrentSchema(value, incompatible)
  return parseRunSchema(testRunManifestSchema, value, 'Test run manifest')
}

export function parseRunEvent(
  value: unknown,
  incompatible: IncompatibleSchema,
): RunEvent {
  requireCurrentSchema(value, incompatible)
  return parseRunSchema(runEventSchema, value, 'Run event')
}

export function validateTestResult(
  value: unknown,
  incompatible: IncompatibleSchema,
): TestResult {
  requireCurrentSchema(value, incompatible)
  return parseRunSchema(testResultSchema, value, 'Test result')
}
