import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-20 w-full resize-none rounded-[0.625rem] border border-input bg-card px-3 py-2 font-mono text-sm/relaxed transition-colors duration-75 outline-none placeholder:text-muted-foreground focus-visible:border-foreground/35 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
