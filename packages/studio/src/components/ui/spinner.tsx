import type { ComponentProps, CSSProperties } from 'react'
import { cn } from '../../lib/utils'

const chevron = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3)
  const column = index % 3
  return (column + Math.abs(row - 1)) * 90
})

function Spinner({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      data-slot="spinner"
      className={cn('grid grid-cols-[repeat(3,4px)] gap-[1.5px]', className)}
      {...props}
    >
      {chevron.map((delay, index) => {
        const row = Math.floor(index / 3)
        const column = index % 3
        return (
          <span
            key={`${row}:${column}`}
            className="pixel-spinner-cell size-1 rounded-px bg-current"
            style={
              {
                opacity: 0.15,
                '--pixel-delay': `${delay}ms`,
              } as CSSProperties
            }
          />
        )
      })}
    </span>
  )
}

export { Spinner }
