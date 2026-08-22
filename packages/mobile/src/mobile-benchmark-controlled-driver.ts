import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { AgentDeviceClientPort } from './agent-device-client'
import { executePrivateAgentDeviceReplay } from './agent-device-replay'
import { compileMobileScenario } from './mobile-ad-script'
import type { MobileBenchmarkMode } from './mobile-benchmark'
import {
  createMobileExecutionCache,
  mobileExecutionCachePayloadSchema,
  mobileReplayVariableName,
} from './mobile-execution-cache'

const applicationId = 'com.pickle-spec.benchmark'
const runtimeProduct = 'Pickles'
const productVariable = mobileReplayVariableName('product')
const productPlaceholder = ['$', `{${productVariable}}`].join('')
const templateSteps = Array.from({ length: 300 }, (_, index) =>
  index % 2 === 0
    ? { type: 'action' as const, text: `Buy <product> item ${index}` }
    : {
        type: 'outcome' as const,
        text: `visible: id="receipt-${index}"`,
      },
)
const scenario = {
  steps: templateSteps.map((step) => ({
    ...step,
    text: step.text.replace('<product>', runtimeProduct),
  })),
  templateSteps,
  runtimeBindings: [{ name: 'product', value: runtimeProduct }],
}
const executionCache = createMobileExecutionCache({
  platform: 'android',
  executionTarget: 'android-emulator',
  applicationId,
})
const benchmarkEnvelopeSchema = z.strictObject({
  adapterPayload: mobileExecutionCachePayloadSchema,
  requiredVariables: z.array(z.string().min(1)),
})
const controlledClient: AgentDeviceClientPort = {
  devices: {
    async list() {},
    async capabilities() {},
  },
  apps: {
    async reinstall() {},
    async open() {},
  },
  command: {
    async appState() {},
    async wait() {},
  },
  interactions: {
    async find() {},
  },
  replay: {
    async run(options) {
      const script = await readFile(options.path, 'utf8')
      const runtimeValue = options.env
        ?.find((binding) => binding.startsWith(`${productVariable}=`))
        ?.slice(productVariable.length + 1)
      if (!runtimeValue) throw new Error('Controlled Replay binding is absent')
      const materializedScript = script.replaceAll(
        productPlaceholder,
        runtimeValue,
      )
      const consumed = createHash('sha256')
        .update(materializedScript)
        .digest('hex')
      if (!consumed || materializedScript.includes(productPlaceholder)) {
        throw new Error(
          'Controlled Replay did not consume the full .ad Scenario',
        )
      }
      return {
        replayed: templateSteps.length,
        healed: 0,
        inferenceCount: 0,
        session: 'controlled-mobile-benchmark',
        sessionActive: true,
        artifactPaths: [],
        message: 'Controlled Replay completed',
      }
    },
  },
  capture: {
    async screenshot() {},
  },
  observability: {
    async logs() {},
  },
  recording: {
    async record() {},
    async trace() {},
  },
  sessions: {
    async close() {},
  },
}

function compileReplayRepresentation(): string {
  const compiled = compileMobileScenario({
    platform: 'android',
    applicationId,
    scenario,
  })
  const validated = executionCache.parse(
    compiled.payload,
    compiled.requiredVariables,
  )
  if (!validated) throw new Error('Controlled Adaptive payload was rejected')
  return JSON.stringify({
    adapterPayload: validated,
    requiredVariables: compiled.requiredVariables,
  })
}

async function executeReplayRepresentation(serialized: string): Promise<void> {
  const envelope = benchmarkEnvelopeSchema.parse(JSON.parse(serialized))
  const payload = executionCache.parse(
    envelope.adapterPayload,
    envelope.requiredVariables,
  )
  if (!payload) throw new Error('Controlled Replay payload was rejected')
  await executePrivateAgentDeviceReplay({
    client: controlledClient,
    selection: { platform: 'android', serial: 'controlled-emulator' },
    script: payload.script,
    runtimeEnv: [`${productVariable}=${runtimeProduct}`],
  })
}

let serializedReplayRepresentation = compileReplayRepresentation()

export async function measureControlledMobileBenchmark(
  mode: MobileBenchmarkMode,
): Promise<number> {
  const startedAt = performance.now()
  if (mode === 'adaptive') {
    serializedReplayRepresentation = compileReplayRepresentation()
  }
  await executeReplayRepresentation(serializedReplayRepresentation)
  return performance.now() - startedAt
}
