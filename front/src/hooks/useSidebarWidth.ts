import { useState, useRef, useCallback, useEffect } from 'react'

// Shared resizable width for the rules sidebars (Hand/Truco/Gaúcho/Canastra
// guides all reuse the same `.hand-guide-sidebar` shell) — one persisted
// preference, drag from the left edge to resize on desktop.
const STORAGE_KEY = 'guideSidebarWidth'
const MIN_WIDTH = 260
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 340
// Below this, the sidebar goes full-width (see the max-width:480px rule in
// index.css) — the inline width below must get out of the way for that to apply.
const MOBILE_BREAKPOINT = 480

function loadWidth(): number {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n)) : DEFAULT_WIDTH
}

export function useSidebarWidth() {
  const [width, setWidth] = useState(loadWidth)
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth > MOBILE_BREAKPOINT)
  const dragging = useRef(false)

  useEffect(() => {
    function onResize() { setIsDesktop(window.innerWidth > MOBILE_BREAKPOINT) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX))
      setWidth(next)
    }
    function onUp() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidth((w) => { localStorage.setItem(STORAGE_KEY, String(w)); return w })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }, [])

  return { style: isDesktop ? { width } : undefined, onDragStart, isDesktop }
}
