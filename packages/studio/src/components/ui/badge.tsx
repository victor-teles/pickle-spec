import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-secondary text-secondary-foreground',
        failed: 'border-transparent bg-destructive text-destructive-foreground',
        adaptation:
          'border-transparent bg-adaptation text-adaptation-foreground',
        passed: 'border-transparent bg-primary/15 text-primary',
        running: 'border-transparent bg-accent text-accent-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>

function Badge({ className, variant, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: 'span',
    props: {
      ...props,
      className: cn(badgeVariants({ variant }), className),
    },
  })
}

export { Badge, badgeVariants }
