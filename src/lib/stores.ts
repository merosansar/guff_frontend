import { useSyncExternalStore } from "react"
import type { Attachment } from "./types"

/** A tiny observable value for state that lives outside React Query. */
function createStore<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: T | ((prev: T) => T)) {
      value = typeof next === "function" ? (next as (prev: T) => T)(value) : next
      listeners.forEach((l) => l())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// ---- connection ------------------------------------------------------------

export type ConnectionStatus = "connecting" | "online" | "reconnecting"
export const connectionStore = createStore<ConnectionStatus>("connecting")
export const useConnection = () => useSyncExternalStore(connectionStore.subscribe, connectionStore.get)

// ---- typing ----------------------------------------------------------------

/** channelId → userIds currently typing. Entries expire on their own if "stopped" never arrives. */
const typingStore = createStore<Record<string, string[]>>({})
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const EMPTY: string[] = []

export function setTyping(channelId: string, userId: string, typing: boolean) {
  const key = `${channelId}:${userId}`
  clearTimeout(typingTimers.get(key))
  typingTimers.delete(key)
  if (typing) typingTimers.set(key, setTimeout(() => setTyping(channelId, userId, false), 6000))
  typingStore.set((prev) => {
    const current = prev[channelId] ?? EMPTY
    const has = current.includes(userId)
    if (typing === has) return prev
    const next = typing ? [...current, userId] : current.filter((id) => id !== userId)
    return { ...prev, [channelId]: next }
  })
}

export const useTyping = (channelId: string) =>
  useSyncExternalStore(typingStore.subscribe, () => typingStore.get()[channelId] ?? EMPTY)
export const useAllTyping = () => useSyncExternalStore(typingStore.subscribe, typingStore.get)

// ---- messages on their way -------------------------------------------------------

export interface PendingMessage {
  clientId: string
  channelId: string
  text: string
  replyToId: string | null
  /** Set when the message is a reply in a thread. */
  threadRootId: string | null
  attachments: Attachment[]
  createdAt: string
  status: "sending" | "failed"
  error?: string
}

/** Messages shown immediately while the server confirms them (or failed and wait for a retry). */
export const pendingStore = createStore<PendingMessage[]>([])

export function addPending(message: PendingMessage) {
  pendingStore.set((list) => [...list.filter((m) => m.clientId !== message.clientId), message])
}
export function updatePending(clientId: string, changes: Partial<PendingMessage>) {
  pendingStore.set((list) => list.map((m) => (m.clientId === clientId ? { ...m, ...changes } : m)))
}
export function removePending(clientId: string) {
  pendingStore.set((list) => (list.some((m) => m.clientId === clientId) ? list.filter((m) => m.clientId !== clientId) : list))
}
export const usePending = () => useSyncExternalStore(pendingStore.subscribe, pendingStore.get)

// ---- what's on screen ------------------------------------------------------------

/** The conversation in view, and whether its newest message is visible. Used to mark messages read. */
export const viewStore = createStore<{ channelId: string | null; atBottom: boolean }>({ channelId: null, atBottom: true })
