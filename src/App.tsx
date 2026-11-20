import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { Login } from './Login'
import { DishesScreen } from './DishesScreen'

type Membership = 'checking' | 'member' | 'outsider'

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [membership, setMembership] = useState<Membership>('checking')

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
        <button className="btn ghost small" onClick={() => supabase.auth.signOut()}>
          Se déconnecter
        </button>
      </header>
      <DishesScreen />
      <nav className="tabbar" aria-label="Sections">
        <span className="tab" aria-disabled="true">Menu<small>bientôt</small></span>
        <span className="tab active" aria-current="page">Plats</span>
        <span className="tab" aria-disabled="true">Courses<small>bientôt</small></span>
        <span className="tab" aria-disabled="true">Réserve<small>bientôt</small></span>
      </nav>
    </div>
  )
}
