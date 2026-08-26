import { useEffect, useState } from 'react'
import type { StudioApi } from '../app/studio-api'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { toast } from '../components/ui/toast'
import type { StudioMobileProfile } from '../server/server'
import { ExecutionCacheSettings } from './execution-cache-settings'
import { MobileProfileSettings } from './mobile-profile-settings'

type StudioSuite = {
  name: string
  paths?: string | readonly string[]
  tagExpression?: string
  states?: readonly string[]
  scenarioName?: string
}

type StudioProfile = {
  id: string
  adapter: string
  capabilities?: readonly string[]
  mobile?: StudioMobileProfile
}

type StudioCredential = {
  name: string
  present: boolean
}

type GitFile = {
  path: string
  status: string
  staged: boolean
  diff: string
}

type GitStatus = {
  branch?: string
  files: GitFile[]
  pullRequestAvailable: boolean
  pullRequestReason?: string
}

const specificationStates = ['draft', 'active', 'deprecated'] as const

function reasonMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

function pathsText(paths: StudioSuite['paths']): string {
  if (!paths) return ''
  if (typeof paths === 'string') return paths
  return paths.join(', ')
}

export function SettingsPanel<
  T extends {
    suiteDetails?: readonly StudioSuite[]
    profileDetails?: readonly StudioProfile[]
    secrets?: readonly StudioCredential[]
  },
>(props: {
  project: T
  api: StudioApi
  onProject: (project: T) => void
  onError: (message: string | undefined) => void
}) {
  const [suiteName, setSuiteName] = useState(
    props.project.suiteDetails?.[0]?.name ?? '',
  )
  const [originalSuiteName, setOriginalSuiteName] = useState(suiteName)
  const selectedSuite = props.project.suiteDetails?.find(
    (suite) => suite.name === originalSuiteName,
  )
  const [suitePaths, setSuitePaths] = useState(pathsText(selectedSuite?.paths))
  const [suiteTags, setSuiteTags] = useState(selectedSuite?.tagExpression ?? '')
  const [suiteStates, setSuiteStates] = useState(
    (selectedSuite?.states ?? ['active']).join(', '),
  )
  const [suiteScenario, setSuiteScenario] = useState(
    selectedSuite?.scenarioName ?? '',
  )
  const [profileId, setProfileId] = useState(
    props.project.profileDetails?.[0]?.id ?? '',
  )
  const selectedProfile =
    props.project.profileDetails?.find((profile) => profile.id === profileId) ??
    props.project.profileDetails?.[0]
  const [adapter, setAdapter] = useState(selectedProfile?.adapter ?? 'custom')
  const [capabilities, setCapabilities] = useState(
    (selectedProfile?.capabilities ?? []).join(', '),
  )
  const [mobileProfile, setMobileProfile] = useState<StudioMobileProfile>(
    selectedProfile?.mobile ?? {
      executionTarget: 'android-emulator',
      application: { id: '', binaryPath: '' },
    },
  )
  const [secretName, setSecretName] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const [git, setGit] = useState<GitStatus>()
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [commitMessage, setCommitMessage] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [expandedDiff, setExpandedDiff] = useState<string>()

  useEffect(() => {
    if (!originalSuiteName) {
      setSuitePaths('')
      setSuiteTags('')
      setSuiteStates('active')
      setSuiteScenario('')
      return
    }
    const suite = props.project.suiteDetails?.find(
      (item) => item.name === originalSuiteName,
    )
    if (!suite) return
    setSuitePaths(pathsText(suite.paths))
    setSuiteTags(suite.tagExpression ?? '')
    setSuiteStates((suite.states ?? ['active']).join(', '))
    setSuiteScenario(suite.scenarioName ?? '')
  }, [props.project.suiteDetails, originalSuiteName])

  useEffect(() => {
    const profile =
      props.project.profileDetails?.find((item) => item.id === profileId) ??
      props.project.profileDetails?.[0]
    setAdapter(profile?.adapter ?? 'custom')
    setCapabilities((profile?.capabilities ?? []).join(', '))
    setMobileProfile(
      profile?.mobile ?? {
        executionTarget: 'android-emulator',
        application: { id: '', binaryPath: '' },
      },
    )
  }, [props.project.profileDetails, profileId])

  useEffect(() => {
    let cancelled = false
    props
      .api<GitStatus>('/api/git')
      .then((value) => {
        if (!cancelled) setGit(value)
      })
      .catch((reason: unknown) => {
        if (!cancelled) props.onError(reasonMessage(reason))
      })
    return () => {
      cancelled = true
    }
  }, [props.api, props.onError])

  async function saveSuites() {
    const name = suiteName.trim()
    if (!name) {
      props.onError('A test suite name is required')
      return
    }
    const suites = Object.fromEntries(
      (props.project.suiteDetails ?? []).map((suite) => [
        suite.name,
        {
          ...(suite.paths ? { paths: suite.paths } : {}),
          ...(suite.tagExpression
            ? { tagExpression: suite.tagExpression }
            : {}),
          ...(suite.states ? { states: suite.states } : {}),
          ...(suite.scenarioName ? { scenarioName: suite.scenarioName } : {}),
        },
      ]),
    )
    const paths = suitePaths
      .split(',')
      .map((path) => path.trim())
      .filter(Boolean)
    const states = suiteStates
      .split(',')
      .map((state) => state.trim())
      .filter((state): state is (typeof specificationStates)[number] =>
        specificationStates.includes(
          state as (typeof specificationStates)[number],
        ),
      )
    suites[name] = {
      ...(paths.length ? { paths } : {}),
      ...(suiteTags.trim() ? { tagExpression: suiteTags.trim() } : {}),
      ...(states.length ? { states } : {}),
      ...(suiteScenario.trim() ? { scenarioName: suiteScenario.trim() } : {}),
    }
    if (originalSuiteName && originalSuiteName !== name) {
      delete suites[originalSuiteName]
    }
    props.onError(undefined)
    try {
      props.onProject(
        await props.api<T>('/api/config', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ suites }),
        }),
      )
      setOriginalSuiteName(name)
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  async function saveProfiles() {
    const id = profileId.trim()
    if (!id) {
      props.onError('An execution target profile id is required')
      return
    }
    const profiles = Object.fromEntries(
      (props.project.profileDetails ?? []).map((profile) => [
        profile.id,
        {
          adapter: profile.adapter,
          ...(profile.capabilities
            ? { capabilities: profile.capabilities }
            : {}),
          ...(profile.mobile ? { mobile: profile.mobile } : {}),
        },
      ]),
    )
    const nextCapabilities = capabilities
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    profiles[id] = {
      adapter: adapter.trim() || 'custom',
      ...(nextCapabilities.length ? { capabilities: nextCapabilities } : {}),
      ...(adapter.trim() === 'mobile'
        ? {
            mobile: {
              ...mobileProfile,
              targetId: mobileProfile.targetId?.trim() || undefined,
              application: {
                id: mobileProfile.application.id.trim(),
                binaryPath: mobileProfile.application.binaryPath.trim(),
              },
            },
          }
        : {}),
    }
    props.onError(undefined)
    try {
      const project = await props.api<T>('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ executionTargetProfiles: profiles }),
      })
      props.onProject(project)
      toast.add({
        type: 'success',
        title: 'Execution target profile saved',
        description: `${id} is ready for Test runs.`,
      })
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  async function saveCredential() {
    props.onError(undefined)
    try {
      props.onProject(
        await props.api<T>('/api/credentials', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: secretName, secret: secretValue }),
        }),
      )
      setSecretValue('')
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  async function refreshGit() {
    setGit(await props.api<GitStatus>('/api/git'))
  }

  async function stageSelected() {
    props.onError(undefined)
    try {
      setGit(
        await props.api<GitStatus>('/api/git/stage', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ paths: selectedPaths }),
        }),
      )
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  async function commitSelected() {
    props.onError(undefined)
    try {
      setGit(
        await props.api<GitStatus>('/api/git/commit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: commitMessage,
            confirmed: true,
            paths: selectedPaths,
          }),
        }),
      )
      setConfirmOpen(false)
      setCommitMessage('')
      setSelectedPaths([])
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  async function openPullRequest() {
    props.onError(undefined)
    try {
      await props.api('/api/git/pull-request', { method: 'POST' })
      await refreshGit()
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }

  const secrets: readonly StudioCredential[] = props.project.secrets ?? []
  const profiles: readonly StudioProfile[] = props.project.profileDetails ?? []
  const suites: readonly StudioSuite[] = props.project.suiteDetails ?? []

  return (
    <main className="mx-auto min-w-0 max-w-5xl space-y-6 p-4 sm:p-5">
      <header className="space-y-1">
        <h1 className="studio-display text-xl">Project settings</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Configure execution, credentials, and the local repository for this
          project.
        </p>
      </header>
      <ExecutionCacheSettings api={props.api} />

      <section
        className="space-y-4 border-t border-border pt-5"
        aria-labelledby="suites-heading"
      >
        <h2 id="suites-heading" className="studio-display text-sm">
          Test suites
        </h2>
        <div className="flex flex-wrap gap-1">
          {suites.map((suite) => (
            <Button
              key={suite.name}
              type="button"
              size="sm"
              variant={suite.name === originalSuiteName ? 'default' : 'outline'}
              aria-pressed={suite.name === originalSuiteName}
              onClick={() => {
                setSuiteName(suite.name)
                setOriginalSuiteName(suite.name)
              }}
            >
              {suite.name}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setSuiteName('')
              setOriginalSuiteName('')
              setSuitePaths('')
              setSuiteTags('')
              setSuiteStates('active')
              setSuiteScenario('')
            }}
          >
            New test suite
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="suite-name">Suite name</Label>
            <Input
              id="suite-name"
              aria-label="Suite name"
              value={suiteName}
              onChange={(event) => setSuiteName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="suite-paths">Paths</Label>
            <Input
              id="suite-paths"
              aria-label="Suite paths"
              value={suitePaths}
              onChange={(event) => setSuitePaths(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="suite-tags">Tag expression</Label>
            <Input
              id="suite-tags"
              aria-label="Suite tag expression"
              value={suiteTags}
              onChange={(event) => setSuiteTags(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="suite-states">States</Label>
            <Input
              id="suite-states"
              aria-label="Suite states"
              value={suiteStates}
              onChange={(event) => setSuiteStates(event.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="suite-scenario">Scenario name</Label>
            <Input
              id="suite-scenario"
              aria-label="Suite scenario name"
              value={suiteScenario}
              onChange={(event) => setSuiteScenario(event.target.value)}
            />
          </div>
        </div>
        <Button type="button" onClick={() => void saveSuites()}>
          Save test suite
        </Button>
      </section>

      <section
        className="space-y-4 border-t border-border pt-5"
        aria-labelledby="profiles-heading"
      >
        <h2 id="profiles-heading" className="studio-display text-sm">
          Execution target profiles
        </h2>
        <div className="flex flex-wrap gap-1">
          {profiles.map((profile) => (
            <Button
              key={profile.id}
              type="button"
              size="sm"
              variant={profile.id === profileId ? 'default' : 'outline'}
              aria-pressed={profile.id === profileId}
              onClick={() => setProfileId(profile.id)}
            >
              {profile.id}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="profile-id">Profile id</Label>
            <Input
              id="profile-id"
              aria-label="Profile id"
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="profile-adapter">Adapter</Label>
            <Input
              id="profile-adapter"
              aria-label="Profile adapter"
              value={adapter}
              onChange={(event) => setAdapter(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="profile-capabilities">Capabilities</Label>
            <Input
              id="profile-capabilities"
              aria-label="Profile capabilities"
              value={capabilities}
              onChange={(event) => setCapabilities(event.target.value)}
            />
          </div>
        </div>
        {adapter.trim() === 'mobile' ? (
          <MobileProfileSettings
            api={props.api}
            onChange={setMobileProfile}
            onError={props.onError}
            profile={mobileProfile}
            profileId={profileId}
          />
        ) : null}
        <Button type="button" onClick={() => void saveProfiles()}>
          Save execution target profile
        </Button>
      </section>

      <section
        className="space-y-4 border-t border-border pt-5"
        aria-labelledby="credentials-heading"
      >
        <h2 id="credentials-heading" className="studio-display text-sm">
          Credentials
        </h2>
        {secrets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Project configuration stores keychain references only.
          </p>
        ) : (
          <ul aria-label="Credential references" className="space-y-1 text-sm">
            {secrets.map((secret) => (
              <li key={secret.name}>
                {secret.name}
                {secret.present ? ' (present)' : ' (missing)'}
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="credential-name">Credential name</Label>
            <Input
              id="credential-name"
              aria-label="Credential name"
              value={secretName}
              onChange={(event) => setSecretName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="credential-secret">Secret</Label>
            <Input
              id="credential-secret"
              aria-label="Credential secret"
              type="password"
              value={secretValue}
              onChange={(event) => setSecretValue(event.target.value)}
            />
          </div>
        </div>
        <Button type="button" onClick={() => void saveCredential()}>
          Save credential
        </Button>
      </section>

      <section
        className="space-y-4 border-t border-border pt-5"
        aria-labelledby="git-heading"
      >
        <h2 id="git-heading" className="studio-display text-sm">
          Repository
        </h2>
        <p className="font-mono text-xs text-muted-foreground" role="status">
          {git?.branch ? `Branch ${git.branch}` : 'No Git repository'}
        </p>
        {git?.files.length ? (
          <ul aria-label="Repository changes" className="space-y-2">
            {git.files.map((file) => (
              <li
                key={file.path}
                className="space-y-1 rounded-md border border-border bg-card p-3"
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`git-${file.path}`}
                    checked={selectedPaths.includes(file.path)}
                    onCheckedChange={(checked) => {
                      setSelectedPaths((current) =>
                        checked
                          ? [...current, file.path]
                          : current.filter((path) => path !== file.path),
                      )
                    }}
                  />
                  <Label htmlFor={`git-${file.path}`} className="font-mono">
                    {file.path}
                  </Label>
                  <Badge>
                    {file.status}
                    {file.staged ? ' staged' : ''}
                  </Badge>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setExpandedDiff((current) =>
                      current === file.path ? undefined : file.path,
                    )
                  }
                >
                  {expandedDiff === file.path ? 'Hide diff' : 'Show diff'}
                </Button>
                {expandedDiff === file.path ? (
                  <section
                    aria-label={`${file.path} diff`}
                    className="max-h-64 overflow-auto"
                  >
                    <pre className="font-mono text-xs">
                      {file.diff || 'No textual diff'}
                    </pre>
                  </section>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No repository changes.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={selectedPaths.length === 0}
            onClick={() => void stageSelected()}
          >
            Stage selected
          </Button>
          <Button
            type="button"
            disabled={!commitMessage.trim() || selectedPaths.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            Commit selected changes
          </Button>
          {git?.pullRequestAvailable ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void openPullRequest()}
            >
              Create pull request
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {git?.pullRequestReason ??
                'Pull request actions use the GitHub CLI when available.'}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="commit-message">Commit message</Label>
          <Input
            id="commit-message"
            aria-label="Commit message"
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
          />
        </div>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Commit selected changes?</DialogTitle>
            <DialogDescription>
              Studio will create a local commit. It will not push repository
              changes.
            </DialogDescription>
          </DialogHeader>
          <p className="font-mono text-xs">{commitMessage}</p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void commitSelected()}>
              Confirm commit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
