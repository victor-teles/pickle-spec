import type { ComponentProps, ReactNode } from 'react'
import { Button } from '../../components/ui/button'
import { Spinner } from '../../components/ui/spinner'

type RunControlButtonProps = {
  'aria-label'?: string
  blocked: boolean
  busy: boolean
  children: ReactNode
  className?: string
  onClick: () => void
  size?: ComponentProps<typeof Button>['size']
  variant?: ComponentProps<typeof Button>['variant']
}

export function RunControlButton(props: RunControlButtonProps) {
  return (
    <Button
      type="button"
      variant={props.variant}
      size={props.size}
      className={props.className}
      disabled={props.blocked}
      aria-busy={props.busy || undefined}
      aria-label={props['aria-label']}
      onClick={props.onClick}
    >
      {props.busy ? <Spinner /> : null}
      {props.children}
    </Button>
  )
}
