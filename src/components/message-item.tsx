import { memo, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Copy, CornerUpLeft, Download, FileText, Pencil, RotateCcw, SmilePlus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Avatar } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { deleteMessage, editMessage, retryMessage, toggleReaction } from "@/features/actions"
import { formatBytes, formatFull, formatTime, listNames } from "@/lib/format"
import { type MarkupContext, isJumboEmoji, renderMessageText } from "@/lib/markup"
import { type PendingMessage, removePending } from "@/lib/stores"
import { type Attachment, type Message, REACTIONS, type User } from "@/lib/types"
import { cn } from "@/lib/utils"
import { fromWire, toWire } from "./mentions"

const QUICK = ["👍", "❤️", "😂"] as const

export interface MessageItemProps {
  message: Message
  author: User | undefined
  grouped: boolean
  ctx: MarkupContext
  mine: boolean
  canInteract: boolean
  mentionsMe: boolean
  seen?: boolean
  editing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  onReply: () => void
  onJumpTo: (messageId: string) => void
}

export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  const { message, author, grouped, ctx, mine, canInteract, mentionsMe, seen, editing } = props
  const qc = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  if (message.kind === "system") return <SystemLine message={message} author={author} ctx={ctx} />

  const deleted = message.deletedAt !== null
  const name = author?.name ?? "Someone"
  const jumbo = !deleted && message.attachments.length === 0 && isJumboEmoji(message.text)

  const react = (emoji: string) => {
    setPickerOpen(false)
    toggleReaction(qc, message.id, emoji).catch((e: Error) => toast.error(e.message))
  }

  return (
    <article
      data-message-id={message.id}
      aria-label={`${name}, ${formatTime(message.createdAt)}`}
      className={cn(
        "group relative flex gap-3 px-4 py-0.5 hover:bg-accent/60 focus-within:bg-accent/60 sm:px-5",
        !grouped && "mt-2 pt-1.5",
        mentionsMe && !deleted && "border-l-[3px] border-marigold bg-mention-row pl-[13px] hover:bg-mention-row sm:pl-[17px]",
      )}
    >
      <div className="w-9 shrink-0">
        {grouped ? (
          <time
            dateTime={message.createdAt}
            title={formatFull(message.createdAt)}
            className="invisible block pt-[3px] text-right text-[11px] leading-5 text-muted-foreground tabular-nums group-hover:visible group-focus-within:visible"
          >
            {formatTime(message.createdAt).replace(/ (AM|PM)$/, "")}
          </time>
        ) : author ? (
          <Avatar name={author.name} color={author.color} className="mt-0.5" />
        ) : (
          <span className="block size-9 rounded-md bg-muted" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-bold">{name}</span>
            {message.automated && (
              <span className="rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground" title="This teammate isn’t signed in, so the demo answered for them">
                Demo auto-reply
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <time dateTime={message.createdAt} className="text-xs text-muted-foreground tabular-nums">
                  {formatTime(message.createdAt)}
                </time>
              </TooltipTrigger>
              <TooltipContent>{formatFull(message.createdAt)}</TooltipContent>
            </Tooltip>
          </div>
        )}

        {message.replyTo && !deleted && <ReplyQuote reply={message.replyTo} ctx={ctx} onJump={() => props.onJumpTo(message.replyTo!.messageId)} />}

        {deleted ? (
          <p className="text-muted-foreground italic">This message was deleted.</p>
        ) : editing ? (
          <InlineEditor
            message={message}
            ctx={ctx}
            onDone={props.onStopEdit}
            onSave={async (text) => {
              await editMessage(qc, message.id, text)
              props.onStopEdit()
            }}
          />
        ) : (
          message.text && (
            <div className={cn("message-text", jumbo && "text-4xl leading-tight")}>
              {renderMessageText(message.text, ctx)}
              {message.editedAt && (
                <span className="ml-1 text-xs text-muted-foreground" title={`Edited ${formatFull(message.editedAt)}`}>
                  (edited)
                </span>
              )}
            </div>
          )
        )}

        {!deleted && message.attachments.length > 0 && <Attachments items={message.attachments} />}

        {!deleted && message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((r) => {
              const mineToo = r.userIds.includes(ctx.meId)
              const names = r.userIds.map((id) => (id === ctx.meId ? "You" : ctx.users.get(id)?.name.split(" ")[0] ?? "Someone"))
              return (
                <Tooltip key={r.emoji}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={!canInteract}
                      onClick={() => react(r.emoji)}
                      aria-pressed={mineToo}
                      aria-label={`${r.emoji} ${r.userIds.length}, ${listNames(names)}. ${mineToo ? "Remove your reaction" : "Add yours"}`}
                      className={cn(
                        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold tabular-nums transition-colors",
                        mineToo ? "border-primary/50 bg-primary/10 text-primary" : "bg-card hover:border-foreground/30",
                      )}
                    >
                      <span className="text-sm leading-none">{r.emoji}</span>
                      {r.userIds.length}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{`${listNames(names)} reacted with ${r.emoji}`}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        )}

        {seen && <p className="mt-0.5 text-xs text-muted-foreground">Seen</p>}
      </div>

      {canInteract && !deleted && !editing && (
        <div
          className={cn(
            "absolute -top-3 right-4 z-10 hidden items-center rounded-md border bg-popover p-0.5 shadow-sm group-hover:flex group-focus-within:flex",
            pickerOpen && "flex",
          )}
          role="toolbar"
          aria-label="Message actions"
        >
          {QUICK.map((emoji) => (
            <ToolButton key={emoji} label={`React with ${emoji}`} onClick={() => react(emoji)}>
              <span className="text-base leading-none">{emoji}</span>
            </ToolButton>
          ))}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <ToolButton label="More reactions">
                <SmilePlus />
              </ToolButton>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-1.5" align="end">
              <div className="grid grid-cols-6 gap-0.5" role="group" aria-label="Reactions">
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => react(emoji)}
                    className="grid size-9 place-items-center rounded-md text-xl hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    aria-label={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <ToolButton label="Reply" onClick={props.onReply}>
            <CornerUpLeft />
          </ToolButton>
          {message.text && (
            <ToolButton
              label="Copy text"
              onClick={() => {
                void navigator.clipboard?.writeText(fromWire(message.text, ctx.users)).then(() => toast("Copied"))
              }}
            >
              <Copy />
            </ToolButton>
          )}
          {mine && (
            <>
              <ToolButton label="Edit" onClick={props.onStartEdit}>
                <Pencil />
              </ToolButton>
              <ToolButton label="Delete" onClick={() => setConfirmDelete(true)}>
                <Trash2 />
              </ToolButton>
            </>
          )}
        </div>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this message?</DialogTitle>
            <DialogDescription>Everyone will see “This message was deleted”. Attached files are removed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDelete(false)
                deleteMessage(qc, message.id).catch((e: Error) => toast.error(e.message))
              }}
            >
              Delete message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
})

function ToolButton({ label, children, ...props }: { label: string } & React.ComponentProps<"button">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="grid size-8 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none [&_svg]:size-4"
          {...props}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ReplyQuote({ reply, ctx, onJump }: { reply: NonNullable<Message["replyTo"]>; ctx: MarkupContext; onJump: () => void }) {
  const author = ctx.users.get(reply.authorId)
  return (
    <button
      type="button"
      onClick={onJump}
      className="mt-0.5 mb-1 flex max-w-full items-baseline gap-1.5 rounded-sm border-l-2 border-primary/50 py-0.5 pl-2 text-left text-sm text-muted-foreground hover:text-foreground"
      aria-label={`Replying to ${author?.name ?? "a message"}. Show the original`}
    >
      <CornerUpLeft className="size-3.5 shrink-0 self-center" aria-hidden="true" />
      <span className="shrink-0 font-semibold">{author?.name ?? "Someone"}</span>
      <span className="truncate">{reply.excerpt ? renderMessageText(reply.excerpt, ctx) : "Original message was deleted"}</span>
    </button>
  )
}

function SystemLine({ message, author, ctx }: { message: Message; author: User | undefined; ctx: MarkupContext }) {
  return (
    <div data-message-id={message.id} className="mt-1 flex gap-3 px-4 py-1 text-sm text-muted-foreground sm:px-5">
      <span className="w-9 shrink-0" />
      <p className="min-w-0">
        <span className="font-semibold text-foreground/80">{author?.name ?? "Someone"}</span> {renderMessageText(message.text, ctx)}
        <span className="ml-2 text-xs tabular-nums">{formatTime(message.createdAt)}</span>
      </p>
    </div>
  )
}

// ---- attachments -------------------------------------------------------------

function displaySize(a: Attachment) {
  const maxW = 360
  const maxH = 260
  const w = a.width ?? maxW
  const h = a.height ?? maxH
  const scale = Math.min(1, maxW / w, maxH / h)
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

export function Attachments({ items, onRemove }: { items: Attachment[]; onRemove?: (id: string) => void }) {
  const [viewing, setViewing] = useState<Attachment | null>(null)
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {items.map((a) =>
        a.contentType.startsWith("image/") ? (
          <span key={a.id} className="relative">
            <button
              type="button"
              onClick={() => setViewing(a)}
              className="block overflow-hidden rounded-md border bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={`Open image ${a.name}`}
            >
              <img src={a.url} alt={a.name} loading="lazy" decoding="async" {...displaySize(a)} className="block max-w-full object-cover" />
            </button>
            {onRemove && <RemoveButton onClick={() => onRemove(a.id)} name={a.name} />}
          </span>
        ) : (
          <span key={a.id} className="relative">
            <a
              href={a.url}
              download={a.name}
              className="flex w-64 max-w-full items-center gap-3 rounded-md border bg-card p-2.5 hover:bg-accent"
            >
              <FileText className="size-8 shrink-0 text-primary" strokeWidth={1.5} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{a.name}</span>
                <span className="block text-xs text-muted-foreground">{formatBytes(a.size)}</span>
              </span>
              <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>
            {onRemove && <RemoveButton onClick={() => onRemove(a.id)} name={a.name} />}
          </span>
        ),
      )}
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[92vh] gap-3 p-3 sm:max-w-[min(92vw,1100px)]">
          <DialogTitle className="truncate pr-8 text-sm">{viewing?.name}</DialogTitle>
          <DialogDescription className="sr-only">Full-size image</DialogDescription>
          {viewing && (
            <>
              <img src={viewing.url} alt={viewing.name} className="mx-auto max-h-[75vh] w-auto rounded" />
              <div className="flex justify-end">
                <Button variant="outline" size="sm" asChild>
                  <a href={viewing.url} download={viewing.name}>
                    <Download /> Download
                  </a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RemoveButton({ onClick, name }: { onClick: () => void; name: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Remove ${name}`}
      className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border bg-popover text-muted-foreground shadow-sm hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  )
}

// ---- editing ---------------------------------------------------------------

function InlineEditor({
  message,
  ctx,
  onSave,
  onDone,
}: {
  message: Message
  ctx: MarkupContext
  onSave: (text: string) => Promise<void>
  onDone: () => void
}) {
  const [{ text, mentions }] = useState(() => fromWireWithMentions(message.text, ctx.users))
  const [value, setValue] = useState(text)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [value])

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(toWire(value, mentions))
    } catch (e) {
      toast.error((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="mt-1 rounded-md border bg-card p-2 focus-within:ring-2 focus-within:ring-ring/40">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone()
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void save()
          }
        }}
        aria-label="Edit message"
        rows={1}
        className="block w-full resize-none bg-transparent outline-none"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">Esc to cancel, Enter to save</span>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          Save
        </Button>
      </div>
    </div>
  )
}

function fromWireWithMentions(text: string, users: Map<string, User>) {
  const mentions = new Map<string, string>()
  for (const match of text.matchAll(/<@([a-f\d]{24})>/gi)) {
    const user = users.get(match[1]!)
    if (user) mentions.set(`@${user.name}`, user.id)
  }
  return { text: fromWire(text, users), mentions }
}

// ---- a message on its way --------------------------------------------------------

export function PendingItem({ pending, ctx, grouped, author }: { pending: PendingMessage; ctx: MarkupContext; grouped: boolean; author: User | undefined }) {
  const qc = useQueryClient()
  const failed = pending.status === "failed"
  return (
    <article className={cn("relative flex gap-3 px-4 py-0.5 sm:px-5", !grouped && "mt-2 pt-1.5")} aria-label={failed ? "Message not sent" : "Sending message"}>
      <div className="w-9 shrink-0">{!grouped && author && <Avatar name={author.name} color={author.color} className="mt-0.5" />}</div>
      <div className="min-w-0 flex-1">
        {!grouped && <span className="font-bold">{author?.name}</span>}
        <div className={cn("message-text", !failed && "opacity-60")}>{renderMessageText(pending.text, ctx)}</div>
        {pending.attachments.length > 0 && <Attachments items={pending.attachments} />}
        {failed ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
            Not sent. {pending.error}
            <Button size="sm" variant="outline" className="h-7" onClick={() => retryMessage(qc, pending.clientId)}>
              <RotateCcw /> Try again
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => removePending(pending.clientId)}>
              Discard
            </Button>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Sending…</p>
        )}
      </div>
    </article>
  )
}
