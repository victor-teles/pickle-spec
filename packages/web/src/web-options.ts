import { StagehandCreateOptionsSchema } from '@browserbasehq/stagehand'
import { z } from 'zod'
import { blockedResourceTypes } from './fidelity'

export const defaultModelName = 'anthropic/claude-sonnet-4-6'
export const screenshotModes = ['off', 'on-failure', 'on-step'] as const
export const screenshotFormats = ['png', 'jpeg'] as const
export const browserEnvironments = ['local', 'browserbase'] as const
export const webProfiles = ['default', 'fast'] as const

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new Error(result.error.issues[0]?.message ?? 'Invalid web options')
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

function optionalBoolean(field: string) {
  return z.boolean({ error: `${field} must be a boolean` }).optional()
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

const browserOptionsSchema = strictObject('web.browser', {
  environment: z
    .enum(browserEnvironments, {
      error: 'web.browser.environment must be local or browserbase',
    })
    .optional(),
  modelName: optionalString('web.browser.modelName').superRefine(
    (value, context) => {
      if (value === undefined) return
      if (!value.trim()) {
        context.addIssue({
          code: 'custom',
          message: 'web.browser.modelName must not be empty',
        })
        return
      }
      const parsedModel = StagehandCreateOptionsSchema.shape.model.safeParse({
        modelName: value,
      })
      if (!parsedModel.success) {
        context.addIssue({
          code: 'custom',
          message: `web.browser.modelName "${value}" is not a Stagehand-supported model`,
        })
      }
    },
  ),
  modelApiKey: optionalString('web.browser.modelApiKey'),
  headless: optionalBoolean('web.browser.headless'),
  browserbaseApiKey: optionalString('web.browser.browserbaseApiKey'),
  browserbaseProjectId: optionalString('web.browser.browserbaseProjectId'),
  cache: optionalBoolean('web.browser.cache'),
  selfHeal: optionalBoolean('web.browser.selfHeal'),
  domSettleTimeoutMs: optionalPositiveInteger('web.browser.domSettleTimeoutMs'),
  observeTimeoutMs: optionalPositiveInteger('web.browser.observeTimeoutMs'),
  actTimeoutMs: optionalPositiveInteger('web.browser.actTimeoutMs'),
  navigationTimeoutMs: optionalPositiveInteger(
    'web.browser.navigationTimeoutMs',
  ),
  idleTimeoutMs: optionalPositiveInteger('web.browser.idleTimeoutMs'),
})

const screenshotOptionsSchema = strictObject('web.screenshots', {
  mode: z
    .enum(screenshotModes, {
      error: 'web.screenshots.mode must be off, on-failure, or on-step',
    })
    .optional(),
  outputDir: optionalString('web.screenshots.outputDir'),
  format: z
    .enum(screenshotFormats, {
      error: 'web.screenshots.format must be png or jpeg',
    })
    .optional(),
  fullPage: optionalBoolean('web.screenshots.fullPage'),
})

const fidelityOptionsSchema = strictObject('web.fidelity', {
  blockResources: z
    .array(
      z.enum(blockedResourceTypes, {
        error: 'web.fidelity.blockResources must be image, media, or font',
      }),
      { error: 'web.fidelity.blockResources must be image, media, or font' },
    )
    .optional(),
  disableAnimations: optionalBoolean('web.fidelity.disableAnimations'),
})

export const webAdapterOptionsSchema = strictObject('web', {
  baseUrl: z
    .string({ error: 'web.baseUrl must not be empty' })
    .trim()
    .min(1, { error: 'web.baseUrl must not be empty' })
    .refine(
      (value) => {
        try {
          new URL(value)
          return true
        } catch {
          return false
        }
      },
      { error: 'web.baseUrl must be a valid URL' },
    ),
  browser: browserOptionsSchema.optional(),
  screenshots: screenshotOptionsSchema.optional(),
  profile: z
    .enum(webProfiles, {
      error: 'web.profile must be default or fast',
    })
    .optional(),
  fidelity: fidelityOptionsSchema.optional(),
}).superRefine((options, context) => {
  if (options.profile !== 'fast' && options.fidelity) {
    context.addIssue({
      code: 'custom',
      message: 'web.fidelity requires web.profile fast',
    })
  }
})

export type BrowserOptions = z.infer<typeof browserOptionsSchema>
export type ScreenshotOptions = z.infer<typeof screenshotOptionsSchema>
export type WebAdapterOptions = z.infer<typeof webAdapterOptionsSchema>

export function validateWebAdapterOptions(value: unknown): WebAdapterOptions {
  return parsed(webAdapterOptionsSchema, value)
}
