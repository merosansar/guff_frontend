import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { AlarmClock, ArrowLeft, Bookmark, BookmarkX, Clock, Hash, Lock } from "lucide-react"
import { toast } from "sonner"
import { Avatar, EmptyState, ErrorState, Spinner } from "@/components/common"
import { ScheduledDialog } from "@/components/extras"
import { Button } from "@/components/ui/button"
import { saveMessage } from "@/features/actions"
import { channelTitle, useBookmarks, useChannelNames, useChannels, useScheduled, useUsers } from "@/features/data"
import { useMe } from "@/features/session"
import { formatFull, formatShort } from "@/lib/format"
import { type MarkupContext, renderMessageText } from "@/lib/markup"
import type { Channel } from "@/lib/types"

/** Messages you saved for later, newest saved first, plus a way into what you've scheduled. */
export default function SavedPage() {
  const qc = useQueryClient()
  const me = useMe()
  const { byId } = useUsers()
  const { channels } = useChannels()
  const channelNames = useChannelNames()
  const { saved, isPending, isError, error, refetch } = useBookmarks()
  const scheduled = useScheduled()
  const [showScheduled, setShowScheduled] = useState(false)
  const ctx: MarkupContext = useMemo(() => ({ users: byId, meId: me.id, channels: channelNames }), [byId, me.id, channelNames])
  const byChannel = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels])
  const pendingCount = (scheduled.data ?? []).filter((s) => s.status !== "sent").length

  const where = (channel: Channel | undefined) =>
    !channel ? (
      "a public channel"
    ) : channel.kind === "dm" ? (
      channelTitle(channel, byId, me.id)
    ) : (
      <span className="inline-flex items-center gap-0.5">
        {channel.kind === "private" ? <Lock className="size-3" /> : <Hash className="size-3" />}
        {channel.name}
      </span>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b px-4 py-5 sm:px-8">
        <Link to="/" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden">
          <ArrowLeft className="size-4" /> Conversations
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Saved for later</h1>
            <p className="mt-1 text-muted-foreground">Messages you bookmarked. Only you can see this list.</p>
          </div>
          <Button variant="outline" onClick={() => setShowScheduled(true)}>
            <Clock /> Scheduled {pendingCount > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{pendingCount}</span>}
          </Button>
        </div>
      </header>

      {isPending ? (
        <Spinner className="mx-auto mt-10" />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : saved.length === 0 ? (
        <EmptyState icon={Bookmark} title="Nothing saved yet">
          Hover over a message and choose the bookmark to keep it here. Want a nudge later instead? Use <AlarmClock className="inline size-3.5" /> “Remind me” from the ⋯ menu.
        </EmptyState>
      ) : (
        <ul className="divide-y px-2 pb-8 sm:px-6">
          {saved.map(({ message, savedAt }) => {
            const author = byId.get(message.authorId)
            const channel = byChannel.get(message.channelId)
            const link = message.threadRootId ? `/c/${message.channelId}?thread=${message.threadRootId}` : `/c/${message.channelId}?m=${message.id}`
            return (
              <li key={message.id} className="group flex gap-3 rounded-md px-2 py-3 hover:bg-accent/50">
                {author && <Avatar name={author.name} color={author.color} />}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-bold">{message.webhook?.name ?? author?.name ?? "Someone"}</span>
                    <span className="text-xs text-muted-foreground" title={formatFull(message.createdAt)}>
                      in {where(channel)} · {formatShort(message.createdAt)}
                    </span>
                  </p>
                  <div className="message-text mt-0.5 line-clamp-4">{message.text ? renderMessageText(message.text, ctx) : message.attachments[0] ? `📎 ${message.attachments[0].name}` : ""}</div>
                  <div className="mt-1.5 flex items-center gap-3 text-xs">
                    <Link to={link} className="font-semibold text-primary hover:underline">
                      Open in conversation
                    </Link>
                    <span className="text-muted-foreground">Saved {formatShort(savedAt)}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground"
                  aria-label="Remove from saved"
                  title="Remove from saved"
                  onClick={() => saveMessage(qc, message, false).catch((e: Error) => toast.error(e.message))}
                >
                  <BookmarkX className="size-4" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <ScheduledDialog open={showScheduled} onOpenChange={setShowScheduled} />
    </div>
  )
}
