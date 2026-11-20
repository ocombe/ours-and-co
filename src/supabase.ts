import { createClient } from '@supabase/supabase-js'

// Publishable key: safe in the browser. Data is protected by RLS
// (only household members listed in public.members can read or write).
export const supabase = createClient(
  'https://xeobqdfkjbtclosrfhmi.supabase.co',
  'sb_publishable_r3LHehf4T-I8L8I1odP6Uw_JOe0Uon9',
)
