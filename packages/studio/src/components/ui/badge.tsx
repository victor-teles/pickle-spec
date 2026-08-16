import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 font-mono text-[0.625rem] font-medium whitespace-nowrap outline-none transition-[background-color,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:border-current/35 aria-invalid:border-destructive motion-reduce:transition-none',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        failed: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
        adaptation: 'bg-adaptation/10 text-adaptation dark:bg-adaptation/20',
        passed: 'bg-passed/10 text-passed dark:bg-passed/20',
        running: 'bg-accent text-accent-foreground',
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
