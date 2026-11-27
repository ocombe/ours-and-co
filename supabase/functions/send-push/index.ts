// Sends the shopping-list notifications that are due ("Olivier a ajouté 3 produits à Marché").
// Called every minute by pg_cron (private.push_flush) when a group of additions has been
// quiet for a minute. Public on purpose (no JWT): calling it only sends what is already due.
// The data, the subscriptions and the VAPID key come from public.push_take_batch, which
// only the service role may call.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import webpush from 'npm:web-push@3.6.7'

interface Subscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

interface Due {
  list: string
  list_slug: string
  list_id: number
  author: string
  labels: string[]
  subscriptions: Subscription[]
}

interface Batch {
  notifications: Due[]
  vapid: { public: string; private: string | null; subject: string }
}

const APP_URL = '/ours-and-co/'

function message(n: Due) {
  const count = n.labels.length
  const shown = n.labels.slice(0, 4).join(', ') + (count > 4 ? '…' : '')
  return {
    title: n.list,
    body: `${n.author} a ajouté ${count > 1 ? `${count} produits` : 'un produit'} : ${shown}`,
    url: `${APP_URL}#/courses/${n.list_slug}`,
    // One notification per list on the phone: a newer one replaces the older.
    tag: `list-${n.list_id}`,
  }
}

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await db.rpc('push_take_batch')
  if (error) return new Response(error.message, { status: 500 })
  const batch = data as Batch
  if (!batch.vapid.private) return new Response('VAPID private key missing in Vault', { status: 500 })
  webpush.setVapidDetails(batch.vapid.subject, batch.vapid.public, batch.vapid.private)

  const gone: string[] = []
  let sent = 0
  for (const n of batch.notifications) {
    const payload = JSON.stringify(message(n))
    await Promise.all(
      n.subscriptions.map(async (s) => {
        try {
          await webpush.sendNotification(s, payload, { TTL: 12 * 3600, urgency: 'normal' })
          sent++
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode
          // 404 / 410: the phone unsubscribed or the browser data was cleared.
          if (status === 404 || status === 410) gone.push(s.endpoint)
          else console.error('push failed', status, (e as Error).message)
        }
      }),
    )
  }
  if (gone.length) await db.rpc('push_forget', { p_endpoints: gone })

  return Response.json({ groups: batch.notifications.length, sent, forgotten: gone.length })
})
