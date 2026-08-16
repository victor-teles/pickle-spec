import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Mira Label is associated by htmlFor or wrapping at the call site
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-xs/relaxed leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
