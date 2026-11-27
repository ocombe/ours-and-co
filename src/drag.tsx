import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * Drag an item to another group (an aisle, a kind of meal) with a finger or a mouse.
 * Pointer events, because native HTML drag and drop does not work on phones.
 * - the item's handle gets `handleProps(id, label)`;
 * - each group's element gets `data-drop={groupKey}` (and a highlight when `isOver(key)`);
 * - `onDrop(id, key)` runs when the item is released over another group.
 */
export function useDragToGroup<K extends string>(onDrop: (id: number, group: K) => void) {
  const [drag, setDrag] = useState<{ id: number; label: string; x: number; y: number; over: K | null } | null>(null)
  const from = useRef<K | null>(null)
  const scroll = useRef<number | undefined>(undefined)

  function groupAt(x: number, y: number): K | null {
    const el = document.elementFromPoint(x, y)?.closest('[data-drop]')
    return (el?.getAttribute('data-drop') as K | null) ?? null
  }

  // Near the top or bottom of the screen: scroll, so a far group can be reached.
  function autoScroll(y: number) {
    window.clearInterval(scroll.current)
    const edge = 80
    const speed = y < edge ? -12 : y > window.innerHeight - edge ? 12 : 0
    if (speed) scroll.current = window.setInterval(() => window.scrollBy(0, speed), 16)
  }

  function stop() {
    window.clearInterval(scroll.current)
    setDrag(null)
  }

  function handleProps(id: number, label: string) {
    return {
      'aria-label': `Déplacer ${label}`,
      title: 'Glisser vers un autre groupe',
      onPointerDown(e: ReactPointerEvent<HTMLElement>) {
        if (e.button !== 0) return
        e.preventDefault()
        try {
          e.currentTarget.setPointerCapture(e.pointerId) // keep the moves while over other rows
        } catch {
          // no active pointer (synthetic event)
        }
        from.current = groupAt(e.clientX, e.clientY)
        setDrag({ id, label, x: e.clientX, y: e.clientY, over: from.current })
      },
      onPointerMove(e: ReactPointerEvent<HTMLElement>) {
        if (!drag || drag.id !== id) return
        autoScroll(e.clientY)
        setDrag({ ...drag, x: e.clientX, y: e.clientY, over: groupAt(e.clientX, e.clientY) })
      },
      onPointerUp(e: ReactPointerEvent<HTMLElement>) {
        if (!drag || drag.id !== id) return
        const target = groupAt(e.clientX, e.clientY)
        stop()
        if (target && target !== from.current) onDrop(id, target)
      },
      onPointerCancel: stop,
    }
  }

  /** Is the dragged item over this group (and would move there)? */
  function isOver(key: K) {
    return !!drag && drag.over === key && key !== from.current
  }

  // The label following the finger.
  const ghost = drag && (
    <div className="drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
      {drag.label}
    </div>
  )

  return { dragging: drag?.id ?? null, handleProps, isOver, ghost }
}

/** The grip shown on draggable rows. */
export function DragHandle(props: ReturnType<ReturnType<typeof useDragToGroup>['handleProps']>) {
  return (
    <button type="button" className="drag-handle" {...props}>
      <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
        {[3, 8, 13].map((y) => (
          <g key={y}>
            <circle cx="2.5" cy={y} r="1.4" />
            <circle cx="7.5" cy={y} r="1.4" />
          </g>
        ))}
      </svg>
    </button>
  )
}
