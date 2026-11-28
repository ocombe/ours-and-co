import { createClient } from '@supabase/supabase-js'

/** A request that gets no answer in this time counts as "no network" (see offline.ts). */
const TIMEOUT_MS = 10000

// In a shop, the phone often shows a connection that answers nothing: without a limit,
// a request would hang and the change would never be queued for later.
function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const signal = init.signal && 'any' in AbortSignal ? AbortSignal.any([init.signal, timeout]) : (init.signal ?? timeout)
  return fetch(input, { ...init, signal })
}

// Publishable key: safe in the browser. Data is protected by RLS
// (only household members listed in public.members can read or write).
export const supabase = createClient(
  'https://xeobqdfkjbtclosrfhmi.supabase.co',
  'sb_publishable_r3LHehf4T-I8L8I1odP6Uw_JOe0Uon9',
  { global: { fetch: fetchWithTimeout } },
)
