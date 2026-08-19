import { useCallback, useEffect, useRef, useState } from 'react'

type VirtualWindowOptions = {
  count: number
  itemSize: number
  overscan?: number
}

export function useVirtualWindow<Element extends HTMLElement>(
  options: VirtualWindowOptions,
) {
  const scrollRef = useRef<Element>(null)
  const [scrollElement, setScrollElement] = useState<Element | null>(null)
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: options.itemSize * 20,
  })

  const containerRef = useCallback((element: Element | null) => {
    scrollRef.current = element
    setScrollElement(element)
  }, [])

  const measure = useCallback(() => {
    const element = scrollElement
    if (!element) return
    setViewport({
      scrollTop: element.scrollTop,
      height: element.clientHeight || options.itemSize * 20,
    })
  }, [options.itemSize, scrollElement])

  useEffect(() => {
    const element = scrollElement
    if (!element) return
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(element)
    element.addEventListener('scroll', measure, { passive: true })
    return () => {
      resize.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [measure, scrollElement])

  const overscan = options.overscan ?? 6
  const start = Math.max(
    0,
    Math.floor(viewport.scrollTop / options.itemSize) - overscan,
  )
  const visibleCount = Math.ceil(viewport.height / options.itemSize)
  const windowSize = visibleCount + overscan * 2
  const boundedStart = Math.min(start, Math.max(0, options.count - windowSize))
  const end = Math.min(options.count, boundedStart + windowSize)

  return {
    scrollRef,
    containerRef,
    start: boundedStart,
    end,
    before: boundedStart * options.itemSize,
    after: (options.count - end) * options.itemSize,
  }
}
