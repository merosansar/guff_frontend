import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, Hash, Lock } from "lucide-react"
import { Avatar, ErrorState, Spinner } from "@/components/common"
import { markRead } from "@/features/actions"
import { type MessagesCursor, channelTitle, keys, useChannelNames, useMembers, useUsers } from "@/features/data"
import { useMe } from "@/features/session"
import { api } from "@/lib/api"
import { formatDay, formatFull, sameDay } from "@/lib/format"
import type { MarkupContext } from "@/lib/markup"
import { usePending, viewStore } from "@/lib/stores"
import type { Channel, Message } from "@/lib/types"
import { MessageItem, PendingItem } from "./message-item"

const GROUP_GAP_MS = 5 * 60_000

export function MessageList({
  channel,
  anchor,
  dividerAfterId,
  canInteract,
  editingId,
  setEditingId,
  onReply,
}: {
  channel: Channel
  /** Open around this message (from search or a reply quote). */
  anchor: string | null
  /** Show "New" after this message: where you'd read up to when you opened the conversation. */
  dividerAfterId: string | null
  canInteract: boolean
  editingId: string | null
  setEditingId: (id: string | null) => void
  onReply: (message: Message) => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const me = useMe()
  const { byId } = useUsers()
  const channelNames = useChannelNames()
  const pending = usePending()
  const scroller = useRef<HTMLDivElement>(null)
  const topSentinel = useRef<HTMLDivElement>(null)
  const bottomSentinel = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [newBelow, setNewBelow] = useState(0)
  const dm = channel.kind === "dm"
  const members = useMembers(channel.id)

  const query = useInfiniteQuery({
    queryKey: keys.messages(channel.id, anchor),
    queryFn: ({ pageParam }) => api.channels.messages(channel.id, { ...pageParam, limit: 50 }),
    initialPageParam: (anchor ? { around: anchor } : {}) as MessagesCursor,
    getNextPageParam: (oldest) => (oldest.hasMoreBefore && oldest.messages[0] ? { before: oldest.messages[0].id } : undefined),
    getPreviousPageParam: (newest) => (newest.hasMoreAfter && newest.messages.at(-1) ? { after: newest.messages.at(-1)!.id } : undefined),
    staleTime: Infinity,
  })

  const messages = useMemo(() => (query.data ? query.data.pages.toReversed().flatMap((p) => p.messages) : []), [query.data])
  const mine = pending.filter((p) => p.channelId === channel.id)
  const newestId = messages.at(-1)?.id ?? null
  const caughtUp = !query.hasPreviousPage

  const ctx: MarkupContext = useMemo(() => ({ users: byId, meId: me.id, channels: channelNames }), [byId, me.id, channelNames])

  // ---- scrolling ------------------------------------------------------------------
  // The list is flex-direction: column-reverse, so scrollTop 0 is the bottom and older
  // pages can be added on top without the view jumping.
  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const bottom = Math.abs(el.scrollTop) < 48
    setAtBottom(bottom)
    if (bottom) setNewBelow(0)
  }, [])

  useEffect(() => {
    viewStore.set({ channelId: channel.id, atBottom: atBottom && caughtUp })
  }, [channel.id, atBottom, caughtUp])
  useEffect(() => () => viewStore.set({ channelId: null, atBottom: true }), [])

  // Load older messages when the top comes into view, newer ones when the bottom does.
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          if (entry.target === topSentinel.current && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
          if (entry.target === bottomSentinel.current && query.hasPreviousPage && !query.isFetchingPreviousPage) void query.fetchPreviousPage()
        }
      },
      { root, rootMargin: "400px 0px" },
    )
    if (topSentinel.current) observer.observe(topSentinel.current)
    if (bottomSentinel.current) observer.observe(bottomSentinel.current)
    return () => observer.disconnect()
  }, [query, messages.length])

  // Count messages from others that arrive while you're scrolled up.
  const lastNewest = useRef(newestId)
  useEffect(() => {
    if (lastNewest.current && newestId && newestId > lastNewest.current && !atBottom) {
      const fresh = messages.filter((m) => m.id > lastNewest.current! && m.authorId !== me.id && m.kind === "user").length
      if (fresh) setNewBelow((n) => n + fresh)
    }
    lastNewest.current = newestId
  }, [newestId, messages, atBottom, me.id])

  // Sending a message brings you back to the bottom.
  const pendingCount = mine.length
  useLayoutEffect(() => {
    if (pendingCount > 0 && scroller.current) scroller.current.scrollTop = 0
  }, [pendingCount])

  // ---- reading -------------------------------------------------------------------
  useEffect(() => {
    if (!channel.joined || !newestId || !atBottom || !caughtUp) return
    const tryRead = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) markRead(qc, channel.id, newestId)
    }
    tryRead()
    window.addEventListener("focus", tryRead)
    document.addEventListener("visibilitychange", tryRead)
    return () => {
      window.removeEventListener("focus", tryRead)
      document.removeEventListener("visibilitychange", tryRead)
    }
  }, [qc, channel.id, channel.joined, newestId, atBottom, caughtUp])

  // ---- jumping to a message ---------------------------------------------------------
  const jumped = useRef<string | null>(null)
  useEffect(() => {
    if (!anchor || jumped.current === anchor || !query.data) return
    const el = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${anchor}"]`)
    if (!el) return
    jumped.current = anchor
    el.scrollIntoView({ block: "center" })
    el.classList.add("jump-flash")
    const t = setTimeout(() => el.classList.remove("jump-flash"), 2600)
    return () => clearTimeout(t)
  }, [anchor, query.data])

  const jumpTo = useCallback(
    (messageId: string) => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" })
        el.classList.remove("jump-flash")
        void el.offsetWidth
        el.classList.add("jump-flash")
      } else {
        navigate(`/c/${channel.id}?m=${messageId}`)
      }
    },
    [navigate, channel.id],
  )

  const toLatest = () => {
    if (anchor || query.hasPreviousPage) navigate(`/c/${channel.id}`, { replace: true })
    else scroller.current?.scrollTo({ top: 0, behavior: "smooth" })
    setNewBelow(0)
  }

  // ---- read receipts (DMs) --------------------------------------------------------------
  const theirReadId = dm ? members.data?.find((m) => m.userId !== me.id)?.lastReadId ?? null : null
  const myLastId = useMemo(() => [...messages].reverse().find((m) => m.authorId === me.id && m.kind === "user")?.id ?? null, [messages, me.id])
  const seenId = dm && theirReadId && myLastId && theirReadId >= myLastId && channel.dmUserId !== me.id ? myLastId : null

  // ---- layout ---------------------------------------------------------------------
  const firstUnreadIndex = useMemo(() => {
    if (!dividerAfterId) return -1
    return messages.findIndex((m) => m.id > dividerAfterId && m.authorId !== me.id && m.kind === "user")
  }, [messages, dividerAfterId, me.id])

  if (query.isPending) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner label="Loading messages" />
      </div>
    )
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} className="flex-1" />

  const lastMessage = messages.at(-1)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain">
        <div role="log" aria-live="polite" aria-relevant="additions" aria-label={`Messages in ${channelTitle(channel, byId, me.id)}`} className="pt-2 pb-3">
          <div ref={topSentinel} aria-hidden="true" />
          {query.isFetchingNextPage && (
            <div className="flex justify-center py-3">
              <Spinner label="Loading older messages" />
            </div>
          )}
          {!query.hasNextPage && <Beginning channel={channel} />}

          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const newDay = !prev || !sameDay(prev.createdAt, m.createdAt)
            const divider = i === firstUnreadIndex
            const grouped =
              !!prev &&
              !newDay &&
              !divider &&
              prev.kind === "user" &&
              m.kind === "user" &&
              prev.authorId === m.authorId &&
              !m.replyTo &&
              !prev.deletedAt &&
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_GAP_MS
            return (
              <Fragment key={m.id}>
                {newDay && <DayDivider iso={m.createdAt} />}
                {divider && <NewDivider />}
                <MessageItem
                  message={m}
                  author={byId.get(m.authorId)}
                  grouped={grouped}
                  ctx={ctx}
                  mine={m.authorId === me.id}
                  canInteract={canInteract}
                  mentionsMe={m.mentions.includes(me.id) && m.authorId !== me.id}
                  seen={m.id === seenId}
                  editing={editingId === m.id}
                  onStartEdit={() => setEditingId(m.id)}
                  onStopEdit={() => setEditingId(null)}
                  onReply={() => onReply(m)}
                  onJumpTo={jumpTo}
                />
              </Fragment>
            )
          })}

          {caughtUp &&
            mine.map((p, i) => {
              const prevMine = i > 0 || (lastMessage?.authorId === me.id && lastMessage.kind === "user" && sameDay(lastMessage.createdAt, p.createdAt))
              return <PendingItem key={p.clientId} pending={p} ctx={ctx} grouped={!!prevMine && !p.replyToId} author={byId.get(me.id)} />
            })}

          {query.isFetchingPreviousPage && (
            <div className="flex justify-center py-3">
              <Spinner label="Loading newer messages" />
            </div>
          )}
          <div ref={bottomSentinel} aria-hidden="true" />
        </div>
      </div>

      {(!atBottom || !caughtUp) && (
        <button
          type="button"
          onClick={toLatest}
          className="absolute right-4 bottom-3 z-10 flex items-center gap-1.5 rounded-full border bg-popover px-3 py-1.5 text-sm font-semibold shadow-md hover:bg-accent sm:right-6"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
          {newBelow > 0 ? `${newBelow} new message${newBelow === 1 ? "" : "s"}` : "Jump to latest"}
        </button>
      )}
    </div>
  )
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="relative my-3 flex items-center px-4 sm:px-5" role="separator">
      <div className="h-px flex-1 bg-border" />
      <time dateTime={iso} title={formatFull(iso)} className="mx-3 text-xs font-semibold text-muted-foreground">
        {formatDay(iso)}
      </time>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

function NewDivider() {
  return (
    <div className="relative my-2 flex items-center px-4 sm:px-5" role="separator" aria-label="New messages">
      <div className="h-px flex-1 bg-marigold" />
      <span className="ml-2 rounded-sm bg-marigold px-1.5 text-[11px] leading-4 font-bold text-marigold-foreground">New</span>
    </div>
  )
}

/** The top of the history: what this conversation is. */
function Beginning({ channel }: { channel: Channel }) {
  const me = useMe()
  const { byId } = useUsers()
  if (channel.kind === "dm") {
    const other = channel.dmUserId ? byId.get(channel.dmUserId) : undefined
    const self = other?.id === me.id
    return (
      <div className="px-4 pt-8 pb-4 sm:px-5">
        {other && <Avatar name={other.name} color={other.color} size="lg" />}
        <h2 className="mt-3 text-xl font-bold">{self ? "Your notes" : other?.name}</h2>
        <p className="mt-1 max-w-prose text-muted-foreground">
          {self ? "A private place for drafts, links and reminders. Only you can see it." : `This is the beginning of your conversation with ${other?.name ?? "them"}.`}
        </p>
      </div>
    )
  }
  const creator = byId.get(channel.createdBy)
  return (
    <div className="px-4 pt-8 pb-4 sm:px-5">
      <span className="grid size-12 place-items-center rounded-lg bg-muted text-muted-foreground">
        {channel.kind === "private" ? <Lock className="size-6" /> : <Hash className="size-6" />}
      </span>
      <h2 className="mt-3 text-xl font-bold">Welcome to #{channel.name}</h2>
      <p className="mt-1 max-w-prose text-muted-foreground">
        {creator ? `${creator.name} created this ${channel.kind === "private" ? "private channel" : "channel"} on ${formatDay(channel.createdAt)}.` : null}{" "}
        {channel.topic}
      </p>
    </div>
  )
}
