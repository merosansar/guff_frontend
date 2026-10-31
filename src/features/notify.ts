/** Desktop notifications for DMs and mentions while the tab is in the background. */

const KEY = "guff-notifications"

export const notificationsSupported = () => typeof window !== "undefined" && "Notification" in window

export function notificationsWanted(): boolean {
  try {
    return localStorage.getItem(KEY) === "on" && notificationsSupported() && Notification.permission === "granted"
  } catch {
    return false
  }
}

/** Asks the browser for permission (only ever from a click). Returns whether they're on. */
export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission
  const on = permission === "granted"
  try {
    localStorage.setItem(KEY, on ? "on" : "off")
  } catch {
    /* storage blocked */
  }
  return on
}

export function disableNotifications() {
  try {
    localStorage.setItem(KEY, "off")
  } catch {
    /* storage blocked */
  }
}

export function notify(title: string, body: string, onClick: () => void) {
  if (!notificationsWanted() || document.visibilityState === "visible") return
  try {
    const n = new Notification(title, { body, icon: "/favicon.svg", tag: title })
    n.onclick = () => {
      window.focus()
      onClick()
      n.close()
    }
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}
