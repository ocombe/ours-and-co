import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

/**
 * Offline mode.
 *
 * Reading: every screen keeps the last data it showed in this device's storage
 * (`readCache` / `writeCache`) and starts from it, so the app opens and shows the
 * lists without network.
 *
 * Writing: changes go through `insertRow`, `updateRow`, `deleteRows` and `eatPart`.
 * Online, they are sent at once. Without network (or while older changes are still
 * waiting, to keep the order), they go to an outbox kept in storage and shown on
 * screen right away; the outbox is sent in order when the network comes back, then
 * the screens reload from the server (`onSynced`). Rows added offline get a temporary
 * negative id until the server gives the real one.
 *
 * `applyPending` replays the waiting changes over data loaded from the server, so a
 * reload never hides them. Every change is idempotent (it sets values), so replaying
 * one twice is harmless.
 */

type Row = Record<string, unknown> & { id: number }

export type Op =
  | { key: string; type: 'insert'; table: string; row: Row; values: Record<string, unknown> }
  | { key: string; type: 'update'; table: string; id: number; changes: Record<string, unknown> }
  | { key: string; type: 'delete'; table: string; ids: number[] }
  | { key: string; type: 'eat'; table: 'menu_items'; id: number; eat: boolean; on: string; eaten: number }

type Result<T> = { data: T | null; error: { message: string } | null; queued: boolean }

// ------------------------------------------------------------------ storage

const OUTBOX = 'offline:outbox'

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or unavailable: the app still works online
  }
}

export function readCache<T>(name: string): T | null {
  return load<T>('cache:' + name)
}

export function writeCache(name: string, value: unknown) {
  save('cache:' + name, value)
}

/** On sign-out: nothing of this account stays on the device. */
export function clearOfflineData() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('cache:') || k === OUTBOX) localStorage.removeItem(k)
    }
  } catch {
    // ignore
  }
  outbox = []
  notify()
}

// ------------------------------------------------------------------ state shared with the UI

let outbox: Op[] = load<Op[]>(OUTBOX) ?? []
let online = typeof navigator === 'undefined' ? true : navigator.onLine
let syncing = false
let lastError = ''
const listeners = new Set<() => void>()
const syncedListeners = new Set<() => void>()
const replacedListeners = new Set<(table: string, tempId: number, row: Row) => void>()

let snapshot = { online, pending: outbox.length, syncing, error: lastError }
function notify() {
  snapshot = { online, pending: outbox.length, syncing, error: lastError }
  listeners.forEach((l) => l())
}

/** Online? How many changes are waiting? Last change the server refused? */
export function useOfflineStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
}

export function dismissOfflineError() {
  lastError = ''
  notify()
}

/** Called after the outbox was sent: screens reload from the server. */
export function onSynced(fn: () => void) {
  syncedListeners.add(fn)
  return () => {
    syncedListeners.delete(fn)
  }
}

/** A row added offline got its real id: replace the temporary one on screen. */
export function onReplaced(fn: (table: string, tempId: number, row: Row) => void) {
  replacedListeners.add(fn)
  return () => {
    replacedListeners.delete(fn)
  }
}

// ------------------------------------------------------------------ network

/** The request did not reach the server (as opposed to the server saying no). */
export function isNetworkError(error: { message?: string } | null | undefined) {
  if (!error) return false
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  // Includes the 10 s limit of supabase.ts ("signal timed out", "aborted").
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|timed out|timeout|abort/i.test(
    error.message ?? '',
  )
}

function setOnline(value: boolean) {
  if (online === value) return
  online = value
  notify()
}

function persist() {
  save(OUTBOX, outbox)
  notify()
}

function newKey() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

let nextTemp = -Date.now()
function tempId() {
  return nextTemp--
}

/** Send one change. Returns 'network' when it did not reach the server. */
async function send(op: Op): Promise<{ data?: Row | null; error?: { message: string } | null; network?: boolean }> {
  let res: { data: unknown; error: { message: string } | null }
  if (op.type === 'insert') res = await supabase.from(op.table).insert(op.values).select().single()
  else if (op.type === 'update') res = await supabase.from(op.table).update(op.changes).eq('id', op.id).select().maybeSingle()
  else if (op.type === 'delete') res = await supabase.from(op.table).delete().in('id', op.ids)
  else
    res = op.eat
      ? await supabase.rpc('eat_part', { p_item: op.id, p_on: op.on })
      : await supabase.rpc('uneat_part', { p_item: op.id })
  if (res.error && isNetworkError(res.error)) return { network: true }
  return { data: (res.data as Row | null) ?? null, error: res.error }
}

/** Queue a change behind the waiting ones, or send it now if nothing waits. */
async function run(op: Op): Promise<Result<Row>> {
  if (outbox.length === 0 && online) {
    const r = await send(op)
    if (!r.network) {
      if (!r.error) setOnline(true)
      return { data: r.data ?? null, error: r.error ?? null, queued: false }
    }
    setOnline(false)
  }
  outbox = [...outbox, op]
  persist()
  scheduleFlush()
  return { data: null, error: null, queued: true }
}

// ------------------------------------------------------------------ public writes

/** Insert a row. Offline, `data` is a local copy with a temporary id (`local` fills the other columns). */
export async function insertRow<T extends { id: number } = Row>(table: string, values: Record<string, unknown>, local: Partial<T> = {}) {
  const now = new Date().toISOString()
  const row = { created_at: now, updated_at: now, ...local, ...values, id: tempId() } as unknown as Row
  const r = await run({ key: newKey(), type: 'insert', table, row, values })
  return { ...r, data: (r.queued ? row : r.data) as T | null }
}

export async function updateRow(table: string, id: number, changes: Record<string, unknown>) {
  return run({ key: newKey(), type: 'update', table, id, changes })
}

export async function deleteRows(table: string, ids: number[]) {
  return run({ key: newKey(), type: 'delete', table, ids })
}

/** Tick (eat) or untick one part of a menu item; `eaten` is the count after the change. */
export async function eatPart(id: number, eat: boolean, on: string, eaten: number) {
  return run({ key: newKey(), type: 'eat', table: 'menu_items', id, eat, on, eaten })
}

// ------------------------------------------------------------------ replay

/** Waiting changes applied over rows of a table (as loaded from the server or the cache). */
export function applyPending<T extends { id: number }>(table: string, rows: T[]): T[] {
  let out = rows
  for (const op of outbox) {
    if (op.table !== table) continue
    if (op.type === 'insert') out = [...out.filter((r) => r.id !== op.row.id), op.row as unknown as T]
    else if (op.type === 'update') out = out.map((r) => (r.id === op.id ? { ...r, ...op.changes } : r))
    else if (op.type === 'delete') out = out.filter((r) => !op.ids.includes(r.id))
    else out = out.map((r) => (r.id === op.id ? { ...r, eaten: op.eaten } : r))
  }
  return out
}

// ------------------------------------------------------------------ flush

let flushTimer: ReturnType<typeof setTimeout> | undefined

function scheduleFlush(delay = 15000) {
  clearTimeout(flushTimer)
  if (outbox.length) flushTimer = setTimeout(flush, delay)
}

/** Ids given by the server to rows added offline, in the changes still waiting. */
function rewrite(tempId: number, realId: number) {
  outbox = outbox.map((op) => {
    if ((op.type === 'update' || op.type === 'eat') && op.id === tempId) return { ...op, id: realId }
    if (op.type === 'delete' && op.ids.includes(tempId)) return { ...op, ids: op.ids.map((i) => (i === tempId ? realId : i)) }
    return op
  })
}

/** Send the waiting changes, in order; stop at the first one that does not get through. */
export async function flush() {
  if (syncing || outbox.length === 0) return
  syncing = true
  notify()
  let sent = 0
  while (outbox.length) {
    const op = outbox[0]
    const r = await send(op)
    if (r.network) {
      setOnline(false)
      break
    }
    setOnline(true)
    outbox = outbox.slice(1)
    sent++
    if (r.error) {
      // The server refused it (deleted meanwhile, rule…): drop it and say so.
      lastError = `Une modification faite hors ligne n’a pas pu être enregistrée : ${r.error.message}`
    } else if (op.type === 'insert' && r.data) {
      rewrite(op.row.id, r.data.id)
      replacedListeners.forEach((l) => l(op.table, op.row.id, r.data!))
    }
    persist()
  }
  syncing = false
  notify()
  if (outbox.length) scheduleFlush()
  if (sent) syncedListeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    setOnline(true)
    flush()
  })
  window.addEventListener('offline', () => setOnline(false))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && flush())
  // Changes left from a previous visit.
  setTimeout(flush, 1000)
}
