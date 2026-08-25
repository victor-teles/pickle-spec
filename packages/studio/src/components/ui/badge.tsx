import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold tracking-[0.08em] whitespace-nowrap uppercase outline-none transition-[background-color,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:border-current/35 aria-invalid:border-destructive motion-reduce:transition-none',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        failed: 'bg-destructive/10 text-destructive',
        passed: 'bg-passed/10 text-passed',
        running: 'bg-primary text-primary-foreground',
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
