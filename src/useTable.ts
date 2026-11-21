import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Loads a whole (small) table and keeps it live: any insert/update/delete,
 * from this phone, the other one or Claude, triggers a reload.
 */
export function useTable<T>(table: string, order: string, ascending = true) {
  const [rows, setRows] = useState<T[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from(table).select('*').order(order, { ascending }).limit(5000)
    if (error) setError(error.message)
    else setRows(data as T[])
  }, [table, order, ascending])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('live-' + table)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, table])

  return { rows, error, reload: load }
}

/** Remembered UI choice (tab, list…); silently not remembered in private mode. */
export function remember(key: string, value?: string) {
  try {
    if (value === undefined) return localStorage.getItem(key)
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable
  }
  return null
}
