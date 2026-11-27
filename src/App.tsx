import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { Login } from './Login'
import { DishesScreen } from './DishesScreen'
import { MenuScreen } from './MenuScreen'
import { CoursesScreen } from './CoursesScreen'
import { ReserveScreen } from './ReserveScreen'
import { remember } from './useTable'
import { useHashPath } from './route'
import { NotifySheet } from './NotifySheet'

const TABS = [
  { id: 'menu', label: 'Menu' },
  { id: 'plats', label: 'Plats' },
  { id: 'courses', label: 'Courses' },
  { id: 'reserve', label: 'Réserve' },
] as const
type Tab = (typeof TABS)[number]['id']

function initialTab(): Tab {
  const saved = remember('tab')
  return TABS.find((t) => t.id === saved)?.id ?? 'menu'
}

type Membership = 'checking' | 'member' | 'outsider'

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [membership, setMembership] = useState<Membership>('checking')
  const { path, go } = useHashPath()
  const [notify, setNotify] = useState(false)

  // A tapped notification asks the open app to show its list.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'open' && typeof e.data.url === 'string') location.assign(e.data.url)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [])
  // The URL says which tab; without one (first visit), the last tab used.
  const tab: Tab = TABS.find((t) => t.id === path?.[0])?.id ?? initialTab()

  useEffect(() => {
    remember('tab', tab)
    // Write the tab in the URL, without adding a history step (not over the sign-in callback).
    if (!path && !location.hash) go([tab], true)
  }, [tab, path, go])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    setMembership('checking')
    // RLS only lets household members see the member list.
    supabase
      .from('members')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setMembership(data ? 'member' : 'outsider'))
  }, [session])

  if (session === undefined) return null
  if (!session) return <Login />

  if (membership === 'checking') return null
  if (membership === 'outsider') {
    return (
      <main className="center-card">
        <h1 className="brand">Ours &amp; Co</h1>
        <p>
          Tu es connecté avec <strong>{session.user.email}</strong>, mais ce compte ne fait pas encore
          partie de la famille. Demande à Olivier de l’ajouter, puis recharge la page.
        </p>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>
          Se déconnecter
        </button>
      </main>
    )
  }

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand with-bear">
          <img src={import.meta.env.BASE_URL + 'icons/bear-head-128.png'} alt="" width="36" height="36" />
          Ours &amp; Co
        </span>
        <div className="topbar-actions">
          <button className="icon-btn bell" aria-label="Notifications" title="Notifications" onClick={() => setNotify(true)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M12 3a6 6 0 0 0-6 6v3.6L4.3 15.5A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.5L18 12.6V9a6 6 0 0 0-6-6Zm0 19a3 3 0 0 0 2.8-2H9.2A3 3 0 0 0 12 22Z" />
            </svg>
          </button>
          <button className="btn ghost small" onClick={() => supabase.auth.signOut()}>
            Se déconnecter
          </button>
        </div>
      </header>
      {notify && <NotifySheet onClose={() => setNotify(false)} />}
      {tab === 'menu' && <MenuScreen />}
      {tab === 'plats' && <DishesScreen />}
      {tab === 'courses' && <CoursesScreen listSlug={path?.[1]} onList={(s, replace) => go(['courses', s], replace)} />}
      {tab === 'reserve' && <ReserveScreen />}
      <nav className="tabbar" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={'tab' + (tab === t.id ? ' active' : '')}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => go([t.id])}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
