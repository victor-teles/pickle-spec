import {
  requestError,
  routeKey,
  type StudioHttpHandler,
  unavailable,
} from '../../server/http'
import type { StudioRunRequest } from '../runs/run.contracts'
import type {
  StudioConfigPatch,
  StudioManagementGateway,
  StudioProject,
} from './project.contracts'

type CredentialWriteRequest = {
  name?: string
  secret?: string
}

interface ProjectRoutesOptions {
  loadProject(): Promise<StudioProject>
  management?: StudioManagementGateway
}

export function createProjectRoutes(
  options: ProjectRoutesOptions,
): StudioHttpHandler {
  async function saveConfig(request: Request): Promise<Response> {
    if (!options.management) {
      return unavailable('Project configuration is unavailable')
    }
    try {
      const patch = (await request.json()) as StudioConfigPatch
      return Response.json(await options.management.saveConfig(patch))
    } catch (error) {
      return requestError(error)
    }
  }

  async function saveCredential(request: Request): Promise<Response> {
    if (!options.management) return unavailable('Credentials are unavailable')
    try {
      const body = (await request.json()) as CredentialWriteRequest
      return Response.json(
        await options.management.saveCredential({
          name: body.name ?? '',
          secret: body.secret ?? '',
        }),
      )
    } catch (error) {
      return requestError(error)
    }
  }

  async function runReadiness(request: Request): Promise<Response> {
    if (!options.management) {
      const project = await options.loadProject()
      return Response.json(project.readiness ?? { ready: true, reasons: [] })
    }
    const body = (await request.json().catch(() => ({}))) as StudioRunRequest
    return Response.json(await options.management.readiness(body))
  }

  async function mobileTargets(): Promise<Response> {
    if (!options.management?.discoverMobileTargets) {
      return unavailable('Mobile target discovery is unavailable')
    }
    return Response.json(await options.management.discoverMobileTargets())
  }

  return async function handleProjectRequest(request, url) {
    const routes: Record<string, () => Promise<Response>> = {
      'GET /api/project': async () =>
        Response.json(await options.loadProject()),
      'PUT /api/config': () => saveConfig(request),
      'PUT /api/credentials': () => saveCredential(request),
      'POST /api/run-readiness': () => runReadiness(request),
      'GET /api/mobile-targets': mobileTargets,
    }
    return routes[routeKey(request, url)]?.() ?? null
  }
}
