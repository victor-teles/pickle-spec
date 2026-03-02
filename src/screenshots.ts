import type { Stagehand } from '@browserbasehq/stagehand'
import type { ScreenshotConfig, StepStatus } from './types'
import { join } from 'path'
import { mkdir } from 'node:fs/promises'

/**
 * Sanitize a name for use in file paths.
 */
export function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function stepFileName(stepIndex: number, status: string, stepText: string, ext: string): string {
  const prefix = sanitize(stepText).slice(0, 40)
  return `step-${String(stepIndex).padStart(2, '0')}-${status}-${prefix}.${ext}`
}

/**
 * Capture a screenshot after a step, if the mode/status warrants it.
 * Returns the saved file path, or undefined if no screenshot was taken.
 */
export async function captureScreenshot(
  stagehand: Stagehand,
  config: ScreenshotConfig,
  context: {
    featureName: string
    scenarioName: string
    stepIndex: number
    stepText: string
    status: StepStatus
  },
): Promise<string | undefined> {
  const mode = config.mode ?? 'off'
  if (mode === 'off') return undefined
  if (mode === 'on-failure' && context.status !== 'failed') return undefined
  if (context.status === 'skipped') return undefined

  try {
    const outputDir = config.outputDir ?? './pickle-artifacts'
    const format = config.format ?? 'png'
    const dir = join(outputDir, sanitize(context.featureName), sanitize(context.scenarioName))

    await mkdir(dir, { recursive: true })

    const page = stagehand.context.pages()[0]
    if (!page) return undefined

    const buffer = await page.screenshot({
      type: format,
      fullPage: config.fullPage ?? false,
    })

    const filename = stepFileName(context.stepIndex, context.status, context.stepText, format)
    const filePath = join(dir, filename)
    await Bun.write(filePath, buffer)
    return filePath
  } catch {
    return undefined
  }
}
