import { api } from "@/lib/api"

/**
 * The service worker makes Guff installable (a PWA) and receives push notifications
 * while no Guff tab is open.
 */

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* not fatal: the app works without it */
    })
  })
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "===".slice((base64url.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Subscribes this browser to push. Call from a click (browsers ask for permission). */
export async function enablePush(publicKey: string): Promise<boolean> {
  if (!pushSupported()) return false
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission
  if (permission !== "granted") return false
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  await api.push.subscribe(sub.toJSON())
  return true
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await api.push.unsubscribe(sub.endpoint).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

/** Signing out: this browser shouldn't keep getting someone's notifications. */
export async function forgetPushOnSignOut(): Promise<void> {
  try {
    await disablePush()
  } catch {
    /* best effort */
  }
}
