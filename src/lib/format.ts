const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const dayDiff = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000)

/** 9:05 AM */
export function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso
  let h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, "0")
  const ampm = h >= 12 ? "PM" : "AM"
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

/** "Today", "Yesterday", "Tuesday 27 October", or "27 October 2025" for other years. */
export function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const diff = dayDiff(now, d)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff < 7 && diff > 0) return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
  if (d.getFullYear() === now.getFullYear()) return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Full date and time for tooltips: "Tuesday 27 October 2026 at 9:05 AM" */
export function formatFull(iso: string): string {
  const d = new Date(iso)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} at ${formatTime(d)}`
}

/** For lists: "9:05 AM" today, "Yesterday", "Tue", or "27 Oct". */
export function formatShort(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const diff = dayDiff(now, d)
  if (diff === 0) return formatTime(d)
  if (diff === 1) return "Yesterday"
  if (diff < 7) return DAYS[d.getDay()]!.slice(0, 3)
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

export const sameDay = (a: string, b: string) => dayDiff(new Date(a), new Date(b)) === 0

/** "Active 5 minutes ago", for people who are offline. */
export function lastSeen(iso: string | null, now = Date.now()): string {
  if (!iso) return "Not active yet"
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return "Active just now"
  if (minutes < 60) return `Active ${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Active ${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  return `Active ${days} day${days === 1 ? "" : "s"} ago`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")

export const firstName = (name: string) => name.split(/\s+/)[0] ?? name

/** "Sita", "Sita and Bikash", "Sita, Bikash and 2 others" */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`
}
