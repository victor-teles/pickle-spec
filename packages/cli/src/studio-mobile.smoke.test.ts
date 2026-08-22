import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

type SmokePlatform = 'android' | 'ios'

type SmokeConfiguration = {
  applicationId: string
  binaryPath: string
  executionTarget: 'android-emulator' | 'ios-simulator'
  profileId: string
  stepText: string
  targetId?: string
}

type StudioRunSnapshot = {
  manifest?: {
    finishedAt?: string
    results: Array<{
      state: string
      executionTargetProfile: { id: string }
    }>
  }
}

function smokeConfiguration(platform: SmokePlatform): SmokeConfiguration {
  const prefix = platform === 'android' ? 'ANDROID' : 'IOS'
  const applicationId = process.env[`PICKLE_${prefix}_APP_ID`]
  const binaryPath = process.env[`PICKLE_${prefix}_APP_PATH`]
  const stepText = process.env[`PICKLE_${prefix}_SMOKE_STEP`]
  if (!applicationId || !binaryPath || !stepText) {
    throw new Error(
      `Set PICKLE_${prefix}_APP_ID, PICKLE_${prefix}_APP_PATH, and PICKLE_${prefix}_SMOKE_STEP`,
    )
  }
  return {
    applicationId,
    binaryPath,
    stepText,
    executionTarget:
      platform === 'android' ? 'android-emulator' : 'ios-simulator',
    profileId: `${platform}-studio-smoke`,
    targetId: process.env[`PICKLE_${prefix}_TARGET_ID`],
  }
}

async function studioUrl(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const deadline = Date.now() + 45_000
  let output = ''
  while (Date.now() < deadline) {
    const { done, value } = await reader.read()
    if (done) break
    output += decoder.decode(value, { stream: true })
    const match = output.match(/Studio (http:\/\/127\.0\.0\.1:\d+\S*)/)
    if (match?.[1]) return match[1]
  }
  throw new Error(`Studio did not start.\n${output}`)
}

async function runStudioMobileSmoke(platform: SmokePlatform): Promise<void> {
  const configuration = smokeConfiguration(platform)
  const project = await mkdtemp(join(tmpdir(), `pickle-studio-${platform}-`))
  await mkdir(join(project, 'features'))
  await Bun.write(
    join(project, 'features', 'mobile-smoke.feature'),
    `@pickle:id:specmobilesmokeaaa @pickle:state:active
Feature: Studio mobile smoke
  @pickle:id:scnmobilesmokebbbb
  Scenario: Run on a provisioned ${configuration.executionTarget}
    Then ${configuration.stepText}
`,
  )
  await Bun.write(
    join(project, 'pickle.config.jsonc'),
    JSON.stringify({
      schemaVersion: 1,
      specifications: 'features/**/*.feature',
      executionTargetProfiles: {
        [configuration.profileId]: {
          adapter: 'mobile',
          mobile: {
            executionTarget: configuration.executionTarget,
            application: {
              id: configuration.applicationId,
              binaryPath: configuration.binaryPath,
            },
            targetId: configuration.targetId,
            nodePath: process.env.PICKLE_NODE_PATH,
          },
        },
      },
    }),
  )
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      resolve(import.meta.dir, 'cli.ts'),
      'studio',
      '--no-open',
    ],
    cwd: project,
    env: { ...Bun.env },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  try {
    const url = await studioUrl(child.stdout)
    const parsedUrl = new URL(url)
    const token = parsedUrl.searchParams.get('token')
    if (!token) throw new Error('Studio URL did not include a session token')
    const origin = parsedUrl.origin
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    }
    const discoveryResponse = await fetch(`${origin}/api/mobile-targets`, {
      headers,
    })
    expect(discoveryResponse.ok).toBe(true)
    const discoveries = (await discoveryResponse.json()) as Array<{
      profileId: string
      targets: Array<{ id: string; state: string }>
    }>
    const targets = discoveries.find(
      (item) => item.profileId === configuration.profileId,
    )?.targets
    expect(
      targets?.some(
        (target) =>
          target.state === 'booted' &&
          (!configuration.targetId || target.id === configuration.targetId),
      ),
    ).toBe(true)

    const startResponse = await fetch(`${origin}/api/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ profiles: [configuration.profileId] }),
    })
    if (!startResponse.ok) throw new Error(await startResponse.text())
    const { id } = (await startResponse.json()) as { id: string }
    const deadline = Date.now() + 120_000
    let snapshot: StudioRunSnapshot = {}
    while (Date.now() < deadline) {
      const response = await fetch(
        `${origin}/api/runs/${encodeURIComponent(id)}`,
        { headers },
      )
      if (!response.ok) throw new Error(await response.text())
      snapshot = (await response.json()) as StudioRunSnapshot
      if (snapshot.manifest?.finishedAt) break
      await Bun.sleep(250)
    }
    expect(snapshot.manifest?.finishedAt).toBeTruthy()
    expect(snapshot.manifest?.results).toEqual([
      expect.objectContaining({
        state: 'passed',
        executionTargetProfile: { id: configuration.profileId },
      }),
    ])
  } finally {
    child.kill()
    await child.exited
    await rm(project, { recursive: true, force: true })
  }
}

const androidSmokeTest =
  process.env.PICKLE_STUDIO_ANDROID_SMOKE === '1' ? test : test.skip
const iosSmokeTest =
  process.env.PICKLE_STUDIO_IOS_SMOKE === '1' ? test : test.skip

androidSmokeTest(
  'Studio runs against a provisioned Android Emulator',
  () => runStudioMobileSmoke('android'),
  180_000,
)

iosSmokeTest(
  'Studio runs against a provisioned iOS Simulator',
  () => runStudioMobileSmoke('ios'),
  180_000,
)
