import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { useDishes } from './data'
import { fuzzyScore } from './fuzzy'
import { CATEGORIES, MOMENT_LABEL, type Dish } from './types'
import { DishSheet } from './DishSheet'

type Filter = 'all' | 'midi' | 'soir' | 'review' | 'favorite'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'midi', label: 'Midi' },
  { id: 'soir', label: 'Soir' },
  { id: 'favorite', label: 'Favoris' },
  { id: 'review', label: 'À vérifier' },
]

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
  const { dishes, error: loadError } = useDishes()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<Dish | 'new' | null>(null)
  const { byDish: ingredientsOf, reload: reloadIngredients } = useDishIngredientNames()

  /** Fuzzy match on the name, old FamilyWall names, then ingredients. */
  const results = useMemo(() => {
    if (!dishes || !query.trim()) return null
    return dishes
      .filter((d) => matchesFilter(d, filter))
      .map((d) => {
        const byName = Math.max(fuzzyScore(query, d.name), ...d.aliases.map((a) => fuzzyScore(query, a) * 0.9))
        let via: string | undefined
        let byIngredient = 0
        for (const name of ingredientsOf.get(d.id) ?? []) {
          const s = fuzzyScore(query, name) * 0.8
          if (s > byIngredient) [byIngredient, via] = [s, name]
        }
        return { d, score: Math.max(byName, byIngredient), via: byIngredient > byName ? via : undefined }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.d.times - a.d.times)
  }, [dishes, query, filter, ingredientsOf])

  const groups = useMemo(() => {
    if (!dishes) return []
    if (results) return [{ cat: 'Résultats', items: results.map((r) => r.d) }]
    const visible = dishes.filter((d) => matchesFilter(d, filter))
    const order = [...CATEGORIES, ...new Set(visible.map((d) => d.category))]
    return [...new Set(order)]
      .map((cat) => ({
        cat,
        items: visible
          .filter((d) => d.category === cat)
          .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name, 'fr')),
      }))
      .filter((g) => g.items.length > 0)
  }, [dishes, filter, results])
  const viaIngredient = new Map(results?.filter((r) => r.via).map((r) => [r.d.id, r.via!]))

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
          placeholder="Chercher un plat ou un ingrédient…"
          aria-label="Chercher un plat ou un ingrédient"
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
                    {d.kids_only ? <span className="tag">pour les filles</span> : d.kids_ok && <span className="tag">filles ok</span>}
                    {viaIngredient.has(d.id) && <span className="muted">avec {viaIngredient.get(d.id)!.toLowerCase()}</span>}
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
          onClose={() => {
            setEditing(null)
            reloadIngredients() // they may have been edited in the sheet
          }}
          onSaved={() => {
            // The saved dish comes back through the live sync; ingredients are not live.
            setEditing(null)
            reloadIngredients()
          }}
        />
      )}
    </main>
  )
}

/** Ingredient names of each dish, for the search. */
function useDishIngredientNames() {
  const [byDish, setByDish] = useState(new Map<number, string[]>())
  const reload = useCallback(async () => {
    const { data } = await supabase.from('dish_ingredients').select('dish_id, ingredients(name)')
    const map = new Map<number, string[]>()
    for (const r of (data ?? []) as unknown as { dish_id: number; ingredients: { name: string } | null }[]) {
      if (r.ingredients) map.set(r.dish_id, [...(map.get(r.dish_id) ?? []), r.ingredients.name])
    }
    setByDish(map)
  }, [])
  useEffect(() => {
    reload()
  }, [reload])
  return { byDish, reload }
}
