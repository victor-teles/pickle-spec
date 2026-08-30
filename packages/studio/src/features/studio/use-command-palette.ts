import { useCallback, useEffect, useRef, useState } from 'react'

export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  const returnFocusRef = useRef<HTMLElement>(null)

  const setVisibility = useCallback((visible: boolean) => {
    if (visible && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement
    }
    setOpen(visible)
    if (!visible) {
      requestAnimationFrame(() => returnFocusRef.current?.focus())
    }
  }, [])

  useEffect(() => {
    function toggle(event: globalThis.KeyboardEvent) {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'k'
      ) {
        return
      }
      event.preventDefault()
      setVisibility(!open)
    }
    addEventListener('keydown', toggle)
    return () => removeEventListener('keydown', toggle)
  }, [open, setVisibility])

  return { open, setVisibility }
}
