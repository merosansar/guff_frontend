import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { ErrorState, Spinner } from "@/components/common"
import { Composer, type ComposerHandle } from "@/components/composer"
import { Button } from "@/components/ui/button"
import { channelTitle, keys, useBookmarks, useChannelNames, useUsers } from "@/features/data"
import { useMe } from "@/features/session"
import { api } from "@/lib/api"
import type { MarkupContext } from "@/lib/markup"
import { usePending } from "@/lib/stores"
import type { Channel, Message } from "@/lib/types"
import { MessageItem, PendingItem } from "./message-item"

/** A side conversation under one message: the message itself, its replies, and a composer. */
export function ThreadPanel({ channel, rootId, canManage, onClose }: { channel: Channel; rootId: string; canManage: boolean; onClose: () => void }) {
  const me = useMe()
  const { byId } = useUsers()
  const channelNames = useChannelNames()
  const { ids: savedIds } = useBookmarks()
  const pending = usePending().filter((p) => p.threadRootId === rootId)
  const composer = useRef<ComposerHandle>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const query = useQuery({ queryKey: keys.thread(rootId), queryFn: () => api.messages.thread(rootId), staleTime: Infinity })
  const ctx: MarkupContext = useMemo(() => ({ users: byId, meId: me.id, channels: channelNames }), [byId, me.id, channelNames])

  const count = query.data?.replies.length ?? 0
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" })
  }, [count, pending.length])

  const canInteract = channel.joined && !channel.archivedAt

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="min-w-0">
          <h2 className="font-bold">Thread</h2>
          <p className="truncate text-xs text-muted-foreground">{channel.kind === "dm" ? channelTitle(channel, byId, me.id) : `#${channel.name}`}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close thread">
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2" role="log" aria-label="Thread replies">
        {query.isPending ? (
          <Spinner className="mx-auto mt-10" label="Loading thread" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <div className="pt-2">
              <MessageItem
                message={query.data.root}
                author={byId.get(query.data.root.authorId)}
                grouped={false}
                ctx={ctx}
                mine={query.data.root.authorId === me.id}
                canInteract={canInteract}
                canManage={canManage}
                saved={savedIds.has(query.data.root.id)}
                inThread
                mentionsMe={false}
                editing={editingId === query.data.root.id}
                onStartEdit={() => setEditingId(query.data.root.id)}
                onStopEdit={() => setEditingId(null)}
                onReply={() => setReplyTo(query.data.root)}
                onJumpTo={() => {}}
              />
            </div>
            <div className="my-2 flex items-center gap-3 px-4 text-xs text-muted-foreground sm:px-5">
              <span>
                {count} {count === 1 ? "reply" : "replies"}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            {query.data.replies.map((m, i) => {
              const prev = query.data.replies[i - 1]
              const grouped = !!prev && prev.authorId === m.authorId && !m.replyTo && !prev.deletedAt && !m.webhook && !prev.webhook
              return (
                <MessageItem
                  key={m.id}
                  message={m}
                  author={byId.get(m.authorId)}
                  grouped={grouped}
                  ctx={ctx}
                  mine={m.authorId === me.id}
                  canInteract={canInteract}
                  canManage={canManage}
                  saved={savedIds.has(m.id)}
                  inThread
                  mentionsMe={m.mentions.includes(me.id) && m.authorId !== me.id}
                  editing={editingId === m.id}
                  onStartEdit={() => setEditingId(m.id)}
                  onStopEdit={() => setEditingId(null)}
                  onReply={() => {
                    setReplyTo(m)
                    composer.current?.focus()
                  }}
                  onJumpTo={() => {}}
                />
              )
            })}
            {pending.map((p) => (
              <PendingItem key={p.clientId} pending={p} ctx={ctx} grouped={false} author={byId.get(me.id)} />
            ))}
          </>
        )}
        <div ref={bottom} />
      </div>

      {canInteract && query.data && !query.data.root.deletedAt ? (
        <Composer
          ref={composer}
          channel={channel}
          threadRootId={rootId}
          placeholder="Reply in thread"
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onEditLast={() => {}}
        />
      ) : null}
    </div>
  )
}
