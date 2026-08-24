import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createAllureResultsZip,
  projectAllureResults,
  type TestRunManifest,
} from '../index'

function readStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const files = new Map<string, Uint8Array>()
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    expect(view.getUint16(offset + 8, true)).toBe(0)
    const compressedSize = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = decoder.decode(bytes.subarray(nameStart, dataStart))
    files.set(name, bytes.slice(dataStart, dataStart + compressedSize))
    offset = dataStart + compressedSize
  }
  expect(view.getUint32(offset, true)).toBe(0x02014b50)
  return files
}

function manifest(artifactPath: string): TestRunManifest {
  return {
    schemaVersion: 2,
    id: 'run-allure-zip',
    startedAt: '2026-08-24T12:00:00.000Z',
    finishedAt: '2026-08-24T12:00:01.000Z',
    state: 'failed',
    results: [
      {
        schemaVersion: 2,
        specification: {
          name: 'Checkout',
          uri: 'features/checkout.feature',
        },
        scenario: { id: 'scenario-pay', name: 'Pay for the order' },
        executionTargetProfile: { id: 'android' },
        state: 'failed',
        startedAt: '2026-08-24T12:00:00.000Z',
        finishedAt: '2026-08-24T12:00:01.000Z',
        durationMs: 1_000,
        attempts: [
          {
            attempt: 1,
            startedAt: '2026-08-24T12:00:00.000Z',
            finishedAt: '2026-08-24T12:00:01.000Z',
            durationMs: 1_000,
            state: 'failed',
            steps: [
              {
                index: 0,
                startedAt: '2026-08-24T12:00:00.000Z',
                finishedAt: '2026-08-24T12:00:01.000Z',
                durationMs: 1_000,
                step: {
                  keyword: 'Then',
                  text: 'payment is captured',
                  type: 'outcome',
                },
                state: 'failed',
                resolvedActions: [],
                artifacts: [
                  {
                    kind: 'screenshot',
                    path: artifactPath,
                    mediaType: 'image/png',
                  },
                ],
              },
            ],
            evidenceAvailability: [
              { kind: 'screenshot', state: 'available' },
              { kind: 'trace', state: 'not-requested' },
              { kind: 'recording', state: 'not-requested' },
              { kind: 'device-log', state: 'not-requested' },
              { kind: 'diagnostics', state: 'not-requested' },
            ],
          },
        ],
      },
    ],
  }
}

test('creates an in-memory Allure ZIP equivalent to the directory projection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pickle-allure-zip-'))
  try {
    const artifactsDirectory = join(root, 'artifacts')
    await mkdir(artifactsDirectory)
    const artifactPath = join(artifactsDirectory, 'failure.png')
    const artifactBytes = new Uint8Array([0, 255, 80, 75, 3, 4])
    await Bun.write(artifactPath, artifactBytes)
    const testRun = manifest(artifactPath)
    const projection = projectAllureResults(testRun)

    const zipBytes = await createAllureResultsZip(testRun, {
      artifactsDirectory,
    })
    const files = readStoredZip(zipBytes)

    expect([...zipBytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect([...files.keys()].sort()).toEqual(
      [
        ...projection.results.map(({ fileName }) => fileName),
        ...projection.attachments.map(({ fileName }) => fileName),
      ].sort(),
    )
    for (const { fileName, result } of projection.results) {
      expect(await new Blob([files.get(fileName)!]).text()).toBe(
        `${JSON.stringify(result, null, 2)}\n`,
      )
    }
    expect(files.get(projection.attachments[0]!.fileName)).toEqual(
      artifactBytes,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects Allure attachments outside the selected Test run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pickle-allure-zip-'))
  try {
    const artifactPath = join(root, 'outside.png')
    await Bun.write(artifactPath, 'private')

    await expect(
      createAllureResultsZip(manifest(artifactPath), {
        artifactsDirectory: join(root, 'run', 'artifacts'),
      }),
    ).rejects.toThrow('escapes the Test run')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bounds in-memory Allure ZIP creation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pickle-allure-zip-'))
  try {
    const artifactsDirectory = join(root, 'artifacts')
    await mkdir(artifactsDirectory)
    const artifactPath = join(artifactsDirectory, 'large.png')
    await Bun.write(artifactPath, new Uint8Array(32))

    await expect(
      createAllureResultsZip(manifest(artifactPath), {
        artifactsDirectory,
        maximumBytes: 1,
      }),
    ).rejects.toThrow('in-memory limit')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
