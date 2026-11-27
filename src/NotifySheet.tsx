import { useEffect, useState } from 'react'
import { Sheet } from './Sheet'
import { disablePush, enablePush, pushState, testNotification, type PushState } from './push'

/** Turn notifications on or off for this phone. */
export function NotifySheet({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    pushState().then(setState, () => setState('unsupported'))
  }, [])

  async function act(fn: () => Promise<PushState>) {
    setBusy(true)
    setError('')
    try {
      setState(await fn())
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <Sheet title="Notifications" onClose={onClose}>
      <p>
        Quand l’autre ajoute des produits à une liste de courses, une notification arrive sur ce téléphone, même appli
        fermée (une par liste, une minute après le dernier ajout). Tes propres ajouts ne te notifient pas.
      </p>

      {state === null && <p className="muted">…</p>}
      {state === 'unsupported' && (
        <p className="notice-text">
          Ce navigateur ne permet pas les notifications. Sur iPhone, ajoute d’abord Ours &amp; Co à l’écran d’accueil
          (Partager → Sur l’écran d’accueil), puis ouvre-la depuis là.
        </p>
      )}
      {state === 'denied' && (
        <p className="notice-text">
          Les notifications sont bloquées pour Ours &amp; Co. Autorise-les dans les réglages du téléphone (Applis → Ours &amp;
          Co → Notifications), puis reviens ici.
        </p>
      )}
      {state === 'off' && (
        <div className="sheet-actions">
          <button className="btn honey" disabled={busy} onClick={() => act(enablePush)}>
            Activer sur ce téléphone
          </button>
        </div>
      )}
      {state === 'on' && (
        <>
          <p className="notice-text">Activées sur ce téléphone.</p>
          <div className="sheet-actions">
            <button className="btn ghost" disabled={busy} onClick={() => testNotification().catch((e) => setError(e.message))}>
              Essayer
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => act(disablePush)}>
              Désactiver
            </button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </Sheet>
  )
}
