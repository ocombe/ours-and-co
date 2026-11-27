import { useRef, type MouseEvent, type PointerEvent } from 'react'

/** How far (px) a row must be slid to count. */
const THRESHOLD = 80

/**
 * Slide a row left or right with a finger to act on it (tick a shopping item).
 * Touch and pen only: with a mouse, a click does it. A mostly vertical move is left to
 * the page (scrolling), and the tap that ends a slide does not also open the item.
 * The row needs `touch-action: pan-y` (vertical scroll stays native).
 */
export function useSwipe(onSwipe: (id: number) => void) {
  const state = useRef<{ id: number; x: number; y: number; el: HTMLElement; sliding: boolean } | null>(null)
  const slid = useRef(false)

  function reset(el: HTMLElement) {
    el.style.transform = ''
    el.classList.remove('sliding', 'slide-ready')
  }

  return function rowProps(id: number) {
    return {
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (e.pointerType === 'mouse') return
        // The drag handle and the checkbox keep their own gestures.
        if ((e.target as Element).closest('.drag-handle, input')) return
        state.current = { id, x: e.clientX, y: e.clientY, el: e.currentTarget, sliding: false }
        slid.current = false
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        const s = state.current
        if (!s || s.id !== id) return
        const dx = e.clientX - s.x
        const dy = e.clientY - s.y
        if (!s.sliding) {
          if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
            state.current = null // scrolling
            return
          }
          if (Math.abs(dx) < 10) return
          s.sliding = true
          slid.current = true
          try {
            s.el.setPointerCapture(e.pointerId) // keep the moves even if the finger leaves the row
          } catch {
            // no active pointer (synthetic event): the slide still works while over the row
          }
          s.el.classList.add('sliding')
        }
        s.el.style.transform = `translateX(${dx}px)`
        s.el.classList.toggle('slide-ready', Math.abs(dx) >= THRESHOLD)
      },
      onPointerUp(e: PointerEvent<HTMLElement>) {
        const s = state.current
        state.current = null
        if (!s || s.id !== id || !s.sliding) return
        reset(s.el)
        if (Math.abs(e.clientX - s.x) >= THRESHOLD) onSwipe(id)
      },
      onPointerCancel() {
        const s = state.current
        state.current = null
        if (s) reset(s.el)
      },
      onClickCapture(e: MouseEvent<HTMLElement>) {
        if (!slid.current) return
        slid.current = false
        e.preventDefault()
        e.stopPropagation()
      },
    }
  }
}
