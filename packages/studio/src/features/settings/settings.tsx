import { CredentialSettings } from './credential-settings'
import { ExecutionCacheSettings } from './execution-cache-settings'
import { ProfileSettings } from './profile-settings'
import { RepositorySettingsContainer } from './repository-settings'
import type { ConfigurableProject, SettingsProps } from './settings-types'
import { SuiteSettings } from './suite-settings'

export function SettingsPanel<T extends ConfigurableProject>(
  props: SettingsProps<T>,
) {
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
      <SuiteSettings {...props} />
      <ProfileSettings {...props} />
      <CredentialSettings {...props} />
      <RepositorySettingsContainer api={props.api} onError={props.onError} />
    </main>
  )
}
