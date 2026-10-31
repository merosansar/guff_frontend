import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CornerUpLeft, Loader2, Paperclip, SendHorizontal, X } from "lucide-react"
import { Avatar } from "@/components/common"
import { sendMessage } from "@/features/actions"
import { useUsers } from "@/features/data"
import { useMe } from "@/features/session"
import { uploadFile } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { plainText } from "@/lib/markup"
import { emitTyping } from "@/lib/socket"
import type { Attachment, Channel, Message } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Attachments } from "./message-item"
import { mentionQuery, toWire } from "./mentions"

interface Upload {
  localId: string
  file: File
  progress: number
  status: "uploading" | "done" | "error"
  attachment?: Attachment
  error?: string
  abort: AbortController
}

interface Draft {
  text: string
  mentions: Map<string, string>
}

/** Unsent text per conversation, kept while you hop between channels. */
const drafts = new Map<string, Draft>()

export interface ComposerHandle {
  addFiles: (files: File[]) => void
  focus: () => void
}

const MAX_FILES = 10

export const Composer = forwardRef<
  ComposerHandle,
  {
    channel: Channel
    placeholder: string
    replyTo: Message | null
    onCancelReply: () => void
    onEditLast: () => void
    maxUploadMb?: number
  }
>(function Composer({ channel, placeholder, replyTo, onCancelReply, onEditLast }, ref) {
  const qc = useQueryClient()
  const me = useMe()
  const { users, byId } = useUsers()
  const [text, setText] = useState(() => drafts.get(channel.id)?.text ?? "")
  const mentions = useRef<Map<string, string>>(drafts.get(channel.id)?.mentions ?? new Map())
  const [uploads, setUploads] = useState<Upload[]>([])
  const [suggest, setSuggest] = useState<{ start: number; query: string; index: number } | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const lastTypingSent = useRef(0)
  const stopTyping = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Keep the draft when leaving the conversation.
  useEffect(() => {
    const id = channel.id
    return () => {
      clearTimeout(stopTyping.current)
      if (lastTypingSent.current) emitTyping(id, false)
    }
  }, [channel.id])
  useEffect(() => {
    drafts.set(channel.id, { text, mentions: mentions.current })
  }, [channel.id, text])

  useEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  useEffect(() => {
    if (replyTo) textarea.current?.focus()
  }, [replyTo])

  const candidates = useMemo(() => {
    if (!suggest) return []
    const q = suggest.query.toLowerCase()
    return users.filter((u) => u.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(q)) || u.name.toLowerCase().startsWith(q)).slice(0, 6)
  }, [suggest, users])

  const addFiles = (files: File[]) => {
    const room = MAX_FILES - uploads.filter((u) => u.status !== "error").length
    for (const file of files.slice(0, Math.max(room, 0))) {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const abort = new AbortController()
      setUploads((list) => [...list, { localId, file, progress: 0, status: "uploading", abort }])
      uploadFile(file, (progress) => setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, progress } : u))), abort.signal)
        .then((attachment) => setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, status: "done", attachment, progress: 1 } : u))))
        .catch((error: Error) => {
          if (error.name === "AbortError") return
          setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, status: "error", error: error.message } : u)))
        })
    }
    textarea.current?.focus()
  }

  useImperativeHandle(ref, () => ({ addFiles, focus: () => textarea.current?.focus() }))

  const signalTyping = (value: string) => {
    clearTimeout(stopTyping.current)
    if (!value.trim()) {
      if (lastTypingSent.current) emitTyping(channel.id, false)
      lastTypingSent.current = 0
      return
    }
    if (Date.now() - lastTypingSent.current > 3000) {
      emitTyping(channel.id, true)
      lastTypingSent.current = Date.now()
    }
    stopTyping.current = setTimeout(() => {
      emitTyping(channel.id, false)
      lastTypingSent.current = 0
    }, 4000)
  }

  const onChange = (value: string, caret: number) => {
    setText(value)
    signalTyping(value)
    const m = mentionQuery(value, caret)
    setSuggest(m ? { ...m, index: 0 } : null)
  }

  const pickMention = (userId: string) => {
    const user = byId.get(userId)
    const el = textarea.current
    if (!user || !el || !suggest) return
    const display = `@${user.name}`
    mentions.current.set(display, user.id)
    const caret = el.selectionStart
    const next = `${text.slice(0, suggest.start)}${display} ${text.slice(caret)}`
    setText(next)
    setSuggest(null)
    requestAnimationFrame(() => {
      const pos = suggest.start + display.length + 1
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  const ready = uploads.filter((u) => u.status === "done").map((u) => u.attachment!)
  const busy = uploads.some((u) => u.status === "uploading")
  const canSend = !busy && (text.trim().length > 0 || ready.length > 0)

  const send = () => {
    if (!canSend) return
    sendMessage(qc, {
      channelId: channel.id,
      text: toWire(text.trim(), mentions.current),
      replyToId: replyTo?.id ?? null,
      attachments: ready,
    })
    setText("")
    mentions.current = new Map()
    drafts.delete(channel.id)
    setUploads([])
    setSuggest(null)
    onCancelReply()
    clearTimeout(stopTyping.current)
    emitTyping(channel.id, false)
    lastTypingSent.current = 0
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggest && candidates.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const step = e.key === "ArrowDown" ? 1 : -1
        setSuggest({ ...suggest, index: (suggest.index + step + candidates.length) % candidates.length })
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        pickMention(candidates[suggest.index]!.id)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setSuggest(null)
        return
      }
    }
    if (e.key === "Escape" && replyTo) {
      onCancelReply()
      return
    }
    if (e.key === "ArrowUp" && !text) {
      e.preventDefault()
      onEditLast()
      return
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  const replyAuthor = replyTo ? byId.get(replyTo.authorId) : undefined

  return (
    <div className="relative px-3 pb-3 sm:px-5 sm:pb-4">
      {suggest && candidates.length > 0 && (
        <ul
          role="listbox"
          aria-label="People to mention"
          className="absolute bottom-full left-3 z-20 mb-1 w-72 overflow-hidden rounded-md border bg-popover p-1 shadow-md sm:left-5"
        >
          {candidates.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === suggest.index}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickMention(u.id)
                }}
                className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm", i === suggest.index && "bg-accent")}
              >
                <Avatar name={u.name} color={u.color} size="xs" status={u.status} ringClass="ring-popover" />
                <span className="font-semibold">{u.name}</span>
                <span className="truncate text-muted-foreground">{u.id === me.id ? "you" : u.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border bg-card shadow-xs focus-within:border-ring/60 focus-within:ring-[3px] focus-within:ring-ring/15">
        {replyTo && (
          <div className="flex items-center gap-2 border-b px-3 py-1.5 text-sm">
            <CornerUpLeft className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              Replying to <strong className="text-foreground">{replyAuthor?.name ?? "a message"}</strong>: {plainText(replyTo.text, byId)}
            </span>
            <button type="button" onClick={onCancelReply} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Cancel reply">
              <X className="size-4" />
            </button>
          </div>
        )}

        {uploads.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b px-3 py-2">
            {uploads.map((u) =>
              u.status === "done" && u.attachment?.contentType.startsWith("image/") ? (
                <Attachments key={u.localId} items={[u.attachment]} onRemove={() => setUploads((list) => list.filter((x) => x.localId !== u.localId))} />
              ) : (
                <div
                  key={u.localId}
                  className={cn("relative flex w-56 items-center gap-2 rounded-md border bg-background p-2 text-sm", u.status === "error" && "border-destructive/60")}
                >
                  {u.status === "uploading" ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <Paperclip className="size-4 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{u.file.name}</span>
                    <span className={cn("block text-xs", u.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                      {u.status === "error" ? u.error : u.status === "uploading" ? `${Math.round(u.progress * 100)}% of ${formatBytes(u.file.size)}` : formatBytes(u.file.size)}
                    </span>
                    {u.status === "uploading" && (
                      <span className="mt-1 block h-1 overflow-hidden rounded bg-muted" aria-hidden="true">
                        <span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      u.abort.abort()
                      setUploads((list) => list.filter((x) => x.localId !== u.localId))
                    }}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${u.file.name}`}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ),
            )}
          </div>
        )}

        <div className="flex items-end gap-1 p-1.5">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Attach files"
            title="Attach files"
          >
            <Paperclip className="size-[18px]" />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])])
              e.target.value = ""
            }}
          />
          <textarea
            ref={textarea}
            value={text}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setSuggest(null), 100)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files]
              if (files.length) {
                e.preventDefault()
                addFiles(files)
              }
            }}
            rows={1}
            placeholder={placeholder}
            aria-label={placeholder}
            className="max-h-[220px] min-h-9 flex-1 resize-none bg-transparent px-1.5 py-[7px] leading-[22px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground transition-opacity hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
            aria-label="Send message"
            title="Send (Enter)"
          >
            <SendHorizontal className="size-[18px]" />
          </button>
        </div>
      </div>
      <p className="mt-1 hidden px-1 text-xs text-muted-foreground sm:block">
        <strong>**bold**</strong>, <em>_italic_</em>, <code className="font-mono">`code`</code>, @ to mention. Shift + Enter for a new line.
      </p>
    </div>
  )
})
