import type { GitWorkspace } from '../../server/git'
import {
  requestError,
  routeKey,
  type StudioHttpHandler,
} from '../../server/http'

type GitPathsRequest = {
  paths?: string[]
}

type GitCommitRequest = {
  message?: string
  confirmed?: boolean
  paths?: string[]
}

export function createGitRoutes(git: GitWorkspace): StudioHttpHandler {
  async function stage(request: Request): Promise<Response> {
    const body = (await request.json()) as GitPathsRequest
    try {
      return Response.json(await git.stage(body.paths ?? []))
    } catch (error) {
      return requestError(error)
    }
  }

  async function commit(request: Request): Promise<Response> {
    const body = (await request.json()) as GitCommitRequest
    try {
      return Response.json(
        await git.commit({
          message: body.message ?? '',
          confirmed: Boolean(body.confirmed),
          paths: body.paths ?? [],
        }),
      )
    } catch (error) {
      return requestError(error)
    }
  }

  async function pullRequest(): Promise<Response> {
    try {
      return Response.json(await git.pullRequest())
    } catch (error) {
      return requestError(error)
    }
  }

  return async function handleGitRequest(request, url) {
    const routes: Record<string, () => Promise<Response>> = {
      'GET /api/git': async () => Response.json(await git.status()),
      'POST /api/git/stage': () => stage(request),
      'POST /api/git/commit': () => commit(request),
      'POST /api/git/pull-request': pullRequest,
    }
    return routes[routeKey(request, url)]?.() ?? null
  }
}
