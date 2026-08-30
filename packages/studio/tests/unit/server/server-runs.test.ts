import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { requiredValue } from '../../../src/required-value'
import { type StudioRunGateway, startStudio } from '../../../src/server/server'

const directories: string[] = []
const servers: Array<{ stop(): void }> = []

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop()
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

test('serves the Runs index, active lifecycle, compatibility alias, and deep links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pickle-studio-runs-'))
  directories.push(root)
  const completion = Promise.withResolvers<void>()
  const schedule = [
    {
      specification: { name: 'Checkout', uri: 'features/checkout.feature' },
      scenario: { id: 'scenario', name: 'Pay' },
      executionTargetProfile: { id: 'chrome' },
    },
  ]
  const gateway: StudioRunGateway = {
    async start(_request, onEvent) {
      onEvent({ type: 'run-scheduled', schedule })
      onEvent({
        schemaVersion: 2,
        sequence: 1,
        occurredAt: '2026-08-24T12:00:00.000Z',
        type: 'run-started',
        run: { id: 'run-live', startedAt: '2026-08-24T12:00:00.000Z' },
      })
      const target = { scenarioId: 'scenario', profileId: 'chrome', attempt: 1 }
      onEvent({
        type: 'viewport-updated',
        target,
        viewport: {
          kind: 'frame',
          data: 'first-frame',
          mimeType: 'image/jpeg',
        },
      })
      onEvent({
        type: 'viewport-updated',
        target,
        viewport: {
          kind: 'frame',
          data: 'latest-frame',
          mimeType: 'image/jpeg',
        },
      })
      return { id: 'run-live', done: completion.promise }
    },
    async snapshot(id) {
      return { id, events: [] }
    },
    async cancel() {},
  }
  const server = await startStudio({
    project: {
      name: 'Runs test',
      root,
      profiles: [],
      suites: [],
      specifications: [],
    },
    gateway,
    history: {
      async list() {
        return {
          runs: [],
          retention: {},
          storage: {
            totalBytes: 0,
            warningThresholdBytes: 1,
            warning: false,
            pinnedRunIds: [],
          },
        }
      },
      async compare() {
        throw new Error('not used')
      },
      async importArchive() {
        throw new Error('not used')
      },
      async exportArchive() {
        throw new Error('not used')
      },
      async exportHtml() {
        throw new Error('not used')
      },
      async exportAllure() {
        throw new Error('not used')
      },
      async deleteEligible() {
        return { removed: [], beforeBytes: 0, afterBytes: 0 }
      },
      async pin() {},
      async unpin() {},
    },
    token: 'runs-token',
  })
  servers.push(server)
  const origin = new URL(server.url).origin
  const headers = { Authorization: 'Bearer runs-token' }

  const initial = await fetch(`${origin}/api/runs`, { headers })
  expect(initial.status).toBe(200)
  expect((await initial.json()).activeRunIds).toEqual([])

  const started = await fetch(`${origin}/api/runs`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: '{}',
  })
  expect(started.status).toBe(200)
  expect((await started.json()).id).toBe('run-live')

  const active = await fetch(`${origin}/api/runs`, { headers })
  expect((await active.json()).activeRunIds).toEqual(['run-live'])
  const activeSnapshot = await fetch(`${origin}/api/runs/run-live`, { headers })
  expect((await activeSnapshot.json()).schedule).toEqual(schedule)
  const alias = await fetch(`${origin}/api/history`, { headers })
  expect((await alias.json()).activeRunIds).toEqual(['run-live'])

  const replayedSchedule = await new Promise<unknown>((resolve, reject) => {
    const socket = new WebSocket(
      `${origin.replace(/^http/, 'ws')}/api/runs/run-live/events?token=runs-token`,
    )
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('Timed out waiting for the scheduled run replay'))
    }, 2_000)
    socket.addEventListener('message', (event) => {
      const value = JSON.parse(String(event.data))
      if (value.type !== 'run-scheduled') return
      clearTimeout(timeout)
      socket.close()
      resolve(value.schedule)
    })
    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('Run event WebSocket failed'))
    })
  })
  expect(replayedSchedule).toEqual(schedule)

  const replayedViewports = await new Promise<string[]>((resolve, reject) => {
    const frames: string[] = []
    const socket = new WebSocket(
      `${origin.replace(/^http/, 'ws')}/api/runs/run-live/events?token=runs-token`,
    )
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('Timed out waiting for viewport replay'))
    }, 2_000)
    socket.addEventListener('message', (event) => {
      const value = JSON.parse(String(event.data))
      if (value.type !== 'viewport-updated') return
      frames.push(value.viewport.data)
      setTimeout(() => {
        clearTimeout(timeout)
        socket.close()
        resolve(frames)
      }, 50)
    })
  })
  expect(replayedViewports).toEqual(['latest-frame'])

  const pagePaths = [
    '/',
    '/specifications/checkout',
    '/specifications/checkout/scenarios/scenario',
    '/runs',
    '/runs/run-live',
    '/runs/run-live/results/features%2Fcheckout.feature/scenarios/scenario/profiles/chrome/attempts/1?tab=timeline',
    '/runs/run-live/results/features%2Fcheckout.feature/scenarios/scenario/profiles/chrome/attempts/1?tab=viewport',
    '/runs/run-live/results/features%2Fcheckout.feature/scenarios/scenario/examples/row-1/profiles/chrome/attempts/1',
    '/runs/run-live/results/features%2Fcheckout.feature/scenarios/scenario/profiles/chrome/attempts/1/artifacts/0',
  ]
  for (const path of pagePaths) {
    const page = await fetch(
      `${origin}${path}${path.includes('?') ? '&' : '?'}token=runs-token`,
    )
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('set-cookie')).toContain('pickle_studio_token')
  }

  const deepLink = await fetch(
    `${origin}/runs/run-live/results/features%2Fcheckout.feature/scenarios/scenario/profiles/chrome/attempts/1?token=runs-token`,
  )
  const document = await deepLink.text()
  const scriptPath = document.match(/<script[^>]+src="([^"]+)"/)?.[1]
  expect(scriptPath).toBeDefined()
  const script = await fetch(new URL(requiredValue(scriptPath), deepLink.url), {
    headers,
  })
  expect(script.status).toBe(200)
  expect(script.headers.get('content-type')).not.toContain('text/html')
  expect(await script.text()).not.toContain('<!doctype html>')
  const unknownPath = await fetch(
    `${origin}/runs/run-live/results/incomplete?token=runs-token`,
  )
  expect(unknownPath.status).toBe(404)
  const legacyPath = await fetch(
    `${origin}/runs/run-live/results/scenario/chrome/1?specification=features%2Fcheckout.feature&token=runs-token`,
  )
  expect(legacyPath.status).toBe(404)
  const indexAsset = await fetch(`${origin}/index.html?token=runs-token`)
  expect(indexAsset.status).toBe(200)
  expect(indexAsset.headers.get('content-type')).toContain('text/html')
  expect(indexAsset.headers.get('set-cookie')).toContain('pickle_studio_token')
  expect(indexAsset.headers.get('content-security-policy')).toContain(
    "frame-src 'self' https://browserbase.com https://*.browserbase.com",
  )
  const unauthorizedDeepLink = await fetch(
    `${origin}/specifications/checkout/scenarios/scenario`,
  )
  expect(unauthorizedDeepLink.status).toBe(401)

  completion.resolve()
  await completion.promise
  await Bun.sleep(0)
  const finished = await fetch(`${origin}/api/runs`, { headers })
  expect((await finished.json()).activeRunIds).toEqual([])
})

test('compiles the Studio UI once for concurrent servers', async () => {
  async function serve() {
    const root = await mkdtemp(join(tmpdir(), 'pickle-studio-ui-'))
    directories.push(root)
    const server = await startStudio({
      project: {
        name: 'UI',
        root,
        profiles: [],
        suites: [],
        specifications: [],
      },
    })
    servers.push(server)
    return server
  }

  async function compiledScript(url: string) {
    const origin = new URL(url).origin
    const token = new URL(url).searchParams.get('token')
    const headers = { Authorization: `Bearer ${token}` }
    const page = await fetch(url)
    expect(page.status).toBe(200)
    const document = await page.text()
    const scriptPath = document.match(/<script[^>]+src="([^"]+)"/)?.[1]
    expect(scriptPath).toBeDefined()
    const script = await fetch(new URL(requiredValue(scriptPath), origin), {
      headers,
    })
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).not.toContain('text/html')
    expect(await script.text()).not.toContain('<!doctype html>')
  }

  const [first, second] = await Promise.all([serve(), serve()])
  await Promise.all([compiledScript(first.url), compiledScript(second.url)])
})

test('replays a completed run to a socket that connects after completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pickle-studio-completed-run-'))
  directories.push(root)
  const server = await startStudio({
    project: {
      name: 'Completed run replay',
      root,
      profiles: [],
      suites: [],
      specifications: [],
    },
    gateway: {
      async start(_request, onEvent) {
        onEvent({
          schemaVersion: 2,
          sequence: 1,
          occurredAt: '2026-08-30T12:00:00.000Z',
          type: 'run-started',
          run: {
            id: 'run-complete',
            startedAt: '2026-08-30T12:00:00.000Z',
          },
        })
        return { id: 'run-complete', done: Promise.resolve() }
      },
      async snapshot(id) {
        return { id, events: [] }
      },
      async cancel() {},
    },
    token: 'completed-token',
  })
  servers.push(server)
  const origin = new URL(server.url).origin
  await fetch(`${origin}/api/runs`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer completed-token',
      'content-type': 'application/json',
    },
    body: '{}',
  })
  await Bun.sleep(0)

  const replayedTypes = await new Promise<string[]>((resolve, reject) => {
    const types: string[] = []
    const socket = new WebSocket(
      `${origin.replace(/^http/, 'ws')}/api/runs/run-complete/events?token=completed-token`,
    )
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('Timed out waiting for completed run replay'))
    }, 2_000)
    socket.addEventListener('message', (event) => {
      types.push(JSON.parse(String(event.data)).type)
      if (!types.includes('run-finished')) return
      clearTimeout(timeout)
      socket.close()
      resolve(types)
    })
  })

  expect(replayedTypes).toEqual(['run-started', 'run-finished'])
})
