import type { ChangeEvent } from 'react'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'

type SettingFieldProps = {
  id: string
  label: string
  ariaLabel?: string
  value: string
  type?: string
  onChange: (value: string) => void
}

export function SettingField(props: SettingFieldProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    props.onChange(event.target.value)
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        aria-label={props.ariaLabel ?? props.label}
        type={props.type}
        value={props.value}
        onChange={handleChange}
      />
    </div>
  )
}
