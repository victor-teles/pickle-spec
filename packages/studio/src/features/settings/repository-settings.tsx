import {
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useState,
} from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import type { StudioApi } from '../../lib/studio-api'
import { reasonMessage } from './settings-utils'

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

export function RepositorySettingsContainer(props: {
  api: StudioApi
  onError: (message?: string) => void
}) {
  const [git, setGit] = useGitStatus(props.api, props.onError)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [commitMessage, setCommitMessage] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [expandedDiff, setExpandedDiff] = useState<string>()
  const actions = repositoryActions({
    ...props,
    commitMessage,
    selectedPaths,
    setCommitMessage,
    setConfirmOpen,
    setGit,
    setSelectedPaths,
  })
  return (
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
      onStage={actions.stage}
      onCommit={actions.commit}
      onPullRequest={actions.pullRequest}
    />
  )
}

function repositoryActions(input: {
  api: StudioApi
  onError: (message?: string) => void
  commitMessage: string
  selectedPaths: string[]
  setCommitMessage: (value: string) => void
  setConfirmOpen: (value: boolean) => void
  setGit: Dispatch<SetStateAction<GitStatus | undefined>>
  setSelectedPaths: (value: string[]) => void
}) {
  const request = async (path: string, body?: unknown) =>
    input.api<GitStatus>(path, {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  const safely = async (action: () => Promise<void>) => {
    input.onError(undefined)
    try {
      await action()
    } catch (reason) {
      input.onError(reasonMessage(reason))
    }
  }
  return {
    stage: () =>
      safely(async () =>
        input.setGit(
          await request('/api/git/stage', { paths: input.selectedPaths }),
        ),
      ),
    commit: () =>
      safely(async () => {
        input.setGit(
          await request('/api/git/commit', {
            message: input.commitMessage,
            confirmed: true,
            paths: input.selectedPaths,
          }),
        )
        input.setConfirmOpen(false)
        input.setCommitMessage('')
        input.setSelectedPaths([])
      }),
    pullRequest: () =>
      safely(async () => {
        await request('/api/git/pull-request')
        input.setGit(await input.api('/api/git'))
      }),
  }
}
