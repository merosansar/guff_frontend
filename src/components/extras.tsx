import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlarmClock, Bell, Bot, Clock, Copy, ExternalLink, Loader2, Plug, Sparkles, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Spinner } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { keys, upsertUser, useChannels, useScheduled, useUsers } from "@/features/data"
import { useMe, useSession } from "@/features/session"
import { api } from "@/lib/api"
import { formatFull, formatShort, formatTime } from "@/lib/format"
import { type MarkupContext, plainText, renderMessageText } from "@/lib/markup"
import type { Channel, LinkPreview, Message, Scheduled, Summary } from "@/lib/types"
import { cn } from "@/lib/utils"

// ---- choosing a time ----------------------------------------------------------------

/** Ready-made times: "In 1 hour", "Tomorrow at 9:00 AM" and so on. */
export function timePresets(now = new Date()): { label: string; at: Date }[] {
  const at = (h: number, m = 0, addDays = 0) => {
    const d = new Date(now)
    d.setDate(d.getDate() + addDays)
    d.setHours(h, m, 0, 0)
    return d
  }
  const list = [
    { label: "In 20 minutes", at: new Date(now.getTime() + 20 * 60_000) },
    { label: "In 1 hour", at: new Date(now.getTime() + 60 * 60_000) },
    { label: "In 3 hours", at: new Date(now.getTime() + 3 * 60 * 60_000) },
  ]
  if (now.getHours() < 16) list.push({ label: `Today at ${formatTime(at(17))}`, at: at(17) })
  list.push({ label: `Tomorrow at ${formatTime(at(9, 0, 1))}`, at: at(9, 0, 1) })
  const monday = (8 - now.getDay()) % 7 || 7
  if (monday > 1) list.push({ label: `Monday at ${formatTime(at(9, 0, monday))}`, at: at(9, 0, monday) })
  return list
}

/** For <input type="datetime-local">: local time without seconds. */
const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "When should this happen?" Presets plus a custom date and time. */
export function WhenDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  onPick: (at: Date) => Promise<void>
}) {
  const [custom, setCustom] = useState("")
  const [busy, setBusy] = useState(false)
  const presets = useMemo(() => (open ? timePresets() : []), [open])

  useEffect(() => {
    if (open) setCustom(toLocalInput(new Date(Date.now() + 2 * 60 * 60_000)))
  }, [open])

  const pick = async (at: Date) => {
    if (at.getTime() < Date.now() + 60_000) {
      toast.error("Choose a time at least a minute from now.")
      return
    }
    setBusy(true)
    try {
      await onPick(at)
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={busy}
              onClick={() => void pick(p.at)}
              className="flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60"
            >
              <span className="font-semibold">{p.label}</span>
              <span className="text-xs text-muted-foreground">{formatShort(p.at.toISOString())}</span>
            </button>
          ))}
        </div>
        <form
          className="grid gap-1.5 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (custom) void pick(new Date(custom))
          }}
        >
          <Label htmlFor="when-custom">Pick a date and time</Label>
          <div className="flex gap-2">
            <Input id="when-custom" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} required />
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---- scheduled messages and reminders --------------------------------------------------

export function ScheduledDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient()
  const { data, isPending } = useScheduled()
  const { channels } = useChannels()
  const { byId } = useUsers()
  const me = useMe()
  const where = (s: Scheduled) => {
    const c = channels.find((x) => x.id === s.channelId)
    if (!c) return "a conversation"
    if (c.kind !== "dm") return `#${c.name}`
    const other = c.dmUserId ? byId.get(c.dmUserId) : undefined
    return other?.id === me.id ? "your notes" : other?.name ?? "a direct message"
  }
  const cancel = async (s: Scheduled) => {
    try {
      await api.scheduled.cancel(s.id)
      void qc.invalidateQueries({ queryKey: keys.scheduled })
      toast(s.kind === "reminder" ? "Reminder cancelled" : "Scheduled message cancelled")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Scheduled</DialogTitle>
          <DialogDescription>Messages waiting to be sent, and reminders you’ve set.</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <Spinner className="mx-auto" />
        ) : !data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing scheduled. Use the clock next to Send, or “Remind me” on a message.</p>
        ) : (
          <ul className="-mx-2 max-h-[60vh] divide-y overflow-y-auto">
            {data.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-2 py-2.5">
                {s.kind === "reminder" ? (
                  <AlarmClock className="mt-0.5 size-4 shrink-0 text-marigold" aria-label="Reminder" />
                ) : (
                  <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-label="Scheduled message" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {formatFull(s.sendAt)} · {s.kind === "reminder" ? "remind me about a message in" : "to"} {where(s)}
                  </p>
                  {s.kind === "message" && <p className="mt-0.5 line-clamp-2 text-sm">{plainText(s.text, byId)}</p>}
                  {s.status === "failed" && (
                    <p className="mt-0.5 text-xs text-destructive" role="alert">
                      Couldn’t send: {s.error}
                    </p>
                  )}
                  {s.kind === "reminder" && s.messageId && (
                    <Link to={`/c/${s.channelId}?m=${s.messageId}`} onClick={() => onOpenChange(false)} className="text-xs text-primary hover:underline">
                      Show the message
                    </Link>
                  )}
                </div>
                {s.status !== "sending" && (
                  <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => void cancel(s)} aria-label="Cancel">
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---- edit history ---------------------------------------------------------------------

export function EditHistoryDialog({ message, ctx, open, onOpenChange }: { message: Message; ctx: MarkupContext; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["history", message.id, message.editedAt],
    queryFn: () => api.messages.history(message.id),
    enabled: open,
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit history</DialogTitle>
          <DialogDescription>Every version of this message, oldest first.</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <Spinner className="mx-auto" />
        ) : isError ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : (
          <ol className="max-h-[60vh] space-y-3 overflow-y-auto">
            {data.map((v, i) => (
              <li key={i} className={cn("rounded-md border p-3", v.current && "border-primary/40 bg-primary/5")}>
                <p className="mb-1 text-xs text-muted-foreground">
                  {v.current ? "Now" : i === 0 ? "Original" : `Version ${i + 1}`} · {formatFull(v.writtenAt)}
                </p>
                <div className="message-text text-sm">{v.text ? renderMessageText(v.text, ctx) : <em className="text-muted-foreground">No text</em>}</div>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---- link previews and reminder cards ----------------------------------------------------

export function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  const [imageOk, setImageOk] = useState(true)
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mt-1.5 flex max-w-md overflow-hidden rounded-md border-l-4 border-primary/40 bg-card shadow-xs hover:bg-accent"
    >
      <span className="min-w-0 flex-1 p-2.5">
        <span className="block truncate text-xs text-muted-foreground">{preview.siteName}</span>
        {preview.title && <span className="line-clamp-2 block text-sm font-semibold text-primary">{preview.title}</span>}
        {preview.description && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{preview.description}</span>}
      </span>
      {preview.image && imageOk && (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageOk(false)}
          className="h-auto w-24 shrink-0 object-cover sm:w-28"
        />
      )}
    </a>
  )
}

export function ReminderCard({ message, ctx }: { message: Message; ctx: MarkupContext }) {
  const ref = message.ref
  const author = ref ? ctx.users.get(ref.authorId) : undefined
  return (
    <div className="mt-0.5 max-w-md rounded-md border bg-marigold/10 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <AlarmClock className="size-4 text-marigold" aria-hidden="true" /> Reminder
      </p>
      {ref ? (
        <>
          <p className="mt-1 text-sm">
            <span className="font-semibold">{author?.name ?? "Someone"}:</span>{" "}
            {ref.excerpt ? renderMessageText(ref.excerpt, ctx) : <em className="text-muted-foreground">The message was deleted.</em>}
          </p>
          <Link to={`/c/${ref.channelId}?m=${ref.messageId}`} className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            Show the message <ExternalLink className="size-3.5" />
          </Link>
        </>
      ) : null}
    </div>
  )
}

export function WebhookBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground" title="Posted by an integration">
      <Bot className="size-3" aria-hidden="true" /> App
    </span>
  )
}

// ---- status and do not disturb ----------------------------------------------------------

const STATUS_PRESETS = [
  { emoji: "📅", text: "In a meeting", hours: 1 },
  { emoji: "🚌", text: "Commuting", hours: 0.5 },
  { emoji: "🤒", text: "Out sick", hours: 0 },
  { emoji: "🌴", text: "On leave", hours: 0 },
  { emoji: "🏡", text: "Working remotely", hours: 0 },
  { emoji: "🍜", text: "Lunch", hours: 1 },
]
const STATUS_EMOJI = ["💬", "📅", "🚌", "🤒", "🌴", "🏡", "🍜", "🎧", "✈️", "🧑‍💻", "☕", "🎯"]

const endOfToday = () => {
  const d = new Date()
  d.setHours(23, 59, 0, 0)
  return d
}

const CLEAR_OPTIONS = [
  { label: "Don’t clear", value: "never" },
  { label: "30 minutes", value: "30m" },
  { label: "1 hour", value: "1h" },
  { label: "4 hours", value: "4h" },
  { label: "Today", value: "today" },
  { label: "This week", value: "week" },
] as const
type ClearAfter = (typeof CLEAR_OPTIONS)[number]["value"]

function clearAt(value: ClearAfter): Date | null {
  const now = Date.now()
  if (value === "30m") return new Date(now + 30 * 60_000)
  if (value === "1h") return new Date(now + 60 * 60_000)
  if (value === "4h") return new Date(now + 4 * 60 * 60_000)
  if (value === "today") return endOfToday()
  if (value === "week") {
    const d = endOfToday()
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7))
    return d
  }
  return null
}

export function StatusDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient()
  const me = useMe()
  const { byId } = useUsers()
  const { updateUser } = useSession()
  const current = byId.get(me.id)?.customStatus ?? null
  const [emoji, setEmoji] = useState("💬")
  const [text, setText] = useState("")
  const [clear, setClear] = useState<ClearAfter>("today")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setEmoji(current?.emoji || "💬")
    setText(current?.text ?? "")
    setClear(current?.expiresAt ? "today" : current ? "never" : "today")
  }, [open, current])

  const save = async (status: { emoji: string; text: string; expiresAt: Date | null } | null) => {
    setBusy(true)
    try {
      const user = await api.users.updateMe({
        customStatus: status ? { emoji: status.emoji, text: status.text, expiresAt: status.expiresAt?.toISOString() ?? null } : null,
      })
      upsertUser(qc, user)
      updateUser({ ...me, customStatus: user.customStatus })
      toast.success(status ? "Status set" : "Status cleared")
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save({ emoji, text, expiresAt: clearAt(clear) })
          }}
        >
          <DialogHeader>
            <DialogTitle>Set a status</DialogTitle>
            <DialogDescription>Let your team know what you’re up to. It shows next to your name.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <select
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              aria-label="Status emoji"
              className="h-9 rounded-md border bg-background px-2 text-lg"
            >
              {STATUS_EMOJI.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={100} placeholder="What’s your status?" aria-label="Status" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_PRESETS.map((p) => (
              <button
                key={p.text}
                type="button"
                onClick={() => {
                  setEmoji(p.emoji)
                  setText(p.text)
                  setClear(p.hours === 0.5 ? "30m" : p.hours === 1 ? "1h" : "today")
                }}
                className="rounded-full border px-2.5 py-1 text-sm hover:bg-accent"
              >
                {p.emoji} {p.text}
              </button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="status-clear">Clear after</Label>
            <select
              id="status-clear"
              value={clear}
              onChange={(e) => setClear(e.target.value as ClearAfter)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {CLEAR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {current ? (
              <Button type="button" variant="ghost" onClick={() => void save(null)} disabled={busy}>
                <X /> Clear status
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={busy || (!text.trim() && !emoji)}>
              {busy && <Loader2 className="animate-spin" />}
              Save status
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "Pause notifications for 1 hour", or resume. */
export function usePauseNotifications() {
  const qc = useQueryClient()
  const me = useMe()
  const { updateUser } = useSession()
  return async (until: Date | null) => {
    try {
      const user = await api.users.updateMe({ dndUntil: until ? until.toISOString() : null })
      upsertUser(qc, user)
      updateUser({ ...me, dndUntil: user.dndUntil })
      toast(until ? `Notifications paused until ${formatTime(until)}` : "Notifications are back on", { icon: <Bell className="size-4" /> })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
}

export const DND_OPTIONS: { label: string; until: () => Date }[] = [
  { label: "For 30 minutes", until: () => new Date(Date.now() + 30 * 60_000) },
  { label: "For 1 hour", until: () => new Date(Date.now() + 60 * 60_000) },
  { label: "For 2 hours", until: () => new Date(Date.now() + 2 * 60 * 60_000) },
  {
    label: "Until tomorrow",
    until: () => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      return d
    },
  },
]

export function StatusEmoji({ status, className }: { status: { emoji: string; text: string } | null | undefined; className?: string }) {
  if (!status?.emoji) return null
  return (
    <span className={cn("shrink-0 text-[0.95em] leading-none", className)} title={status.text || undefined} role="img" aria-label={status.text || "Status"}>
      {status.emoji}
    </span>
  )
}

// ---- catch me up (AI) ---------------------------------------------------------------------

export function SummaryDialog({ channel, title, open, onOpenChange }: { channel: Channel; title: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, setState] = useState<{ loading: boolean; data: Summary | null; error: string | null }>({ loading: false, data: null, error: null })

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ loading: true, data: null, error: null })
    api.channels
      .summary(channel.id)
      .then((data) => !cancelled && setState({ loading: false, data, error: null }))
      .catch((e: Error) => !cancelled && setState({ loading: false, data: null, error: e.message }))
    return () => {
      cancelled = true
    }
  }, [open, channel.id])

  const bullets = (state.data?.summary ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-marigold" aria-hidden="true" /> Catch me up on {title}
          </DialogTitle>
          <DialogDescription>
            {state.data
              ? state.data.scope === "unread"
                ? `A summary of the ${state.data.messageCount} messages you haven’t read.`
                : `You’re up to date, so here’s the last ${state.data.messageCount} messages in short.`
              : "Reading the conversation…"}
          </DialogDescription>
        </DialogHeader>
        {state.loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Summarising
          </div>
        ) : state.error ? (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : (
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Written by AI from the messages above. Check anything important in the conversation itself.</p>
      </DialogContent>
    </Dialog>
  )
}

// ---- integrations (incoming webhooks) ------------------------------------------------------

export function WebhooksSection({ channel }: { channel: Channel }) {
  const qc = useQueryClient()
  const { byId } = useUsers()
  const { data, isPending } = useQuery({ queryKey: keys.webhooks(channel.id), queryFn: () => api.channels.webhooks(channel.id) })
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [created, setCreated] = useState<{ name: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await api.channels.createWebhook(channel.id, name)
      void qc.invalidateQueries({ queryKey: keys.webhooks(channel.id) })
      setCreated({ name: res.webhook.name, url: res.url })
      setName("")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string, hookName: string) => {
    if (!window.confirm(`Remove ${hookName}? Anything using its URL will stop working.`)) return
    try {
      await api.webhooks.remove(id)
      void qc.invalidateQueries({ queryKey: keys.webhooks(channel.id) })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const curl = created ? `curl -X POST -H "Content-Type: application/json" -d '{"text":"Hello from ${created.name} 👋"}' ${created.url}` : ""

  return (
    <section className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Plug className="size-4" aria-hidden="true" /> Integrations
        </h4>
        <Button variant="ghost" size="sm" className="h-7 text-primary" onClick={() => setCreating(true)}>
          Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Let other tools post here, like build results or alerts.</p>
      {isPending ? (
        <Spinner className="mt-2" />
      ) : (
        <ul className="mt-2 space-y-1">
          {(data ?? []).map((w) => (
            <li key={w.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
              <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{w.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  Added by {byId.get(w.createdBy)?.name ?? "someone"}
                  {w.lastUsedAt ? `, last used ${formatShort(w.lastUsedAt)}` : ", not used yet"}
                </span>
              </span>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => void remove(w.id, w.name)} aria-label={`Remove ${w.name}`}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={creating}
        onOpenChange={(o) => {
          setCreating(o)
          if (!o) setCreated(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {created ? (
            <div className="grid gap-3">
              <DialogHeader>
                <DialogTitle>{created.name} is ready</DialogTitle>
                <DialogDescription>Copy this URL now: it’s secret and won’t be shown again. Anyone with it can post in #{channel.name}.</DialogDescription>
              </DialogHeader>
              <CopyBox label="Webhook URL" value={created.url} />
              <CopyBox label="Try it from a terminal" value={curl} />
              <p className="text-xs text-muted-foreground">
                Send JSON with a <code>text</code> field (and optionally <code>username</code>). Mentions like <code>{"<@userId>"}</code> work too.
              </p>
              <DialogFooter>
                <Button onClick={() => (setCreating(false), setCreated(null))}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form className="grid gap-4" onSubmit={create}>
              <DialogHeader>
                <DialogTitle>Add an integration</DialogTitle>
                <DialogDescription>You’ll get a secret URL. Whatever is posted to it appears in #{channel.name}.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label htmlFor="hook-name">Name</Label>
                <Input id="hook-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub, Deploys, Uptime" maxLength={40} required autoFocus />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || name.trim().length < 2}>
                  {busy && <Loader2 className="animate-spin" />}
                  Create URL
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function CopyBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2 rounded-md border bg-muted/50 p-2">
        <code className="min-w-0 flex-1 text-xs break-all">{value}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void navigator.clipboard?.writeText(value).then(() => toast("Copied"))}
        >
          <Copy className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
