import { supabase } from './supabase'

/** Public half of the VAPID key pair (the private half is in Supabase Vault). */
const VAPID_PUBLIC_KEY = 'BA2cX8pdRfQYtre1ElsYKBj7zpMry00hN3jTNK3vLpoVYgnPfvgTljNKF_03e2AoeNl0Sxc5an4Dnw1G2vd0CpQ'

export type PushState = 'unsupported' | 'denied' | 'off' | 'on'

function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

async function registration() {
  return navigator.serviceWorker.ready
}

function keyBytes(base64url: string) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4)
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** Are notifications on for this device (browser)? */
export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const sub = await (await registration()).pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

/** Ask the permission, subscribe this device and save the subscription for the sender. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  const reg = await registration()
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }))
  const json = sub.toJSON()
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ endpoint: sub.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth }, { onConflict: 'endpoint' })
  if (error) throw new Error(error.message)
  return 'on'
}

/** Stop notifications on this device. */
export async function disablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  const sub = await (await registration()).pushManager.getSubscription()
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
  return 'off'
}

/** A local notification, to check that this device shows them. */
export async function testNotification() {
  const reg = await registration()
  await reg.showNotification('Ours & Co', {
    body: 'Les notifications marchent sur cet appareil.',
    icon: import.meta.env.BASE_URL + 'icons/icon-192.png',
    badge: import.meta.env.BASE_URL + 'icons/badge-96.png',
    tag: 'test',
  })
}
