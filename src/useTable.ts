import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { applyChange, coalesce, listen, sortBy, upsert } from './live'
import { applyPending, isNetworkError, onReplaced, onSynced, readCache, writeCache } from './offline'

/**
 * Loads a whole (small) table once and keeps it live: each insert/update/delete,
 * from this phone, the other one or Claude, is applied from the Realtime event,
 * without reloading. `mutate` changes rows on screen right away (before the
 * server confirms); the event that follows brings the confirmed row.
 *
 * Offline: starts from the copy kept on the device, keeps showing it when the
 * network is gone, with the changes waiting in the outbox applied over it.
 */
export function useTable<T extends { id: number }>(table: string, order: keyof T & string, ascending = true) {
  const [rows, setRows] = useState<T[] | null>(() => {
    const cached = readCache<T[]>(table)
    return cached ? sortBy(applyPending(table, cached), order, ascending) : null
  })
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from(table).select('*').order(order, { ascending }).limit(5000)
    if (error) {
      // No network: keep what is on screen (from the device's copy).
      if (!isNetworkError(error)) setError(error.message)
      return
    }
    setError('')
    setRows(sortBy(applyPending(table, data as T[]), order, ascending))
  }, [table, order, ascending])

  // Keep the device's copy up to date (it includes the changes still waiting).
  useEffect(() => {
    if (rows) writeCache(table, rows)
  }, [rows, table])

  useEffect(() => {
    load()
    const stopSynced = onSynced(load)
    // A row added offline got its real id from the server.
    const stopReplaced = onReplaced((t, tempId, row) => {
      if (t === table) setRows((rows) => rows && sortBy(upsert(rows.filter((r) => r.id !== tempId), row as unknown as T), order, ascending))
    })
    const stopLive = listen(
      'live-' + table,
      [{ table, on: (c) => setRows((rows) => rows && sortBy(applyChange(rows, c as never), order, ascending)) }],
      coalesce(load),
    )
    return () => {
      stopSynced()
      stopReplaced()
      stopLive()
    }
  }, [load, table, order, ascending])

  const mutate = useCallback(
    (fn: (rows: T[]) => T[]) => setRows((rows) => rows && sortBy(fn(rows), order, ascending)),
    [order, ascending],
  )

  return { rows, error, reload: load, mutate }
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
