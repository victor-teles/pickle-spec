import { useState } from 'react'
import type { StudioApi } from '../app/studio-api'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import type {
  StudioMobileProfile,
  StudioMobileTargetDiscovery,
} from '../server/server'

type MobileProfileSettingsProps = {
  api: StudioApi
  onChange: (profile: StudioMobileProfile) => void
  onError: (message: string | undefined) => void
  profile: StudioMobileProfile
  profileId: string
}

type MobileDiscoveryProps = Pick<
  MobileProfileSettingsProps,
  'onChange' | 'profile' | 'profileId'
> & {
  discovery: StudioMobileTargetDiscovery
}

function MobileDiscovery({
  discovery,
  onChange,
  profile,
  profileId,
}: MobileDiscoveryProps) {
  if (discovery.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {discovery.error}
      </p>
    )
  }
  if (discovery.targets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No provisioned targets found.
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {discovery.targets.map((target) => (
        <Button
          key={`${discovery.profileId}:${target.id}`}
          type="button"
          size="sm"
          variant={
            discovery.profileId === profileId && target.id === profile.targetId
              ? 'default'
              : 'outline'
          }
          disabled={
            discovery.profileId !== profileId || target.state === 'offline'
          }
          onClick={() => onChange({ ...profile, targetId: target.id })}
        >
          {target.name} · {target.state}
        </Button>
      ))}
    </div>
  )
}

function reasonMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

function MobileTargetKindSelector(props: MobileProfileSettingsProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Mobile execution target</legend>
      <div className="flex flex-wrap gap-2">
        {(['android-emulator', 'ios-simulator'] as const).map(
          (executionTarget) => (
            <Button
              key={executionTarget}
              type="button"
              size="sm"
              variant={
                props.profile.executionTarget === executionTarget
                  ? 'default'
                  : 'outline'
              }
              aria-pressed={props.profile.executionTarget === executionTarget}
              onClick={() =>
                props.onChange({
                  ...props.profile,
                  executionTarget,
                  targetId:
                    props.profile.executionTarget === executionTarget
                      ? props.profile.targetId
                      : undefined,
                })
              }
            >
              {executionTarget === 'android-emulator'
                ? 'Android Emulator'
                : 'iOS Simulator'}
            </Button>
          ),
        )}
      </div>
    </fieldset>
  )
}

function MobileApplicationFields(props: MobileProfileSettingsProps) {
  const updateApplication = (field: 'id' | 'binaryPath', value: string) =>
    props.onChange({
      ...props.profile,
      application: { ...props.profile.application, [field]: value },
    })
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1">
        <Label htmlFor="mobile-application-id">Application id</Label>
        <Input
          id="mobile-application-id"
          aria-label="Mobile application id"
          value={props.profile.application.id}
          onChange={(event) => updateApplication('id', event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="mobile-binary-path">Application binary</Label>
        <Input
          id="mobile-binary-path"
          aria-label="Mobile application binary path"
          value={props.profile.application.binaryPath}
          onChange={(event) =>
            updateApplication('binaryPath', event.target.value)
          }
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="mobile-target-id">Target id</Label>
        <Input
          id="mobile-target-id"
          aria-label="Mobile target id"
          value={props.profile.targetId ?? ''}
          onChange={(event) =>
            props.onChange({ ...props.profile, targetId: event.target.value })
          }
        />
      </div>
    </div>
  )
}

function MobileDiscoveries(
  props: MobileProfileSettingsProps & {
    discoveries?: readonly StudioMobileTargetDiscovery[]
  },
) {
  return props.discoveries?.map((discovery) => (
    <div key={discovery.profileId} className="space-y-2">
      <p className="text-sm font-medium">
        {discovery.profileId} · {discovery.executionTarget}
      </p>
      <MobileDiscovery
        discovery={discovery}
        onChange={props.onChange}
        profile={props.profile}
        profileId={props.profileId}
      />
    </div>
  ))
}

export function MobileProfileSettings({
  api,
  onChange,
  onError,
  profile,
  profileId,
}: MobileProfileSettingsProps) {
  const [discoveries, setDiscoveries] =
    useState<readonly StudioMobileTargetDiscovery[]>()
  const [discovering, setDiscovering] = useState(false)

  async function discoverTargets() {
    setDiscovering(true)
    onError(undefined)
    try {
      setDiscoveries(
        await api<readonly StudioMobileTargetDiscovery[]>(
          '/api/mobile-targets',
        ),
      )
    } catch (reason) {
      onError(reasonMessage(reason))
    } finally {
      setDiscovering(false)
    }
  }

  return (
    <Card size="sm">
      <CardContent className="space-y-3">
        <MobileTargetKindSelector
          {...{ api, onChange, onError, profile, profileId }}
        />
        <MobileApplicationFields
          {...{ api, onChange, onError, profile, profileId }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={discovering}
          onClick={() => void discoverTargets()}
        >
          {discovering
            ? 'Discovering mobile targets…'
            : 'Discover mobile targets'}
        </Button>
        <MobileDiscoveries
          {...{ api, onChange, onError, profile, profileId, discoveries }}
        />
      </CardContent>
    </Card>
  )
}
