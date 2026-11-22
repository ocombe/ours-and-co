import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Live sync with few requests. Changes (from this phone, the other one or Claude) come
 * through Realtime with the changed row: they are applied to what is on screen instead
 * of reloading whole tables. A full reload only happens when the connection comes back
 * (events may have been missed) or the app comes back to the foreground.
 */

export type Change<T> = RealtimePostgresChangesPayload<T & { [key: string]: unknown }>

interface Listener<T> {
  table: string
  on: (change: Change<T>) => void
}

/**
 * Listen to changes of some tables. `resync` runs when the connection comes back
 * after a drop, and when the app returns to the foreground. Returns the cleanup.
 */
export function listen(name: string, listeners: Listener<never>[], resync: () => void) {
  // A name per mount: a channel with the same name that is still closing would be reused.
  let channel = supabase.channel(`${name}-${Math.random().toString(36).slice(2)}`)
  for (const l of listeners) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: l.table }, (p) =>
      l.on(p as Change<never>),
    )
  }
  let first = true
  channel.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return
    if (!first) resync()
    first = false
  })
  const onVisible = () => document.visibilityState === 'visible' && resync()
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    supabase.removeChannel(channel)
  }
}

/** Apply a Realtime change to a list of rows with an id (insert, update or delete). */
export function applyChange<T extends { id: number }>(rows: T[], change: Change<T>, accept: (row: T) => boolean = () => true): T[] {
  if (change.eventType === 'DELETE') {
    const id = (change.old as Partial<T>).id
    return rows.filter((r) => r.id !== id)
  }
  return upsert(rows, change.new as T, accept)
}

/** Insert or replace rows by id (a row that is no longer accepted is removed). */
export function upsert<T extends { id: number }>(rows: T[], row: T | T[], accept: (row: T) => boolean = () => true): T[] {
  let out = rows
  for (const r of Array.isArray(row) ? row : [row]) {
    const rest = out.filter((x) => x.id !== r.id)
    out = accept(r) ? [...rest, r] : rest
  }
  return out
}

/** Sort rows by one column, then by id. */
export function sortBy<T extends { id: number }>(rows: T[], column: keyof T & string, ascending = true): T[] {
  const dir = ascending ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = a[column] as unknown
    const y = b[column] as unknown
    let c = 0
    if (x == null || y == null) c = x == null ? (y == null ? 0 : 1) : -1
    else if (typeof x === 'number' && typeof y === 'number') c = x - y
    else c = String(x).localeCompare(String(y), 'fr')
    return c * dir || a.id - b.id
  })
}

/**
 * Run `fn` (a reload) at most once at a time: calls during a run, or in a burst
 * (within `wait` ms), give a single run after.
 */
export function coalesce(fn: () => Promise<unknown>, wait = 150) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let again = false
  async function start() {
    timer = undefined
    if (running) {
      again = true
      return
    }
    running = true
    try {
      await fn()
    } finally {
      running = false
      if (again) {
        again = false
        request()
      }
    }
  }
  function request() {
    if (!timer) timer = setTimeout(start, wait)
  }
  return request
}
