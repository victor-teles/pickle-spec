import {
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useState,
} from 'react'
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

function initialSuiteEditor(suites: readonly StudioSuite[] | undefined) {
  const suite = suites?.[0]
  return {
    name: suite?.name ?? '',
    paths: pathsText(suite?.paths),
    tags: suite?.tagExpression ?? '',
    states: (suite?.states ?? ['active']).join(', '),
    scenario: suite?.scenarioName ?? '',
  }
}

function initialProfileEditor(profiles: readonly StudioProfile[] | undefined) {
  const profile = profiles?.[0]
  return {
    id: profile?.id ?? '',
    adapter: profile?.adapter ?? 'custom',
    capabilities: (profile?.capabilities ?? []).join(', '),
    mobile:
      profile?.mobile ??
      ({
        executionTarget: 'android-emulator',
        application: { id: '', binaryPath: '' },
      } satisfies StudioMobileProfile),
  }
}

function suiteConfiguration(suite: StudioSuite) {
  return {
    ...(suite.paths ? { paths: suite.paths } : {}),
    ...(suite.tagExpression ? { tagExpression: suite.tagExpression } : {}),
    ...(suite.states ? { states: suite.states } : {}),
    ...(suite.scenarioName ? { scenarioName: suite.scenarioName } : {}),
  }
}

function existingSuites(suites: readonly StudioSuite[] | undefined) {
  return Object.fromEntries(
    (suites ?? []).map((suite) => [suite.name, suiteConfiguration(suite)]),
  )
}

function profileConfiguration(profile: StudioProfile) {
  return {
    adapter: profile.adapter,
    ...(profile.capabilities ? { capabilities: profile.capabilities } : {}),
    ...(profile.mobile ? { mobile: profile.mobile } : {}),
  }
}

function existingProfiles(profiles: readonly StudioProfile[] | undefined) {
  return Object.fromEntries(
    (profiles ?? []).map((profile) => [
      profile.id,
      profileConfiguration(profile),
    ]),
  )
}

function commaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function editedSuiteConfiguration(input: {
  paths: string
  tags: string
  states: string
  scenario: string
}) {
  const paths = commaSeparatedValues(input.paths)
  const states = commaSeparatedValues(input.states).filter(
    (state): state is (typeof specificationStates)[number] =>
      specificationStates.includes(
        state as (typeof specificationStates)[number],
      ),
  )
  return {
    ...(paths.length ? { paths } : {}),
    ...(input.tags.trim() ? { tagExpression: input.tags.trim() } : {}),
    ...(states.length ? { states } : {}),
    ...(input.scenario.trim() ? { scenarioName: input.scenario.trim() } : {}),
  }
}

function editedProfileConfiguration(
  adapter: string,
  capabilities: string,
  mobileProfile: StudioMobileProfile,
) {
  const selectedAdapter = adapter.trim() || 'custom'
  const nextCapabilities = commaSeparatedValues(capabilities)
  return {
    adapter: selectedAdapter,
    ...(nextCapabilities.length ? { capabilities: nextCapabilities } : {}),
    ...(selectedAdapter === 'mobile'
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
}

function MobileAdapterConfiguration(props: {
  adapter: string
  api: StudioApi
  mobileProfile: StudioMobileProfile
  profileId: string
  onChange: (profile: StudioMobileProfile) => void
  onError: (message: string | undefined) => void
}) {
  if (props.adapter.trim() !== 'mobile') return null
  return (
    <MobileProfileSettings
      api={props.api}
      onChange={props.onChange}
      onError={props.onError}
      profile={props.mobileProfile}
      profileId={props.profileId}
    />
  )
}

function CredentialReferences(props: { secrets: readonly StudioCredential[] }) {
  if (props.secrets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Project configuration stores keychain references only.
      </p>
    )
  }
  return (
    <ul aria-label="Credential references" className="space-y-1 text-sm">
      {props.secrets.map((secret) => (
        <li key={secret.name}>
          {secret.name}
          {secret.present ? ' (present)' : ' (missing)'}
        </li>
      ))}
    </ul>
  )
}

function GitFileRow(props: {
  file: GitFile
  selected: boolean
  expanded: boolean
  onSelected: (path: string, selected: boolean) => void
  onExpanded: (path: string) => void
}) {
  function handleSelected(checked: boolean) {
    props.onSelected(props.file.path, checked)
  }
  function handleExpanded() {
    props.onExpanded(props.file.path)
  }
  return (
    <li className="space-y-1 rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`git-${props.file.path}`}
          checked={props.selected}
          onCheckedChange={handleSelected}
        />
        <Label htmlFor={`git-${props.file.path}`} className="font-mono">
          {props.file.path}
        </Label>
        <Badge>
          {props.file.status}
          {props.file.staged ? ' staged' : ''}
        </Badge>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleExpanded}
      >
        {props.expanded ? 'Hide diff' : 'Show diff'}
      </Button>
      {props.expanded ? (
        <section
          aria-label={`${props.file.path} diff`}
          className="max-h-64 overflow-auto"
        >
          <pre className="font-mono text-xs">
            {props.file.diff || 'No textual diff'}
          </pre>
        </section>
      ) : null}
    </li>
  )
}

function RepositoryChanges(props: {
  files: readonly GitFile[] | undefined
  selectedPaths: readonly string[]
  expandedDiff?: string
  onSelectedPaths: (paths: string[]) => void
  onExpandedDiff: (path: string | undefined) => void
}) {
  if (!props.files?.length) {
    return (
      <p className="text-sm text-muted-foreground">No repository changes.</p>
    )
  }
  function selectPath(path: string, selected: boolean) {
    props.onSelectedPaths(
      selected
        ? [...props.selectedPaths, path]
        : props.selectedPaths.filter((selectedPath) => selectedPath !== path),
    )
  }
  function expandPath(path: string) {
    props.onExpandedDiff(props.expandedDiff === path ? undefined : path)
  }
  return (
    <ul aria-label="Repository changes" className="space-y-2">
      {props.files.map((file) => (
        <GitFileRow
          key={file.path}
          file={file}
          selected={props.selectedPaths.includes(file.path)}
          expanded={props.expandedDiff === file.path}
          onSelected={selectPath}
          onExpanded={expandPath}
        />
      ))}
    </ul>
  )
}

function PullRequestAction(props: {
  git: GitStatus | undefined
  onOpen: () => void
}) {
  if (props.git?.pullRequestAvailable) {
    return (
      <Button type="button" variant="outline" onClick={props.onOpen}>
        Create pull request
      </Button>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      {props.git?.pullRequestReason ??
        'Pull request actions use the GitHub CLI when available.'}
    </p>
  )
}

function RepositorySettings(props: {
  git: GitStatus | undefined
  selectedPaths: string[]
  expandedDiff?: string
  commitMessage: string
  confirmOpen: boolean
  onSelectedPaths: (paths: string[]) => void
  onExpandedDiff: (path: string | undefined) => void
  onCommitMessage: (message: string) => void
  onConfirmOpen: (open: boolean) => void
  onStage: () => Promise<void>
  onCommit: () => Promise<void>
  onPullRequest: () => void
}) {
  function stage() {
    void props.onStage()
  }
  function openConfirmation() {
    props.onConfirmOpen(true)
  }
  function closeConfirmation() {
    props.onConfirmOpen(false)
  }
  function commit() {
    void props.onCommit()
  }
  function changeCommitMessage(event: ChangeEvent<HTMLInputElement>) {
    props.onCommitMessage(event.target.value)
  }
  return (
    <>
      <section
        className="space-y-4 border-t border-border pt-5"
        aria-labelledby="git-heading"
      >
        <h2 id="git-heading" className="studio-display text-sm">
          Repository
        </h2>
        <p className="font-mono text-xs text-muted-foreground" role="status">
          {props.git?.branch
            ? `Branch ${props.git.branch}`
            : 'No Git repository'}
        </p>
        <RepositoryChanges
          files={props.git?.files}
          selectedPaths={props.selectedPaths}
          expandedDiff={props.expandedDiff}
          onSelectedPaths={props.onSelectedPaths}
          onExpandedDiff={props.onExpandedDiff}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={props.selectedPaths.length === 0}
            onClick={stage}
          >
            Stage selected
          </Button>
          <Button
            type="button"
            disabled={
              !props.commitMessage.trim() || props.selectedPaths.length === 0
            }
            onClick={openConfirmation}
          >
            Commit selected changes
          </Button>
          <PullRequestAction git={props.git} onOpen={props.onPullRequest} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="commit-message">Commit message</Label>
          <Input
            id="commit-message"
            aria-label="Commit message"
            value={props.commitMessage}
            onChange={changeCommitMessage}
          />
        </div>
      </section>

      <Dialog open={props.confirmOpen} onOpenChange={props.onConfirmOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Commit selected changes?</DialogTitle>
            <DialogDescription>
              Studio will create a local commit. It will not push repository
              changes.
            </DialogDescription>
          </DialogHeader>
          <p className="font-mono text-xs">{props.commitMessage}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeConfirmation}>
              Cancel
            </Button>
            <Button type="button" onClick={commit}>
              Confirm commit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SuiteSelector(props: {
  suites: readonly StudioSuite[]
  selectedName: string
  onSelect: (suite: StudioSuite) => void
  onNew: () => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {props.suites.map((suite) => (
        <Button
          key={suite.name}
          type="button"
          size="sm"
          variant={suite.name === props.selectedName ? 'default' : 'outline'}
          aria-pressed={suite.name === props.selectedName}
          onClick={() => props.onSelect(suite)}
        >
          {suite.name}
        </Button>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={props.onNew}>
        New test suite
      </Button>
    </div>
  )
}

function ProfileSelector(props: {
  profiles: readonly StudioProfile[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {props.profiles.map((profile) => (
        <Button
          key={profile.id}
          type="button"
          size="sm"
          variant={profile.id === props.selectedId ? 'default' : 'outline'}
          aria-pressed={profile.id === props.selectedId}
          onClick={() => props.onSelect(profile.id)}
        >
          {profile.id}
        </Button>
      ))}
    </div>
  )
}

function useSuiteFieldSync(
  suites: readonly StudioSuite[] | undefined,
  selectedName: string,
  setters: {
    paths: Dispatch<SetStateAction<string>>
    tags: Dispatch<SetStateAction<string>>
    states: Dispatch<SetStateAction<string>>
    scenario: Dispatch<SetStateAction<string>>
  },
): void {
  const { paths, tags, states, scenario } = setters
  useEffect(() => {
    if (!selectedName) {
      paths('')
      tags('')
      states('active')
      scenario('')
      return
    }
    const suite = suites?.find((item) => item.name === selectedName)
    if (!suite) return
    paths(pathsText(suite.paths))
    tags(suite.tagExpression ?? '')
    states((suite.states ?? ['active']).join(', '))
    scenario(suite.scenarioName ?? '')
  }, [paths, scenario, selectedName, states, suites, tags])
}

function useProfileFieldSync(
  profiles: readonly StudioProfile[] | undefined,
  profileId: string,
  setters: {
    adapter: Dispatch<SetStateAction<string>>
    capabilities: Dispatch<SetStateAction<string>>
    mobile: Dispatch<SetStateAction<StudioMobileProfile>>
  },
): void {
  const { adapter, capabilities, mobile } = setters
  useEffect(() => {
    const profile =
      profiles?.find((item) => item.id === profileId) ?? profiles?.[0]
    adapter(profile?.adapter ?? 'custom')
    capabilities((profile?.capabilities ?? []).join(', '))
    mobile(
      profile?.mobile ?? {
        executionTarget: 'android-emulator',
        application: { id: '', binaryPath: '' },
      },
    )
  }, [adapter, capabilities, mobile, profileId, profiles])
}

function useGitStatus(
  api: StudioApi,
  onError: (message: string | undefined) => void,
): [GitStatus | undefined, Dispatch<SetStateAction<GitStatus | undefined>>] {
  const [git, setGit] = useState<GitStatus>()
  useEffect(() => {
    let cancelled = false
    void api<GitStatus>('/api/git').then(
      (value) => {
        if (!cancelled) setGit(value)
      },
      (reason: unknown) => {
        if (!cancelled) onError(reasonMessage(reason))
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, onError])
  return [git, setGit]
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
  const initialSuite = initialSuiteEditor(props.project.suiteDetails)
  const [suiteName, setSuiteName] = useState(initialSuite.name)
  const [originalSuiteName, setOriginalSuiteName] = useState(suiteName)
  const [suitePaths, setSuitePaths] = useState(initialSuite.paths)
  const [suiteTags, setSuiteTags] = useState(initialSuite.tags)
  const [suiteStates, setSuiteStates] = useState(initialSuite.states)
  const [suiteScenario, setSuiteScenario] = useState(initialSuite.scenario)
  const initialProfile = initialProfileEditor(props.project.profileDetails)
  const [profileId, setProfileId] = useState(initialProfile.id)
  const [adapter, setAdapter] = useState(initialProfile.adapter)
  const [capabilities, setCapabilities] = useState(initialProfile.capabilities)
  const [mobileProfile, setMobileProfile] = useState<StudioMobileProfile>(
    initialProfile.mobile,
  )
  const [secretName, setSecretName] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const [git, setGit] = useGitStatus(props.api, props.onError)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [commitMessage, setCommitMessage] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [expandedDiff, setExpandedDiff] = useState<string>()

  useSuiteFieldSync(props.project.suiteDetails, originalSuiteName, {
    paths: setSuitePaths,
    tags: setSuiteTags,
    states: setSuiteStates,
    scenario: setSuiteScenario,
  })
  useProfileFieldSync(props.project.profileDetails, profileId, {
    adapter: setAdapter,
    capabilities: setCapabilities,
    mobile: setMobileProfile,
  })

  async function saveSuites() {
    const name = suiteName.trim()
    if (!name) {
      props.onError('A test suite name is required')
      return
    }
    const suites = existingSuites(props.project.suiteDetails)
    suites[name] = editedSuiteConfiguration({
      paths: suitePaths,
      tags: suiteTags,
      states: suiteStates,
      scenario: suiteScenario,
    })
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
    const profiles = existingProfiles(props.project.profileDetails)
    profiles[id] = editedProfileConfiguration(
      adapter,
      capabilities,
      mobileProfile,
    )
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

  function openPullRequestFromSettings() {
    void openPullRequest()
  }

  function selectSuite(suite: StudioSuite) {
    setSuiteName(suite.name)
    setOriginalSuiteName(suite.name)
  }

  function newSuite() {
    setSuiteName('')
    setOriginalSuiteName('')
    setSuitePaths('')
    setSuiteTags('')
    setSuiteStates('active')
    setSuiteScenario('')
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
        <SuiteSelector
          suites={suites}
          selectedName={originalSuiteName}
          onSelect={selectSuite}
          onNew={newSuite}
        />
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
        <ProfileSelector
          profiles={profiles}
          selectedId={profileId}
          onSelect={setProfileId}
        />
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
        <MobileAdapterConfiguration
          adapter={adapter}
          api={props.api}
          mobileProfile={mobileProfile}
          profileId={profileId}
          onChange={setMobileProfile}
          onError={props.onError}
        />
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
        <CredentialReferences secrets={secrets} />
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

      <RepositorySettings
        git={git}
        selectedPaths={selectedPaths}
        expandedDiff={expandedDiff}
        commitMessage={commitMessage}
        confirmOpen={confirmOpen}
        onSelectedPaths={setSelectedPaths}
        onExpandedDiff={setExpandedDiff}
        onCommitMessage={setCommitMessage}
        onConfirmOpen={setConfirmOpen}
        onStage={stageSelected}
        onCommit={commitSelected}
        onPullRequest={openPullRequestFromSettings}
      />
    </main>
  )
}
