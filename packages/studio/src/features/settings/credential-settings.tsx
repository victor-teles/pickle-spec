import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { SettingField } from './setting-field'
import type {
  ConfigurableProject,
  SettingsProps,
  StudioCredential,
} from './settings-types'
import { reasonMessage } from './settings-utils'

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

export function CredentialSettings<T extends ConfigurableProject>(
  props: SettingsProps<T>,
) {
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const save = async () => {
    props.onError(undefined)
    try {
      props.onProject(
        await props.api<T>('/api/credentials', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, secret }),
        }),
      )
      setSecret('')
    } catch (reason) {
      props.onError(reasonMessage(reason))
    }
  }
  return (
    <section
      className="space-y-4 border-t border-border pt-5"
      aria-labelledby="credentials-heading"
    >
      <h2 id="credentials-heading" className="studio-display text-sm">
        Credentials
      </h2>
      <CredentialReferences secrets={props.project.secrets ?? []} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SettingField
          id="credential-name"
          label="Credential name"
          value={name}
          onChange={setName}
        />
        <SettingField
          id="credential-secret"
          label="Secret"
          ariaLabel="Credential secret"
          type="password"
          value={secret}
          onChange={setSecret}
        />
      </div>
      <Button type="button" onClick={() => void save()}>
        Save credential
      </Button>
    </section>
  )
}
