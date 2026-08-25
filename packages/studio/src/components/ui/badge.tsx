import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2 py-0.5 text-[0.6875rem] font-semibold tracking-[0.04em] whitespace-nowrap uppercase outline-none transition-[background-color,border-color,color] duration-75 ease-[cubic-bezier(0.4,0,0.2,1)] focus-visible:border-current/35 aria-invalid:border-destructive motion-reduce:transition-none',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        failed: 'bg-destructive/10 text-destructive',
        passed: 'bg-passed/10 text-passed',
        running: 'bg-secondary text-foreground',
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
