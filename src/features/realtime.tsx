import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { closeSocket, openSocket } from "@/lib/socket"
import { connectionStore, removePending, setTyping, viewStore } from "@/lib/stores"
import type { Channel, Message, PresenceStatus, User } from "@/lib/types"
import { flushOutbox, markRead } from "./actions"
import {
  type MessagesData,
  keys,
  newestMessageId,
  patchChannel,
  patchMemberRead,
  patchUser,
  putMessage,
  removeChannel,
  upsertChannel,
  upsertUser,
} from "./data"
import { notify } from "./notify"
import { useMe, useSession } from "./session"

const plain = (text: string) =>
  text.replace(/<@[a-f\d]{24}>/gi, "@someone").replace(/[*_`]/g, "").replace(/\s+/g, " ").slice(0, 120)

/** True when this tab is showing the newest messages of this channel right now. */
const isWatching = (channelId: string) => {
  const view = viewStore.get()
  return view.channelId === channelId && view.atBottom && document.visibilityState === "visible" && document.hasFocus()
}

/** Keeps React Query's cache in step with what the server pushes. */
export function RealtimeBridge() {
  const qc = useQueryClient()
  const me = useMe()
  const { logout } = useSession()
  const navigate = useNavigate()
  const everConnected = useRef(false)
  const lost = useRef(false)
  // Kept in refs so a profile edit or a route change doesn't reopen the socket.
  const logoutRef = useRef(logout)
  const navigateRef = useRef(navigate)
  useEffect(() => {
    logoutRef.current = logout
    navigateRef.current = navigate
  })

  useEffect(() => {
    const socket = openSocket({
      onSignedOut: () => void logoutRef.current(),
      onSession: () => {},
    })

    const onNew = (message: Message) => {
      if (message.authorId === me.id && message.clientId) removePending(message.clientId)
      putMessage(qc, message)
      setTyping(message.channelId, message.authorId, false)

      const channels = qc.getQueryData<Channel[]>(keys.channels)
      const channel = channels?.find((c) => c.id === message.channelId)
      if (!channel) {
        // A new DM (or a channel someone just added us to): fetch the list again.
        void qc.invalidateQueries({ queryKey: keys.channels })
      } else {
        const fromSomeoneElse = message.authorId !== me.id && message.kind === "user"
        const mentionsMe = message.mentions.includes(me.id)
        if (fromSomeoneElse && isWatching(message.channelId)) {
          markRead(qc, message.channelId, message.id)
        } else if (fromSomeoneElse) {
          patchChannel(qc, channel.id, (c) => ({
            ...c,
            unread: Math.min(c.unread + 1, 100),
            mentions: c.mentions + (mentionsMe ? 1 : 0),
          }))
        }
        patchChannel(qc, channel.id, (c) => ({ ...c, lastMessageAt: message.kind === "user" ? message.createdAt : c.lastMessageAt }))

        if (fromSomeoneElse && (channel.kind === "dm" || mentionsMe)) {
          const author = qc.getQueryData<User[]>(keys.users)?.find((u) => u.id === message.authorId)
          const where = channel.kind === "dm" ? author?.name ?? "New message" : `${author?.name ?? "Someone"} in #${channel.name}`
          notify(where, plain(message.text) || "Sent an attachment", () => navigateRef.current(`/c/${channel.id}`))
        }
      }
    }

    const onUpdated = (message: Message) => putMessage(qc, message)

    const onTyping = (e: { channelId: string; userId: string; typing: boolean }) => {
      if (e.userId !== me.id) setTyping(e.channelId, e.userId, e.typing)
    }

    const onPresence = (e: { userId: string; status: PresenceStatus; lastSeenAt: string | null }) =>
      patchUser(qc, e.userId, (u) => ({ ...u, status: e.status, lastSeenAt: e.lastSeenAt }))

    const onRead = (e: { channelId: string; userId: string; messageId: string }) => {
      patchMemberRead(qc, e.channelId, e.userId, e.messageId)
      if (e.userId !== me.id) return
      // Read in another tab: clear the badge here too, unless newer messages arrived since.
      const newest = newestMessageId(qc, e.channelId)
      patchChannel(qc, e.channelId, (c) => {
        const lastReadId = !c.lastReadId || c.lastReadId < e.messageId ? e.messageId : c.lastReadId
        const caughtUp = !newest || newest <= lastReadId
        return caughtUp ? { ...c, lastReadId, unread: 0, mentions: 0 } : { ...c, lastReadId }
      })
      if (newest && newest > e.messageId) void qc.invalidateQueries({ queryKey: keys.channels })
    }

    const onChannel = (channel: Channel) => {
      if (channel.joined) upsertChannel(qc, channel)
      void qc.invalidateQueries({ queryKey: ["browse"] })
    }
    const onMeta = (meta: { id: string; name: string; topic: string; memberCount: number }) => {
      patchChannel(qc, meta.id, (c) => ({ ...c, ...meta }))
      void qc.invalidateQueries({ queryKey: keys.members(meta.id) })
    }
    const onRemoved = ({ channelId }: { channelId: string }) => {
      removeChannel(qc, channelId)
      if (viewStore.get().channelId === channelId) navigateRef.current("/", { replace: true })
    }
    const onUser = (user: User) => upsertUser(qc, user)

    /** After a reconnect: fetch what we missed in every open conversation, then resend the outbox. */
    const catchUp = async () => {
      void qc.invalidateQueries({ queryKey: keys.channels })
      void qc.invalidateQueries({ queryKey: keys.users })
      const views = qc.getQueriesData<MessagesData>({ queryKey: ["messages"] })
      for (const [key, data] of views) {
        const channelId = key[1] as string
        const newest = data?.pages[0]
        if (!newest || newest.hasMoreAfter) continue
        const after = newest.messages.at(-1)?.id
        if (!after) {
          void qc.invalidateQueries({ queryKey: key })
          continue
        }
        try {
          const missed = await api.channels.messages(channelId, { after, limit: 100 })
          if (missed.hasMoreAfter) void qc.invalidateQueries({ queryKey: key })
          else missed.messages.forEach((m) => putMessage(qc, m))
        } catch {
          void qc.invalidateQueries({ queryKey: key })
        }
      }
      flushOutbox(qc)
    }

    const onConnect = () => {
      if (everConnected.current) void catchUp()
      if (lost.current) {
        toast.success("Back online", { id: "connection" })
        lost.current = false
      }
      everConnected.current = true
    }

    socket.on("connect", onConnect)
    socket.on("message:new", onNew)
    socket.on("message:updated", onUpdated)
    socket.on("typing", onTyping)
    socket.on("presence", onPresence)
    socket.on("read", onRead)
    socket.on("channel:upsert", onChannel)
    socket.on("channel:meta", onMeta)
    socket.on("channel:removed", onRemoved)
    socket.on("user:upsert", onUser)

    const unsubscribe = connectionStore.subscribe(() => {
      if (connectionStore.get() === "reconnecting" && everConnected.current) lost.current = true
    })

    // Away after five minutes without a visible, focused tab.
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let idle = false
    const setIdle = (next: boolean) => {
      if (next === idle) return
      idle = next
      if (socket.connected) socket.emit("presence:idle", { idle })
    }
    const onActivity = () => {
      clearTimeout(idleTimer)
      setIdle(false)
      idleTimer = setTimeout(() => setIdle(true), 5 * 60_000)
    }
    const onVisibility = () => (document.visibilityState === "visible" ? onActivity() : undefined)
    window.addEventListener("focus", onActivity)
    window.addEventListener("pointerdown", onActivity)
    window.addEventListener("keydown", onActivity)
    document.addEventListener("visibilitychange", onVisibility)
    onActivity()

    return () => {
      unsubscribe()
      clearTimeout(idleTimer)
      window.removeEventListener("focus", onActivity)
      window.removeEventListener("pointerdown", onActivity)
      window.removeEventListener("keydown", onActivity)
      document.removeEventListener("visibilitychange", onVisibility)
      closeSocket()
    }
  }, [qc, me.id])

  return null
}
