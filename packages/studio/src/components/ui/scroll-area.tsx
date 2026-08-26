import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'

import { cn } from '../../lib/utils'

type ScrollAreaProps = ScrollAreaPrimitive.Root.Props & {
  scrollbars?: 'vertical' | 'horizontal' | 'both'
  viewportProps?: ScrollAreaPrimitive.Viewport.Props
}

function ScrollArea({
  className,
  children,
  scrollbars = 'vertical',
  viewportProps,
  ...props
}: ScrollAreaProps) {
  const handleViewportKeyDown: NonNullable<
    ScrollAreaPrimitive.Viewport.Props['onKeyDown']
  > = (event) => {
    viewportProps?.onKeyDown?.(event)
    if (
      event.defaultPrevented ||
      (scrollbars !== 'horizontal' && scrollbars !== 'both')
    ) {
      return
    }
    const viewport = event.currentTarget
    const nextScrollLeft =
      event.key === 'ArrowRight'
        ? viewport.scrollLeft + 44
        : event.key === 'ArrowLeft'
          ? viewport.scrollLeft - 44
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? viewport.scrollWidth
              : undefined
    if (nextScrollLeft === undefined) return
    event.preventDefault()
    viewport.scrollLeft = nextScrollLeft
  }

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        {...viewportProps}
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
        onKeyDown={handleViewportKeyDown}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {scrollbars !== 'horizontal' ? <ScrollBar /> : null}
      {scrollbars !== 'vertical' ? (
        <ScrollBar orientation="horizontal" />
      ) : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:border-t data-[orientation=horizontal]:border-t-transparent data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2.5 data-[orientation=vertical]:border-l data-[orientation=vertical]:border-l-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
