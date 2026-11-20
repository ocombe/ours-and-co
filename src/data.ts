import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Dish, DishWithStats } from './types'

const WEEK = 7 * 24 * 3600 * 1000
/** FamilyWall imports have no dates: ~10 meals were planned per week. */
const LEGACY_MEALS_PER_WEEK = 10

/**
 * Loads all dishes with how often and how recently they were eaten.
 * Re-loads when dishes or history change (other phone, Claude…).
 */
export function useDishes() {
  const [dishes, setDishes] = useState<DishWithStats[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [d, h] = await Promise.all([
      supabase.from('dishes').select('*').order('name'),
      supabase.from('history').select('dish_id, eaten_on, legacy_rank').limit(20000),
    ])
    if (d.error || h.error) {
      setError((d.error ?? h.error)!.message)
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
    const channel = supabase
      .channel('dishes-and-history')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dishes' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  return { dishes, error, reload: load }
}
