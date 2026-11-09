import { type InfiniteData, type QueryClient, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { api } from "@/lib/api"
import type { Channel, Member, Message, MessagePage, SavedMessage, Thread, User } from "@/lib/types"

export const keys = {
  users: ["users"] as const,
  channels: ["channels"] as const,
  channel: (id: string) => ["channel", id] as const,
  messages: (id: string, anchor?: string | null) => ["messages", id, anchor ?? "latest"] as const,
  messagesOf: (id: string) => ["messages", id] as const,
  members: (id: string) => ["members", id] as const,
  browse: (q: string) => ["browse", q] as const,
  thread: (rootId: string) => ["thread", rootId] as const,
  pins: (channelId: string) => ["pins", channelId] as const,
  bookmarks: ["bookmarks"] as const,
  scheduled: ["scheduled"] as const,
  config: ["config"] as const,
  webhooks: (channelId: string) => ["webhooks", channelId] as const,
}

export type MessagesData = InfiniteData<MessagePage, MessagesCursor>
export type MessagesCursor = { before?: string; after?: string; around?: string }

// ---- reading ----------------------------------------------------------------

export function useUsers() {
  const query = useQuery({ queryKey: keys.users, queryFn: api.users.list, staleTime: 60_000 })
  const byId = useMemo(() => new Map((query.data ?? []).map((u) => [u.id, u])), [query.data])
  return { ...query, users: query.data ?? [], byId }
}

export function useChannels() {
  const query = useQuery({ queryKey: keys.channels, queryFn: api.channels.list, staleTime: 30_000 })
  return { ...query, channels: query.data ?? [] }
}

export function useMembers(channelId: string) {
  return useQuery({ queryKey: keys.members(channelId), queryFn: () => api.channels.members(channelId), staleTime: 30_000 })
}

/** What this server can do: AI summaries, push, call servers. Loaded once. */
export function useConfig() {
  return useQuery({ queryKey: keys.config, queryFn: api.config, staleTime: Infinity, retry: 1 }).data
}

/** Your saved messages, and a quick "is this one saved?" set. */
export function useBookmarks() {
  const query = useQuery({ queryKey: keys.bookmarks, queryFn: api.bookmarks, staleTime: 60_000 })
  const ids = useMemo(() => new Set((query.data ?? []).map((b) => b.message.id)), [query.data])
  return { ...query, saved: query.data ?? [], ids }
}

export function useScheduled() {
  return useQuery({ queryKey: keys.scheduled, queryFn: api.scheduled.list, staleTime: 60_000 })
}

/** Channels by name, so "#design" in a message can become a link. */
export function useChannelNames() {
  const { channels } = useChannels()
  return useMemo(() => new Map(channels.filter((c) => c.kind !== "dm").map((c) => [c.name, c.id])), [channels])
}

export const channelTitle = (channel: Channel, users: Map<string, User>, meId: string) => {
  if (channel.kind !== "dm") return channel.name
  const other = channel.dmUserId ? users.get(channel.dmUserId) : undefined
  if (!other) return "Direct message"
  return other.id === meId ? `${other.name} (you)` : other.name
}

// ---- writing into the cache ----------------------------------------------------------

/** Adds or replaces a message in every loaded view of its channel (or in its thread). */
export function putMessage(qc: QueryClient, message: Message) {
  if (message.threadRootId) {
    qc.setQueryData<Thread>(keys.thread(message.threadRootId), (thread) => {
      if (!thread) return thread
      const exists = thread.replies.some((m) => m.id === message.id)
      const replies = exists
        ? thread.replies.map((m) => (m.id === message.id ? message : m))
        : [...thread.replies, message].sort((a, b) => (a.id < b.id ? -1 : 1))
      return { ...thread, replies }
    })
    return
  }
  // A thread's first message also shows at the top of the open thread.
  qc.setQueryData<Thread>(keys.thread(message.id), (thread) => (thread ? { ...thread, root: message } : thread))
  qc.setQueryData<SavedMessage[]>(keys.bookmarks, (list) => list?.map((b) => (b.message.id === message.id ? { ...b, message } : b)))
  if (message.pinnedAt !== undefined) {
    qc.setQueryData<Message[]>(keys.pins(message.channelId), (pins) => {
      if (!pins) return pins
      const rest = pins.filter((m) => m.id !== message.id)
      return message.pinnedAt && !message.deletedAt ? [message, ...rest] : rest
    })
  }
  qc.setQueriesData<MessagesData>({ queryKey: keys.messagesOf(message.channelId) }, (data) => {
    if (!data || data.pages.length === 0) return data
    let found = false
    const pages = data.pages.map((page) => {
      if (!page.messages.some((m) => m.id === message.id)) return page
      found = true
      return { ...page, messages: page.messages.map((m) => (m.id === message.id ? message : m)) }
    })
    if (found) return { ...data, pages }
    // New message: add it to the newest page, unless that view is anchored in the past.
    const newest = pages[0]!
    if (newest.hasMoreAfter) return data
    const messages = [...newest.messages, message].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return { ...data, pages: [{ ...newest, messages }, ...pages.slice(1)] }
  })
}

export function newestMessageId(qc: QueryClient, channelId: string): string | null {
  const data = qc.getQueryData<MessagesData>(keys.messages(channelId))
  const newest = data?.pages[0]
  return newest?.messages.at(-1)?.id ?? null
}

export function patchChannel(qc: QueryClient, id: string, fn: (c: Channel) => Channel) {
  qc.setQueryData<Channel[]>(keys.channels, (list) => list?.map((c) => (c.id === id ? fn(c) : c)))
  qc.setQueryData<Channel>(keys.channel(id), (c) => (c ? fn(c) : c))
}

export function upsertChannel(qc: QueryClient, channel: Channel) {
  qc.setQueryData<Channel[]>(keys.channels, (list) => {
    if (!list) return list
    return list.some((c) => c.id === channel.id) ? list.map((c) => (c.id === channel.id ? channel : c)) : [...list, channel]
  })
  qc.setQueryData(keys.channel(channel.id), channel)
}

export function removeChannel(qc: QueryClient, id: string) {
  qc.setQueryData<Channel[]>(keys.channels, (list) => list?.filter((c) => c.id !== id))
  qc.removeQueries({ queryKey: keys.channel(id) })
  qc.removeQueries({ queryKey: keys.messagesOf(id) })
}

export function patchUser(qc: QueryClient, id: string, fn: (u: User) => User) {
  qc.setQueryData<User[]>(keys.users, (list) => list?.map((u) => (u.id === id ? fn(u) : u)))
}

export function upsertUser(qc: QueryClient, user: User) {
  qc.setQueryData<User[]>(keys.users, (list) => {
    if (!list) return list
    const next = list.some((u) => u.id === user.id) ? list.map((u) => (u.id === user.id ? user : u)) : [...list, user]
    return next.sort((a, b) => a.name.localeCompare(b.name))
  })
}

export function patchMemberRead(qc: QueryClient, channelId: string, userId: string, messageId: string) {
  qc.setQueryData<Member[]>(keys.members(channelId), (list) =>
    list?.map((m) => (m.userId === userId && (!m.lastReadId || m.lastReadId < messageId) ? { ...m, lastReadId: messageId } : m)),
  )
}
