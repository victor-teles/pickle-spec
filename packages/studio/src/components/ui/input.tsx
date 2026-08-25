import { Input as InputPrimitive } from '@base-ui/react/input'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-11 w-full min-w-0 rounded-md border border-input bg-card px-4 py-2 text-base/relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-foreground disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
