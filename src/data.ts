import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { applyChange, coalesce, listen, sortBy, upsert, type Change } from './live'
import { readCache, writeCache } from './offline'
import type { Dish, DishWithStats } from './types'

const WEEK = 7 * 24 * 3600 * 1000
/** FamilyWall imports have no dates: ~10 meals were planned per week. */
const LEGACY_MEALS_PER_WEEK = 10

/**
 * Loads all dishes with how often and how recently they were eaten.
 * Dish changes (other phone, Claude…) are applied live from the Realtime event.
 * History is not live: `ate` updates the stats on screen when a part is ticked here,
 * and everything is reloaded when the app comes back to the foreground.
 */
export function useDishes() {
  // Start from the copy kept on the device (offline, or before the server answers).
  const [dishes, setDishes] = useState<DishWithStats[] | null>(() => readCache<DishWithStats[]>('dishes'))
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [d, h] = await Promise.all([
      supabase.from('dishes').select('*').order('name'),
      supabase.from('history').select('dish_id, eaten_on, legacy_rank').limit(20000),
    ])
    if (d.error || h.error) {
      // Offline with a copy on the device: keep showing it.
      if (!readCache('dishes')) setError((d.error ?? h.error)!.message)
      return
    }
    const maxRank = Math.max(0, ...h.data.map((r) => r.legacy_rank ?? 0))
    const stats = new Map<number, { times: number; weeksAgo: number }>()
    const now = Date.now()
    for (const r of h.data) {
      if (r.dish_id == null) continue
      const weeksAgo =
        r.eaten_on != null
          ? (now - new Date(r.eaten_on).getTime()) / WEEK
          : (maxRank - (r.legacy_rank ?? 0)) / LEGACY_MEALS_PER_WEEK + 1
      const s = stats.get(r.dish_id) ?? { times: 0, weeksAgo: Infinity }
      s.times += 1
      s.weeksAgo = Math.min(s.weeksAgo, weeksAgo)
      stats.set(r.dish_id, s)
    }
    setDishes(
      (d.data as Dish[]).map((x) => ({
        ...x,
        times: stats.get(x.id)?.times ?? 0,
        weeksAgo: stats.get(x.id)?.weeksAgo ?? null,
      })),
    )
  }, [])

  useEffect(() => {
    load()
    return listen(
      'dishes',
      [
        {
          table: 'dishes',
          on: (c) =>
            setDishes((cur) => {
              if (!cur) return cur
              const change = c as Change<Dish>
              if (change.eventType === 'DELETE') return applyChange(cur, change as never)
              // Keep the stats: they come from the history, not from the dish row.
              const row = change.new as Dish
              const old = cur.find((d) => d.id === row.id)
              return sortBy(upsert(cur, { ...row, times: old?.times ?? 0, weeksAgo: old?.weeksAgo ?? null }), 'name')
            }),
        },
      ],
      coalesce(load),
    )
  }, [load])

  /** A part of this dish was just eaten (+1) or un-ticked (-1) here. */
  const ate = useCallback((dishId: number, delta: 1 | -1) => {
    setDishes((cur) =>
      cur?.map((d) =>
        d.id === dishId
          ? // Un-ticking keeps "eaten recently": the exact previous date comes back on the next reload.
            { ...d, times: Math.max(0, d.times + delta), weeksAgo: delta > 0 ? 0 : d.weeksAgo }
          : d,
      ) ?? cur,
    )
  }, [])

  useEffect(() => {
    if (dishes) writeCache('dishes', dishes)
  }, [dishes])

  return { dishes, error, reload: load, ate }
}
