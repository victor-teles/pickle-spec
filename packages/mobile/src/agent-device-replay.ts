import { chmod, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type {
  AgentDeviceClientPort,
  MobileSelection,
} from './agent-device-client'

const replayResultSchema = z.strictObject({
  replayed: z.number().int().nonnegative(),
  healed: z.number().int().nonnegative(),
  session: z.string(),
  sessionActive: z.boolean(),
  artifactPaths: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
  message: z.string(),
})

interface ExecutePrivateAgentDeviceReplayInput {
  client: AgentDeviceClientPort
  selection: MobileSelection
  script: string
  runtimeEnv: readonly string[]
}

export async function executePrivateAgentDeviceReplay(
  input: ExecutePrivateAgentDeviceReplayInput,
): Promise<z.infer<typeof replayResultSchema>> {
  const directory = await mkdtemp(join(tmpdir(), 'pickle-agent-device-'))
  const path = join(directory, 'scenario.ad')
  try {
    await chmod(directory, 0o700)
    const file = await open(path, 'wx', 0o600)
    try {
      await file.writeFile(input.script, 'utf8')
    } finally {
      await file.close()
    }
    await chmod(path, 0o600)
    if (input.client.inferenceAudit.count() !== 0) {
      throw new Error(
        'Agent Device Replay called a semantic inference route outside replay.run',
      )
    }
    const result = replayResultSchema.parse(
      await input.client.replay.run({
        ...input.selection,
        path,
        env: [...input.runtimeEnv],
      }),
    )
    if (result.healed !== 0) {
      throw new Error('Agent Device Replay unexpectedly healed the Scenario')
    }
    if (input.client.inferenceAudit.count() !== 0) {
      throw new Error(
        'Agent Device Replay called a semantic inference route outside replay.run',
      )
    }
    return result
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
