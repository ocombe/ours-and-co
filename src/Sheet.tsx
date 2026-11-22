import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'

/** Sheets on screen. Each one has its own step in the browser history. */
const openSheets = new Set<string>()

// Forward into the step of a sheet that is already closed: step back over it.
window.addEventListener('popstate', () => {
  const sheet = history.state?.sheet
  if (sheet && !openSheets.has(sheet)) history.back()
})

interface Props {
  title: string
  onClose: () => void
  /** Unsaved changes: closing asks first. */
  dirty?: boolean
  /** Saves; resolves to true when it worked. Needed for "Enregistrer et fermer". */
  onSave?: () => Promise<boolean>
  children: ReactNode
}

/**
 * Modal bottom sheet. Closes with its button, Escape / Android back, a tap on the
 * backdrop or the browser's back button; when there are unsaved changes it asks what
 * to do first.
 */
export function Sheet({ title, onClose, dirty = false, onSave, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const downOutside = useRef(false)
  const [confirming, setConfirming] = useState(false)
  const id = useId()
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  // Opening adds a history step (same URL), so the browser's back button closes the sheet.
  useEffect(() => {
    openSheets.add(id)
    if (history.state?.sheet !== id) history.pushState({ sheet: id }, '')

    function onPop() {
      if (history.state?.sheet === id) return
      if (dirtyRef.current) {
        // Unsaved changes: stay (put the step back) and ask.
        history.pushState({ sheet: id }, '')
        setConfirming(true)
      } else {
        dialog.current?.close()
      }
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      openSheets.delete(id)
      // Closed some other way: remove its history step. Deferred, because React's dev
      // mode unmounts and remounts once on purpose.
      setTimeout(() => {
        if (!openSheets.has(id) && history.state?.sheet === id) history.back()
      })
    }
  }, [id])

  function requestClose() {
    if (dirty) setConfirming(true)
    else dialog.current?.close()
  }

  return (
    <dialog
      ref={dialog}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        if (dirty) {
          e.preventDefault()
          setConfirming(true)
        }
      }}
      // Both ends of the click must be on the backdrop, so a text selection dragged out does not close it.
      onPointerDown={(e) => (downOutside.current = onBackdrop(e))}
      onClick={(e) => {
        if (downOutside.current && onBackdrop(e)) requestClose()
        downOutside.current = false
      }}
    >
      <div className="stack">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost small" onClick={requestClose}>
            Fermer
          </button>
        </div>
        {children}
      </div>

      {confirming && (
        <ConfirmClose
          onCancel={() => setConfirming(false)}
          onDiscard={() => {
            setConfirming(false)
            dialog.current?.close()
          }}
          onSave={
            onSave &&
            (async () => {
              setConfirming(false)
              if (await onSave()) dialog.current?.close()
            })
          }
        />
      )}
    </dialog>
  )
}

/**
 * The backdrop belongs to the <dialog> itself, and so does its padding: an event is on the
 * backdrop when it targets the dialog but lands outside its box.
 */
function onBackdrop(e: PointerEvent<HTMLDialogElement> | MouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return false
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
}

function ConfirmClose({
  onCancel,
  onDiscard,
  onSave,
}: {
  onCancel: () => void
  onDiscard: () => void
  onSave?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="confirm"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      onClick={(e) => onBackdrop(e) && onCancel()}
    >
      <h2 id="confirm-title">Modifications non enregistrées</h2>
      <p>Que veux-tu faire de tes modifications ?</p>
      <div className="confirm-actions">
        {onSave && (
          <button type="button" className="btn honey" autoFocus onClick={onSave}>
            Enregistrer et fermer
          </button>
        )}
        <button type="button" className="btn danger" onClick={onDiscard}>
          Fermer sans enregistrer
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </dialog>
  )
}
