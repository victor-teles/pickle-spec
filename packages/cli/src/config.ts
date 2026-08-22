import { join, resolve } from 'node:path'
import type { MobileAdapterOptions } from '@pickle-spec/mobile'
import {
  type ArtifactCapturePolicy,
  type ExecutionSettings,
  type ExecutionTargetProfile,
  executionSettingsSchema,
  type RunConfiguration,
} from '@pickle-spec/runner'
import {
  type SelectionOptions,
  selectionOptionsSchema,
} from '@pickle-spec/spec'
import {
  type WebAdapterOptions,
  webAdapterOptionsSchema,
} from '@pickle-spec/web'
import { z } from 'zod'

export const defaultConfigFile = 'pickle.config.jsonc'
export const defaultExtensionsFile = 'pickle.extensions.ts'
export const defaultSpecificationGlob = 'features/**/*.feature'

export interface ServerConfig {
  command?: string
  url?: string
  port?: number
  startupTimeoutMs?: number
  pollIntervalMs?: number
  readinessPath?: string
  reuseExisting?: boolean
}

export interface ProjectExecutionTargetProfile {
  adapter: string
  capabilities?: readonly string[]
  web?: WebAdapterOptions
  mobile?: MobileAdapterOptions
}

export interface ProjectRetention {
  days?: number
  maxBytes?: number
}

export interface ProjectCache {
  maxBytes?: number
}

export interface ProjectArtifacts {
  capture?: ArtifactCapturePolicy
}

export interface ProjectSecretRef {
  keychain: string
}

export interface PickleConfig {
  schemaVersion: 1
  language?: string
  specifications?: string | string[]
  suites?: Record<string, SelectionOptions>
  executionTargetProfiles?: Record<string, ProjectExecutionTargetProfile>
  executionTargetProfile?: ExecutionTargetProfile
  applicationRevision?: string
  web?: WebAdapterOptions
  selection?: SelectionOptions
  execution?: ExecutionSettings
  concurrency?: number
  server?: ServerConfig
  retention?: ProjectRetention
  cache?: ProjectCache
  artifacts?: ProjectArtifacts
  links?: Record<string, string>
  secrets?: Record<string, ProjectSecretRef>
}

function toExecutionTargetProfile(
  id: string,
  profile: {
    adapter?: string
    capabilities?: readonly string[]
  },
): ExecutionTargetProfile {
  return {
    id,
    adapter: profile.adapter,
    capabilities: profile.capabilities,
  }
}

function selectedExecutionTargetProfiles(
  config: PickleConfig,
  profileIds?: readonly string[],
): ExecutionTargetProfile[] {
  if (config.executionTargetProfiles) {
    const profiles = config.executionTargetProfiles
    const ids = profileIds?.length ? profileIds : Object.keys(profiles)
    return ids.map((id) => {
      const profile = profiles[id]
      if (!profile) {
        throw new Error(`Unknown execution target profile "${id}"`)
      }
      return toExecutionTargetProfile(id, profile)
    })
  }
  if (profileIds?.length) {
    throw new Error(`Unknown execution target profile "${profileIds[0]}"`)
  }
  return [
    toExecutionTargetProfile(
      config.executionTargetProfile?.id ?? (config.web ? 'web' : 'custom'),
      config.executionTargetProfile ?? {},
    ),
  ]
}

export function runConfigurationFrom(
  config: PickleConfig,
  profileIds?: readonly string[],
): RunConfiguration {
  const executionTargetProfiles = selectedExecutionTargetProfiles(
    config,
    profileIds,
  )
  return {
    schemaVersion: config.schemaVersion,
    executionTargetProfile: executionTargetProfiles[0],
    executionTargetProfiles,
    concurrency: config.concurrency,
    execution: config.execution,
    applicationRevision: config.applicationRevision,
  }
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new Error(result.error.issues[0]?.message ?? 'Invalid configuration')
}

function strictObject<Shape extends z.ZodRawShape>(
  field: string,
  shape: Shape,
) {
  return z.strictObject(shape, {
    error: (issue) => {
      if (issue.code === 'unrecognized_keys') {
        const keys = 'keys' in issue ? (issue.keys as string[]) : []
        return keys.map((key) => `${field}.${key} is not supported`).join('\n')
      }
      return `${field} must be an object`
    },
  })
}

function optionalString(field: string) {
  return z.string({ error: `${field} must be a string` }).optional()
}

function nonemptyTrimmedString(field: string) {
  return z
    .string({ error: `${field} must not be empty` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, {
      error: `${field} must not be empty`,
    })
}

function optionalNonemptyTrimmedString(field: string) {
  return nonemptyTrimmedString(field).optional()
}

function optionalPositiveInteger(field: string) {
  return z
    .number({
      error: `${field} must be an integer greater than or equal to 1`,
    })
    .int({
      error: `${field} must be an integer greater than or equal to 1`,
    })
    .min(1, {
      error: `${field} must be an integer greater than or equal to 1`,
    })
    .optional()
}

function nonemptyKey(field: string) {
  return z.string().refine((value) => value.trim().length > 0, {
    error: `${field} keys must not be empty`,
  })
}

const nonemptyPath = z.string().refine((value) => value.trim().length > 0, {
  error: 'specifications paths must not be empty',
})

const projectProfileSchema = strictObject('executionTargetProfiles', {
  adapter: z
    .string({ error: 'executionTargetProfiles adapter must not be empty' })
    .refine((value) => value.trim().length > 0, {
      error: 'executionTargetProfiles adapter must not be empty',
    }),
  capabilities: z
    .array(
      z.string().refine((item) => item.trim().length > 0, {
        error: 'capabilities must not contain an empty capability',
      }),
    )
    .min(1, { error: 'capabilities must contain at least one capability' })
    .optional(),
  web: webAdapterOptionsSchema.optional(),
  mobile: strictObject('executionTargetProfiles.mobile', {
    executionTarget: z.enum(['android-emulator', 'ios-simulator']).optional(),
    application: strictObject('executionTargetProfiles.mobile.application', {
      id: nonemptyTrimmedString(
        'executionTargetProfiles.mobile.application.id',
      ),
      binaryPath: nonemptyTrimmedString(
        'executionTargetProfiles.mobile.application.binaryPath',
      ),
    }),
    targetId: optionalNonemptyTrimmedString(
      'executionTargetProfiles.mobile.targetId',
    ),
    artifactDirectory: optionalNonemptyTrimmedString(
      'executionTargetProfiles.mobile.artifactDirectory',
    ),
    artifacts: z
      .array(z.enum(['screenshot', 'trace', 'recording', 'device-log']))
      .min(1, {
        error:
          'executionTargetProfiles.mobile.artifacts must contain at least one artifact kind',
      })
      .optional(),
    redactions: z
      .array(
        strictObject('executionTargetProfiles.mobile.redactions', {
          match: z.string().min(1, {
            error:
              'executionTargetProfiles.mobile.redactions.match must not be empty',
          }),
          replacement: optionalString(
            'executionTargetProfiles.mobile.redactions.replacement',
          ),
        }),
      )
      .optional(),
    nodePath: optionalNonemptyTrimmedString(
      'executionTargetProfiles.mobile.nodePath',
    ),
  }).optional(),
})
  .superRefine((profile, context) => {
    if (profile.adapter === 'mobile' && !profile.mobile) {
      context.addIssue({
        code: 'custom',
        message:
          'executionTargetProfiles.mobile is required when adapter is "mobile"',
      })
    }
    if (
      profile.mobile?.executionTarget === 'ios-simulator' ||
      profile.mobile?.executionTarget === 'android-emulator'
    ) {
      return
    }
    if (profile.mobile) {
      context.addIssue({
        code: 'custom',
        message:
          'executionTargetProfiles.mobile.executionTarget is required for mobile profiles',
      })
    }
  })
  .transform((profile) => profile as ProjectExecutionTargetProfile)

const pickleConfigSchema = strictObject('configuration', {
  schemaVersion: z.number().superRefine((value, context) => {
    if (value === 1) return
    context.addIssue({
      code: 'custom',
      message: `Unsupported configuration schemaVersion: ${String(value)}`,
    })
  }),
  language: optionalString('language'),
  specifications: z
    .union([
      nonemptyPath,
      z
        .array(nonemptyPath, {
          error: 'specifications must be a string or an array of strings',
        })
        .min(1, { error: 'specifications must contain at least one path' }),
    ])
    .optional(),
  suites: z
    .record(nonemptyKey('suites'), selectionOptionsSchema)
    .superRefine((suites, context) => {
      for (const [name, query] of Object.entries(suites)) {
        if (!query.shard) continue
        context.addIssue({
          code: 'custom',
          message: `suites.${name}.shard is not supported`,
        })
      }
    })
    .optional(),
  executionTargetProfiles: z
    .record(nonemptyKey('executionTargetProfiles'), projectProfileSchema)
    .refine((profiles) => Object.keys(profiles).length > 0, {
      error:
        'executionTargetProfiles must contain at least one execution target profile',
    })
    .optional(),
  executionTargetProfile: z
    .object({
      id: z.string(),
      adapter: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
    })
    .optional(),
  applicationRevision: z
    .string()
    .refine((value) => value.trim().length > 0, {
      error: 'applicationRevision must not be empty',
    })
    .optional(),
  web: webAdapterOptionsSchema.optional(),
  selection: selectionOptionsSchema.optional(),
  execution: executionSettingsSchema.optional(),
  concurrency: optionalPositiveInteger('concurrency'),
  server: strictObject('server', {
    command: optionalString('server.command'),
    url: optionalString('server.url'),
    port: optionalPositiveInteger('server.port'),
    startupTimeoutMs: optionalPositiveInteger('server.startupTimeoutMs'),
    pollIntervalMs: optionalPositiveInteger('server.pollIntervalMs'),
    readinessPath: optionalString('server.readinessPath'),
    reuseExisting: z
      .boolean({ error: 'server.reuseExisting must be a boolean' })
      .optional(),
  })
    .superRefine((server, context) => {
      if (server.command && !server.url && !server.port) {
        context.addIssue({
          code: 'custom',
          message: 'server.command requires server.url or server.port',
        })
      }
      if (server.url !== undefined) {
        try {
          new URL(server.url)
        } catch {
          context.addIssue({
            code: 'custom',
            message: 'server.url must be a valid URL',
          })
        }
      }
      if (typeof server.port === 'number' && server.port > 65_535) {
        context.addIssue({
          code: 'custom',
          message: 'server.port must be less than or equal to 65535',
        })
      }
    })
    .optional(),
  retention: strictObject('retention', {
    days: optionalPositiveInteger('retention.days'),
    maxBytes: optionalPositiveInteger('retention.maxBytes'),
  }).optional(),
  cache: strictObject('cache', {
    maxBytes: optionalPositiveInteger('cache.maxBytes'),
  }).optional(),
  artifacts: strictObject('artifacts', {
    capture: z
      .enum(['off', 'on-failure', 'always'], {
        error: 'artifacts.capture must be off, on-failure, or always',
      })
      .optional(),
  }).optional(),
  links: z
    .record(
      nonemptyKey('links'),
      z
        .string({ error: 'links templates must be a string' })
        .refine((value) => value.includes('{id}'), {
          error: 'links templates must include {id}',
        }),
    )
    .optional(),
  secrets: z
    .record(
      nonemptyKey('secrets'),
      strictObject('secrets', {
        keychain: z
          .string({ error: 'secrets.keychain must not be empty' })
          .refine((value) => value.trim().length > 0, {
            error: 'secrets.keychain must not be empty',
          }),
      }),
    )
    .optional(),
}).transform((config) => config as PickleConfig)

function validateConfig(value: unknown): PickleConfig {
  return parsed(pickleConfigSchema, value)
}

function removeJsonComments(source: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index++) {
    const character = source[index]!
    const next = source[index + 1]
    if (inString) {
      result += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      result += character
      continue
    }
    if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index++
      result += '\n'
      continue
    }
    if (character === '/' && next === '*') {
      index += 2
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      )
        index++
      index++
      continue
    }
    result += character
  }

  return result
}

function parseJsonc(source: string): unknown {
  return JSON.parse(removeJsonComments(source).replaceAll(/,(\s*[}\]])/g, '$1'))
}

export async function loadConfig(
  configPath?: string,
  root = process.cwd(),
): Promise<PickleConfig> {
  const selectedPath =
    configPath ??
    ((await Bun.file(join(root, defaultConfigFile)).exists())
      ? defaultConfigFile
      : undefined)
  if (!selectedPath) return { schemaVersion: 1 }
  if (!selectedPath.endsWith('.jsonc') && !selectedPath.endsWith('.json')) {
    throw new Error('Configuration must use pickle.config.jsonc')
  }
  const absolutePath = resolve(root, selectedPath)
  if (!(await Bun.file(absolutePath).exists())) {
    throw new Error(`Configuration file not found: ${selectedPath}`)
  }

  try {
    return validateConfig(parseJsonc(await Bun.file(absolutePath).text()))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Invalid configuration ${selectedPath}: ${reason}. Correct the value and run pickle check again.`,
    )
  }
}

export async function saveConfig(
  config: PickleConfig,
  configPath = defaultConfigFile,
  root = process.cwd(),
): Promise<void> {
  const selectedPath = configPath
  if (!selectedPath.endsWith('.jsonc') && !selectedPath.endsWith('.json')) {
    throw new Error('Configuration must use pickle.config.jsonc')
  }
  validateConfig(config)
  await Bun.write(
    resolve(root, selectedPath),
    `${JSON.stringify(config, null, 2)}\n`,
  )
}
