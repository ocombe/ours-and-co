import { useRegisterSW } from 'virtual:pwa-register/react'

/** How often an open app looks for a new version. */
const CHECK_EVERY = 30 * 60 * 1000

/**
 * When a new version of the app is online, the old one keeps running from the cache
 * (no Ctrl+Shift+R on a phone). The app looks for a new version when it comes back to
 * the foreground and every 30 minutes; when one is ready, this banner offers to load it.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        // Not while offline: the check would fail anyway.
        if (navigator.onLine && !registration.installing) registration.update().catch(() => {})
      }
      setInterval(check, CHECK_EVERY)
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
    },
  })

  if (!needRefresh) return null
  return (
    <div className="update-banner" role="status">
      <span>Une nouvelle version d’Ours &amp; Co est disponible.</span>
      <div className="update-actions">
        <button className="btn honey small" onClick={() => updateServiceWorker(true)}>
          Mettre à jour
        </button>
        <button className="btn ghost small" aria-label="Plus tard" onClick={() => setNeedRefresh(false)}>
          Plus tard
        </button>
      </div>
    </div>
  )
}
