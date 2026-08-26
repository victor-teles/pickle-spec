import { Input as InputPrimitive } from '@base-ui/react/input'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-[0.625rem] border border-input bg-card px-3 py-1.5 text-sm transition-colors duration-75 outline-none placeholder:text-muted-foreground focus-visible:border-foreground/35 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
