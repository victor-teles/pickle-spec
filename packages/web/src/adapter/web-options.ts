import { StagehandCreateOptionsSchema } from '@browserbasehq/stagehand'
import {
  optionalBoolean,
  optionalPositiveInteger,
  optionalString,
  parseConfiguration,
  strictObject,
} from '@pickle-spec/configuration'
import { z } from 'zod'
import { blockedResourceTypes } from './fidelity'

export const defaultModelName = 'anthropic/claude-sonnet-4-6'
export const screenshotModes = ['off', 'on-failure', 'on-step'] as const
export const screenshotFormats = ['png', 'jpeg'] as const
export const browserEnvironments = ['local', 'browserbase'] as const
export const webProfiles = ['default', 'fast'] as const
const cdpProtocols = ['http:', 'https:', 'ws:', 'wss:'] as const

export function cdpEndpointOrigin(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (cdpProtocols.some((protocol) => protocol === url.protocol)) {
      return url.origin
    }
  } catch {}
}

const cdpUrlSchema = optionalString('web.browser.cdpUrl').superRefine(
  (value, context) => {
    if (value === undefined) return
    if (cdpEndpointOrigin(value) !== undefined) return
    context.addIssue({
      code: 'custom',
      message: 'web.browser.cdpUrl must be an absolute HTTP(S) or WS(S) URL',
    })
  },
)

const cdpExtensionIdSchema = z
  .string({ error: 'web.browser.cdpExtensionId must be a string' })
  .trim()
  .min(1, { error: 'web.browser.cdpExtensionId must not be empty' })
  .optional()

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
  cdpUrl: cdpUrlSchema,
  cdpExtensionId: cdpExtensionIdSchema,
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
}).superRefine((options, context) => {
  if (options.environment === 'browserbase' && options.cdpUrl !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'web.browser.cdpUrl cannot be used with browserbase',
    })
  }
  if (options.cdpExtensionId !== undefined && options.cdpUrl === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'web.browser.cdpExtensionId requires web.browser.cdpUrl',
    })
  }
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

export type BrowserConnection =
  | { kind: 'local' }
  | { kind: 'browserbase' }
  | { kind: 'cdp'; cdpUrl: string; extensionId?: string }

export function resolveBrowserConnection(
  options?: BrowserOptions,
): BrowserConnection {
  if (options?.cdpUrl !== undefined) {
    return {
      kind: 'cdp',
      cdpUrl: options.cdpUrl,
      extensionId: options.cdpExtensionId,
    }
  }
  return { kind: options?.environment ?? 'local' }
}

export function validateWebAdapterOptions(value: unknown): WebAdapterOptions {
  return parseConfiguration(
    webAdapterOptionsSchema,
    value,
    'Invalid web options',
  )
}
