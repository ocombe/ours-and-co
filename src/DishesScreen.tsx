import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { CATEGORIES, MOMENT_LABEL, type Dish, type DishWithStats } from './types'
import { DishSheet } from './DishSheet'

type Filter = 'all' | 'midi' | 'soir' | 'review' | 'favorite'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'midi', label: 'Midi' },
  { id: 'soir', label: 'Soir' },
  { id: 'favorite', label: 'Favoris' },
  { id: 'review', label: 'À vérifier' },
]

/** Lowercase, no accents: "Épinards" -> "epinards". */
export function fold(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

function matchesFilter(d: Dish, f: Filter) {
  switch (f) {
    case 'all':
      return true
    case 'midi':
      return d.usual_moment === 'midi' || d.usual_moment === 'both'
    case 'soir':
      return d.usual_moment === 'soir' || d.usual_moment === 'both'
    case 'review':
      return d.to_review
    case 'favorite':
      return d.favorite
  }
}

export function DishesScreen() {
  const [dishes, setDishes] = useState<DishWithStats[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<Dish | 'new' | null>(null)

  const load = useCallback(async () => {
    const [d, h] = await Promise.all([
      supabase.from('dishes').select('*').order('name'),
      supabase.from('history').select('dish_id').limit(10000),
    ])
    if (d.error || h.error) {
      setLoadError((d.error ?? h.error)!.message)
      return
    }
    const counts = new Map<number, number>()
    for (const row of h.data) {
      if (row.dish_id != null) counts.set(row.dish_id, (counts.get(row.dish_id) ?? 0) + 1)
    }
    setDishes((d.data as Dish[]).map((x) => ({ ...x, times: counts.get(x.id) ?? 0 })))
  }, [])

  useEffect(() => {
    load()
    // Changes made by the other phone (or by Claude) show up live.
    const channel = supabase
      .channel('dishes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dishes' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  const groups = useMemo(() => {
    if (!dishes) return []
    const q = fold(query.trim())
    const visible = dishes.filter(
      (d) =>
        matchesFilter(d, filter) &&
        (!q || fold(d.name).includes(q) || d.aliases.some((a) => fold(a).includes(q))),
    )
    const order = [...CATEGORIES, ...new Set(visible.map((d) => d.category))]
    return [...new Set(order)]
      .map((cat) => ({
        cat,
        items: visible
          .filter((d) => d.category === cat)
          .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name, 'fr')),
      }))
      .filter((g) => g.items.length > 0)
  }, [dishes, query, filter])

  const reviewCount = dishes?.filter((d) => d.to_review).length ?? 0
  const shown = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <main className="screen">
      <div className="screen-head">
        <h1>Plats</h1>
        <button className="btn honey" onClick={() => setEditing('new')}>
          Ajouter un plat
        </button>
      </div>

      <div className="search-bar">
        <input
          type="search"
          placeholder="Chercher un plat…"
          aria-label="Chercher un plat"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="chips" role="radiogroup" aria-label="Filtrer">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={filter === f.id}
              className={'chip' + (filter === f.id ? ' on' : '')}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.id === 'review' && reviewCount > 0 && <span className="count">{reviewCount}</span>}
            </button>
          ))}
        </div>
      </div>

      {loadError && <p className="error">Impossible de charger les plats : {loadError}</p>}
      {!dishes && !loadError && <p className="muted">Chargement…</p>}
      {dishes && shown === 0 && (
        <div className="empty">
          <p>Aucun plat ne correspond.</p>
          {query && (
            <button className="btn ghost" onClick={() => setEditing('new')}>
              Ajouter « {query.trim()} »
            </button>
          )}
        </div>
      )}

      {groups.map((g) => (
        <section key={g.cat} className="group">
          <h2>
            {g.cat}
            <span className="muted"> {g.items.length}</span>
          </h2>
          <ul className="dish-list">
            {g.items.map((d) => (
              <li key={d.id}>
                <button className="dish-row" onClick={() => setEditing(d)}>
                  <span className="dish-name">
                    {d.favorite && <span aria-label="Favori">★ </span>}
                    {d.name}
                    {d.to_review && <span className="review-dot" title="À vérifier" />}
                  </span>
                  <span className="dish-meta">
                    <span className={'moment m-' + d.usual_moment}>{MOMENT_LABEL[d.usual_moment]}</span>
                    {d.meals_covered > 1 && <span className="tag">{d.meals_covered} repas</span>}
                    {d.effort === 'long' && <span className="tag">long à faire</span>}
                    {d.kids_ok && <span className="tag">filles ok</span>}
                    {d.times > 0 && <span className="times">fait {d.times}×</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {editing && (
        <DishSheet
          dish={editing === 'new' ? null : editing}
          initialName={editing === 'new' ? query.trim() : ''}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </main>
  )
}
