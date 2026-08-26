import type { StudioRunRequest } from '../server/server'

export type RunOrigin =
  | { kind: 'all' }
  | { kind: 'specification' }
  | { kind: 'refresh' }
  | { kind: 'scenario'; scenarioId: string }

export function runOriginFromRequest(request: StudioRunRequest): RunOrigin {
  if (request.scenarioId) {
    return { kind: 'scenario', scenarioId: request.scenarioId }
  }
  if (request.refreshCache) return { kind: 'refresh' }
  if (!request.paths?.length) return { kind: 'all' }
  return { kind: 'specification' }
}

export function isBusyOrigin(
  origin: RunOrigin | undefined,
  control: RunOrigin,
): boolean {
  if (!origin) return false
  if (origin.kind === 'scenario' && control.kind === 'scenario') {
    return origin.scenarioId === control.scenarioId
  }
  return origin.kind === control.kind
}
