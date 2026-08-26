import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import type {
  StudioMobileProfile,
  StudioMobileTargetDiscovery,
} from '../server/server'

type MobileProfileSettingsProps = {
  api: <R>(path: string, init?: RequestInit) => Promise<R>
  onChange: (profile: StudioMobileProfile) => void
  onError: (message: string | undefined) => void
  profile: StudioMobileProfile
  profileId: string
}

function reasonMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
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
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Mobile execution target
          </legend>
          <div className="flex flex-wrap gap-2">
            {(['android-emulator', 'ios-simulator'] as const).map(
              (executionTarget) => (
                <Button
                  key={executionTarget}
                  type="button"
                  size="sm"
                  variant={
                    profile.executionTarget === executionTarget
                      ? 'default'
                      : 'outline'
                  }
                  aria-pressed={profile.executionTarget === executionTarget}
                  onClick={() =>
                    onChange({
                      ...profile,
                      executionTarget,
                      targetId:
                        profile.executionTarget === executionTarget
                          ? profile.targetId
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
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="mobile-application-id">Application id</Label>
            <Input
              id="mobile-application-id"
              aria-label="Mobile application id"
              value={profile.application.id}
              onChange={(event) =>
                onChange({
                  ...profile,
                  application: {
                    ...profile.application,
                    id: event.target.value,
                  },
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mobile-binary-path">Application binary</Label>
            <Input
              id="mobile-binary-path"
              aria-label="Mobile application binary path"
              value={profile.application.binaryPath}
              onChange={(event) =>
                onChange({
                  ...profile,
                  application: {
                    ...profile.application,
                    binaryPath: event.target.value,
                  },
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mobile-target-id">Target id</Label>
            <Input
              id="mobile-target-id"
              aria-label="Mobile target id"
              value={profile.targetId ?? ''}
              onChange={(event) =>
                onChange({ ...profile, targetId: event.target.value })
              }
            />
          </div>
        </div>
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
        {discoveries?.map((discovery) => (
          <div key={discovery.profileId} className="space-y-2">
            <p className="text-sm font-medium">
              {discovery.profileId} · {discovery.executionTarget}
            </p>
            {discovery.error ? (
              <p role="alert" className="text-sm text-destructive">
                {discovery.error}
              </p>
            ) : discovery.targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No provisioned targets found.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {discovery.targets.map((target) => (
                  <Button
                    key={`${discovery.profileId}:${target.id}`}
                    type="button"
                    size="sm"
                    variant={
                      discovery.profileId === profileId &&
                      target.id === profile.targetId
                        ? 'default'
                        : 'outline'
                    }
                    disabled={
                      discovery.profileId !== profileId ||
                      target.state === 'offline'
                    }
                    onClick={() =>
                      onChange({ ...profile, targetId: target.id })
                    }
                  >
                    {target.name} · {target.state}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
