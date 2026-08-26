import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[0.625rem] border border-transparent bg-clip-padding text-[0.8125rem] font-medium leading-none whitespace-nowrap outline-none select-none transition-[background-color,border-color,color,opacity] duration-75 ease-[cubic-bezier(0.4,0,0.2,1)] disabled:pointer-events-none disabled:opacity-45 focus-visible:border-current/40 aria-pressed:border-foreground/30 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/88 active:bg-primary/80',
        outline:
          'border-input bg-background text-foreground hover:border-foreground/20 hover:bg-muted active:bg-secondary aria-expanded:bg-secondary aria-expanded:text-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-foreground/10 active:bg-foreground/13 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'text-muted-foreground hover:bg-muted hover:text-foreground active:bg-secondary aria-expanded:bg-secondary aria-expanded:text-foreground',
        destructive:
          'border-destructive/15 bg-destructive/8 text-destructive hover:border-destructive/30 hover:bg-destructive/14',
        link: 'text-primary underline-offset-4 hover:underline',
        passed:
          'border-passed/15 bg-passed/8 text-passed hover:border-passed/30 hover:bg-passed/14',
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-8 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = ComponentProps<typeof ButtonPrimitive> &
  VariantProps<typeof buttonVariants>

type ButtonLinkProps = ComponentProps<'a'> & VariantProps<typeof buttonVariants>

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

function ButtonLink({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonLinkProps) {
  return (
    <a
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, ButtonLink, buttonVariants }
