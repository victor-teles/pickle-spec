import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-input bg-input/20 px-2 py-2 font-mono text-xs/relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
