import { dismissOfflineError, flush, useOfflineStatus } from './offline'

/** "Hors ligne · 3 modifications en attente", under the top bar while it matters. */
export function OfflineBanner() {
  const { online, pending, syncing, error } = useOfflineStatus()
  const plural = pending > 1 ? 's' : ''

  if (error) {
    return (
      <div className="offline-banner error-banner" role="alert">
        <span>{error}</span>
        <button className="btn ghost small" onClick={dismissOfflineError}>
          OK
        </button>
      </div>
    )
  }
  if (online && pending === 0) return null
  return (
    <div className="offline-banner" role="status">
      <span>
        {!online ? 'Hors ligne' : syncing ? 'Envoi des modifications…' : 'Modifications en attente'}
        {pending > 0 && ` · ${pending} modification${plural} en attente`}
        {!online && pending === 0 && ' · tes modifications seront envoyées au retour du réseau'}
      </span>
      {pending > 0 && !syncing && (
        <button className="btn ghost small" onClick={() => flush()}>
          Réessayer
        </button>
      )}
    </div>
  )
}
