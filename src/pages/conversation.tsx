import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Hash, Info, Loader2, Lock, LogOut, Pencil, UserPlus, X } from "lucide-react"
import { toast } from "sonner"
import { Avatar, ErrorState, PresenceDot, Spinner, TypingDots } from "@/components/common"
import { Composer, type ComposerHandle } from "@/components/composer"
import { AddPeopleDialog, useOpenDm } from "@/components/dialogs"
import { MessageList } from "@/components/message-list"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { type MessagesData, channelTitle, keys, removeChannel, upsertChannel, useChannels, useMembers, useUsers } from "@/features/data"
import { useMe } from "@/features/session"
import { api } from "@/lib/api"
import { firstName, formatDay, lastSeen, listNames } from "@/lib/format"
import { useTyping } from "@/lib/stores"
import type { Channel, Message } from "@/lib/types"
import { cn } from "@/lib/utils"

const LAST_CHANNEL = "guff-last-channel"
const DETAILS_OPEN = "guff-details-open"

export default function ConversationPage() {
  const { channelId = "" } = useParams()
  const [search] = useSearchParams()
  const anchor = search.get("m")
  const { channels, isPending: listPending } = useChannels()
  const fromList = channels.find((c) => c.id === channelId)

  // Channels you're in come from the sidebar list; a public one you're only previewing is fetched.
  const preview = useQuery({
    queryKey: keys.channel(channelId),
    queryFn: () => api.channels.get(channelId),
    enabled: !listPending && !fromList,
    retry: false,
  })
  const channel = fromList ?? preview.data

  useEffect(() => {
    if (!fromList) return
    try {
      localStorage.setItem(LAST_CHANNEL, channelId)
    } catch {
      /* storage blocked */
    }
  }, [fromList, channelId])

  if (!channel) {
    if (preview.isError) {
      return (
        <div className="flex flex-1 flex-col">
          <MobileBack />
          <ErrorState error={preview.error} className="flex-1 justify-center" />
        </div>
      )
    }
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    )
  }
  return <Conversation key={channel.id} channel={channel} anchor={anchor} />
}

function MobileBack() {
  return (
    <Link to="/" className="m-2 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent md:hidden">
      <ArrowLeft className="size-4" /> Conversations
    </Link>
  )
}

function readDetailsOpen() {
  try {
    return localStorage.getItem(DETAILS_OPEN) === "1"
  } catch {
    return false
  }
}

function Conversation({ channel, anchor }: { channel: Channel; anchor: string | null }) {
  const qc = useQueryClient()
  const me = useMe()
  const { byId } = useUsers()
  const composer = useRef<ComposerHandle>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [details, setDetails] = useState(readDetailsOpen)
  const [mobileDetails, setMobileDetails] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [joining, setJoining] = useState(false)
  // Where you'd read up to when you opened it: the "New" line goes after this.
  const [dividerAfterId] = useState(() => (channel.unread > 0 ? channel.lastReadId : null))

  const title = channelTitle(channel, byId, me.id)
  const other = channel.kind === "dm" && channel.dmUserId ? byId.get(channel.dmUserId) : undefined
  const typing = useTyping(channel.id).filter((id) => id !== me.id)
  const typingNames = typing.map((id) => firstName(byId.get(id)?.name ?? "Someone"))

  const toggleDetails = () => {
    if (window.matchMedia("(min-width: 1280px)").matches) {
      setDetails((open) => {
        try {
          localStorage.setItem(DETAILS_OPEN, open ? "0" : "1")
        } catch {
          /* storage blocked */
        }
        return !open
      })
    } else setMobileDetails(true)
  }

  const editLast = () => {
    const data = qc.getQueryData<MessagesData>(keys.messages(channel.id, anchor))
    const all = data ? data.pages.toReversed().flatMap((p) => p.messages) : []
    const last = [...all].reverse().find((m) => m.authorId === me.id && m.kind === "user" && !m.deletedAt)
    if (last) setEditingId(last.id)
  }

  const join = async () => {
    setJoining(true)
    try {
      upsertChannel(qc, await api.channels.join(channel.id))
      toast.success(`Joined #${channel.name}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setJoining(false)
    }
  }

  const placeholder = channel.kind === "dm" ? `Message ${other?.id === me.id ? "yourself" : other?.name ?? ""}` : `Message #${channel.name}`

  return (
    <div className="flex min-h-0 flex-1">
      <section
        aria-label={title}
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (!channel.joined || !e.dataTransfer.types.includes("Files")) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDragging(false)
        }}
        onDrop={(e) => {
          if (!channel.joined) return
          e.preventDefault()
          setDragging(false)
          composer.current?.addFiles([...e.dataTransfer.files])
        }}
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
          <Link to="/" className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent md:hidden" aria-label="Back to conversations">
            <ArrowLeft className="size-5" />
          </Link>
          <button type="button" onClick={toggleDetails} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent">
            {channel.kind === "dm" ? (
              other && <Avatar name={other.name} color={other.color} size="sm" status={other.status} />
            ) : channel.kind === "private" ? (
              <Lock className="size-4 shrink-0 text-muted-foreground" aria-label="Private channel" />
            ) : (
              <Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-[17px] leading-tight font-bold">{title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {channel.kind === "dm"
                  ? other && other.id !== me.id
                    ? other.status === "offline"
                      ? lastSeen(other.lastSeenAt)
                      : other.status === "away"
                        ? "Away"
                        : other.title || "Online"
                    : "Only you can see this"
                  : channel.topic || `${channel.memberCount} ${channel.memberCount === 1 ? "member" : "members"}`}
              </span>
            </span>
          </button>
          {channel.kind !== "dm" && <MemberStack channel={channel} onClick={toggleDetails} />}
          <Button variant="ghost" size="icon" onClick={toggleDetails} aria-label="Conversation details" aria-pressed={details} className="text-muted-foreground">
            <Info className="size-5" />
          </Button>
        </header>

        <MessageList
          channel={channel}
          anchor={anchor}
          dividerAfterId={dividerAfterId}
          canInteract={channel.joined}
          editingId={editingId}
          setEditingId={setEditingId}
          onReply={(m) => {
            setReplyTo(m)
            composer.current?.focus()
          }}
        />

        <div className="h-6 shrink-0 px-4 text-xs text-muted-foreground sm:px-5" aria-live="polite">
          {typingNames.length > 0 && (
            <span className="flex items-center gap-2">
              <TypingDots />
              <span>
                <strong className="text-foreground">{listNames(typingNames)}</strong> {typingNames.length === 1 ? "is" : "are"} typing
              </span>
            </span>
          )}
        </div>

        {channel.joined ? (
          <Composer
            ref={composer}
            channel={channel}
            placeholder={placeholder}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onEditLast={editLast}
          />
        ) : (
          <div className="mx-3 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 sm:mx-5">
            <p className="text-sm">
              You’re looking at <strong>#{channel.name}</strong>. Join to send messages and get notified.
            </p>
            <Button onClick={() => void join()} disabled={joining}>
              {joining && <Loader2 className="animate-spin" />}
              Join #{channel.name}
            </Button>
          </div>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/85">
            <p className="text-lg font-semibold text-primary">Drop files to share them in {channel.kind === "dm" ? "this conversation" : `#${channel.name}`}</p>
          </div>
        )}
      </section>

      {details && (
        <aside className="hidden w-80 shrink-0 flex-col border-l xl:flex" aria-label="Details">
          <div className="flex h-14 items-center justify-between border-b px-4">
            <h2 className="font-bold">Details</h2>
            <Button variant="ghost" size="icon" onClick={toggleDetails} aria-label="Close details">
              <X className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Details channel={channel} />
          </div>
        </aside>
      )}

      <Sheet open={mobileDetails} onOpenChange={setMobileDetails}>
        <SheetContent side="right" className="w-[min(92vw,22rem)] overflow-y-auto p-0">
          <SheetHeader className="border-b">
            <SheetTitle>Details</SheetTitle>
            <SheetDescription className="sr-only">About this conversation and who’s in it</SheetDescription>
          </SheetHeader>
          <Details channel={channel} />
        </SheetContent>
      </Sheet>
    </div>
  )
}

function MemberStack({ channel, onClick }: { channel: Channel; onClick: () => void }) {
  const members = useMembers(channel.id)
  const { byId } = useUsers()
  const people = (members.data ?? []).map((m) => byId.get(m.userId)).filter(Boolean).slice(0, 3)
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent sm:flex"
      aria-label={`${channel.memberCount} members`}
    >
      <span className="flex -space-x-2">
        {people.map((p) => (
          <Avatar key={p!.id} name={p!.name} color={p!.color} size="sm" className="rounded-md ring-2 ring-background" />
        ))}
      </span>
      <span className="tabular-nums">{channel.memberCount}</span>
    </button>
  )
}

function Details({ channel }: { channel: Channel }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const me = useMe()
  const { byId } = useUsers()
  const members = useMembers(channel.id)
  const openDm = useOpenDm()
  const [adding, setAdding] = useState(false)
  const [editingTopic, setEditingTopic] = useState(false)
  const [topic, setTopic] = useState(channel.topic)
  const [saving, setSaving] = useState(false)

  const people = useMemo(
    () =>
      (members.data ?? [])
        .map((m) => ({ ...m, user: byId.get(m.userId) }))
        .filter((m) => m.user)
        .sort((a, b) => {
          const rank = { online: 0, away: 1, offline: 2 }
          return rank[a.user!.status] - rank[b.user!.status] || a.user!.name.localeCompare(b.user!.name)
        }),
    [members.data, byId],
  )

  if (channel.kind === "dm") {
    const other = channel.dmUserId ? byId.get(channel.dmUserId) : undefined
    if (!other) return null
    return (
      <div className="p-5">
        <Avatar name={other.name} color={other.color} size="lg" />
        <h3 className="mt-3 text-lg font-bold">{other.name}</h3>
        {other.title && <p className="text-muted-foreground">{other.title}</p>}
        <p className="mt-3 flex items-center gap-2 text-sm">
          <PresenceDot status={other.status} />
          {other.status === "online" ? "Online" : other.status === "away" ? "Away" : lastSeen(other.lastSeenAt)}
          {other.demo && <span className="text-muted-foreground">(demo teammate)</span>}
        </p>
        <a href={`mailto:${other.email}`} className="mt-1 block text-sm text-primary hover:underline">
          {other.email}
        </a>
        {other.demo && (
          <p className="mt-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {firstName(other.name)} is a demo teammate. While nobody is signed in as them, they answer DMs and @mentions with a short automatic reply.
          </p>
        )}
      </div>
    )
  }

  const saveTopic = async () => {
    setSaving(true)
    try {
      upsertChannel(qc, await api.channels.update(channel.id, { topic }))
      setEditingTopic(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const leave = async () => {
    try {
      await api.channels.leave(channel.id)
      removeChannel(qc, channel.id)
      toast(`You left #${channel.name}`)
      navigate("/", { replace: true })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const creator = byId.get(channel.createdBy)

  return (
    <div className="divide-y">
      <section className="p-5">
        <h3 className="flex items-center gap-1.5 text-lg font-bold">
          {channel.kind === "private" ? <Lock className="size-4" /> : <Hash className="size-4" />}
          {channel.name}
        </h3>
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Topic</h4>
            {channel.joined && !editingTopic && (
              <Button variant="ghost" size="sm" className="h-7 text-primary" onClick={() => setEditingTopic(true)}>
                <Pencil /> Edit
              </Button>
            )}
          </div>
          {editingTopic ? (
            <div className="mt-1.5 grid gap-2">
              <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={250} rows={3} aria-label="Topic" autoFocus />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => (setEditingTopic(false), setTopic(channel.topic))}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void saveTopic()} disabled={saving}>
                  Save topic
                </Button>
              </div>
            </div>
          ) : (
            <p className={cn("mt-1 text-sm", !channel.topic && "text-muted-foreground")}>{channel.topic || "No topic yet."}</p>
          )}
        </div>
        {creator && (
          <p className="mt-3 text-sm text-muted-foreground">
            Created by {creator.name} on {formatDay(channel.createdAt)}
          </p>
        )}
      </section>

      <section className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold">
            {channel.memberCount} {channel.memberCount === 1 ? "member" : "members"}
          </h4>
          {channel.joined && (
            <Button variant="ghost" size="sm" className="h-7 text-primary" onClick={() => setAdding(true)}>
              <UserPlus /> Add people
            </Button>
          )}
        </div>
        {members.isPending ? (
          <Spinner />
        ) : (
          <ul className="-mx-2">
            {people.map(({ user, role }) => (
              <li key={user!.id}>
                <button
                  type="button"
                  onClick={() => void openDm(user!.id)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  title={`Message ${user!.name}`}
                >
                  <Avatar name={user!.name} color={user!.color} size="sm" status={user!.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {user!.name}
                      {user!.id === me.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{user!.title}</span>
                  </span>
                  {role === "owner" && <span className="text-xs text-muted-foreground">Owner</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {channel.joined && channel.name !== "general" && (
        <section className="p-5">
          <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => void leave()}>
            <LogOut /> Leave #{channel.name}
          </Button>
        </section>
      )}
      <AddPeopleDialog channel={channel} open={adding} onOpenChange={setAdding} />
    </div>
  )
}
