import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import type { StudioApi } from '../../lib/studio-api'
import type { StudioMobileProfile } from '../../server/contracts'
import { MobileProfileSettings } from './mobile-profile-settings'
import { SettingField } from './setting-field'
import type {
  ConfigurableProject,
  SettingsProps,
  StudioProfile,
} from './settings-types'
import { commaSeparatedValues, reasonMessage } from './settings-utils'

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

function editedProfileConfiguration(
  adapter: string,
  capabilities: string,
  mobileProfile: StudioMobileProfile,
) {
  const selectedAdapter = adapter.trim() || 'custom'
  const nextCapabilities = commaSeparatedValues(capabilities)
  const application = {
    id: mobileProfile.application.id.trim(),
    binaryPath: mobileProfile.application.binaryPath?.trim() || undefined,
  }
  return {
    adapter: selectedAdapter,
    ...(nextCapabilities.length ? { capabilities: nextCapabilities } : {}),
    ...(selectedAdapter === 'mobile'
      ? {
          mobile: {
            ...mobileProfile,
            targetId: mobileProfile.targetId?.trim() || undefined,
            application,
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

export function ProfileSettings<T extends ConfigurableProject>(
  props: SettingsProps<T>,
) {
  const initial = initialProfileEditor(props.project.profileDetails)
  const [profileId, setProfileId] = useState(initial.id)
  const [adapter, setAdapter] = useState(initial.adapter)
  const [capabilities, setCapabilities] = useState(initial.capabilities)
  const [mobileProfile, setMobileProfile] = useState<StudioMobileProfile>(
    initial.mobile,
  )
  const selectProfile = (id: string) => {
    const profile = props.project.profileDetails?.find((item) => item.id === id)
    setProfileId(id)
    setAdapter(profile?.adapter ?? 'custom')
    setCapabilities((profile?.capabilities ?? []).join(', '))
    setMobileProfile(profile?.mobile ?? initial.mobile)
  }
  const save = () =>
    void saveProfile(props, { adapter, capabilities, mobileProfile, profileId })
  return (
    <section
      className="space-y-4 border-t border-border pt-5"
      aria-labelledby="profiles-heading"
    >
      <h2 id="profiles-heading" className="studio-display text-sm">
        Execution target profiles
      </h2>
      <ProfileSelector
        profiles={props.project.profileDetails ?? []}
        selectedId={profileId}
        onSelect={selectProfile}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <SettingField
          id="profile-id"
          label="Profile id"
          ariaLabel="Profile id"
          value={profileId}
          onChange={setProfileId}
        />
        <SettingField
          id="profile-adapter"
          label="Adapter"
          ariaLabel="Profile adapter"
          value={adapter}
          onChange={setAdapter}
        />
        <SettingField
          id="profile-capabilities"
          label="Capabilities"
          ariaLabel="Profile capabilities"
          value={capabilities}
          onChange={setCapabilities}
        />
      </div>
      <MobileAdapterConfiguration
        adapter={adapter}
        api={props.api}
        mobileProfile={mobileProfile}
        profileId={profileId}
        onChange={setMobileProfile}
        onError={props.onError}
      />
      <Button type="button" onClick={save}>
        Save execution target profile
      </Button>
    </section>
  )
}

async function saveProfile<T extends ConfigurableProject>(
  props: SettingsProps<T>,
  editor: {
    adapter: string
    capabilities: string
    mobileProfile: StudioMobileProfile
    profileId: string
  },
) {
  const id = editor.profileId.trim()
  if (!id) return props.onError('An execution target profile id is required')
  const profiles = existingProfiles(props.project.profileDetails)
  profiles[id] = editedProfileConfiguration(
    editor.adapter,
    editor.capabilities,
    editor.mobileProfile,
  )
  props.onError(undefined)
  try {
    props.onProject(
      await props.api<T>('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ executionTargetProfiles: profiles }),
      }),
    )
    toast.add({
      type: 'success',
      title: 'Execution target profile saved',
      description: `${id} is ready for Test runs.`,
    })
  } catch (reason) {
    props.onError(reasonMessage(reason))
  }
}
