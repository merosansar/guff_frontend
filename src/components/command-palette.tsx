import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Command } from "cmdk"
import { Hash, Loader2, Lock, MessageSquareText, Search } from "lucide-react"
import { Avatar } from "@/components/common"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { channelTitle, useChannels, useUsers } from "@/features/data"
import { useMe } from "@/features/session"
import { api } from "@/lib/api"
import { formatShort } from "@/lib/format"
import { plainText } from "@/lib/markup"
import { useOpenDm } from "./dialogs"

let openPalette: (() => void) | null = null
export const openCommandPalette = () => openPalette?.()

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/** Ctrl+K / ⌘K: jump to a channel or person, or search every message you can see. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const navigate = useNavigate()
  const me = useMe()
  const { channels } = useChannels()
  const { users, byId } = useUsers()
  const openDm = useOpenDm()
  const q = useDebounced(query.trim(), 250)

  useEffect(() => {
    openPalette = () => setOpen(true)
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      openPalette = null
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  const results = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: open && q.length >= 2,
    staleTime: 10_000,
  })

  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels])
  // Our own filtering, so message results (found by the server) and local matches agree on "nothing found".
  const term = query.trim().toLowerCase()
  const rooms = channels.filter((c) => c.kind !== "dm" && (!term || c.name.includes(term) || c.topic.toLowerCase().includes(term)))
  const people = users.filter((u) => !term || u.name.toLowerCase().includes(term) || u.title.toLowerCase().includes(term))
  const messages = q.length >= 2 && q === query.trim() ? (results.data ?? []) : []
  const searching = q.length >= 2 && (results.isFetching || q !== query.trim())
  const nothing = term.length > 0 && rooms.length === 0 && people.length === 0 && messages.length === 0 && !searching

  const go = (path: string) => {
    setOpen(false)
    setQuery("")
    navigate(path)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery("")
      }}
    >
      <DialogContent className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Jump to a channel or person, or search messages.</DialogDescription>
        <Command label="Search" shouldFilter={false} className="flex flex-col">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" aria-hidden="true" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search channels, people and messages"
              className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
            {results.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Searching" />}
          </div>
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            {nothing && <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing matches that. Try another word.</p>}

            {rooms.length > 0 && <Group heading="Channels">
              {rooms.map((c) => (
                <Item key={c.id} value={`channel ${c.name} ${c.topic}`} onSelect={() => go(`/c/${c.id}`)}>
                  {c.kind === "private" ? <Lock className="size-4" /> : <Hash className="size-4" />}
                  <span className="font-medium">{c.name}</span>
                  {c.topic && <span className="truncate text-muted-foreground">{c.topic}</span>}
                </Item>
              ))}
            </Group>}

            {people.length > 0 && <Group heading="People">
              {people.map((u) => (
                <Item
                  key={u.id}
                  value={`person ${u.name} ${u.title}`}
                  onSelect={() => {
                    setOpen(false)
                    setQuery("")
                    void openDm(u.id)
                  }}
                >
                  <Avatar name={u.name} color={u.color} size="xs" status={u.status} ringClass="ring-popover" />
                  <span className="font-medium">
                    {u.name}
                    {u.id === me.id && " (you)"}
                  </span>
                  <span className="truncate text-muted-foreground">{u.title}</span>
                </Item>
              ))}
            </Group>}

            {messages.length > 0 && (
              <Group heading="Messages">
                {messages.map((m) => {
                  const channel = channelById.get(m.channelId)
                  const author = byId.get(m.authorId)
                  const where = channel ? (channel.kind === "dm" ? channelTitle(channel, byId, me.id) : `#${channel.name}`) : ""
                  return (
                    <Item key={m.id} value={`message ${m.id}`} onSelect={() => go(m.threadRootId ? `/c/${m.channelId}?thread=${m.threadRootId}` : `/c/${m.channelId}?m=${m.id}`)}>
                      <MessageSquareText className="size-4 shrink-0 self-start mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">{author?.name ?? "Someone"}</span>
                          <span>{where}</span>
                          <span className="ml-auto shrink-0">{formatShort(m.createdAt)}</span>
                        </span>
                        <span className="line-clamp-2 text-sm">
                          <Highlight text={plainText(m.text, byId)} query={q} />
                        </span>
                      </span>
                    </Item>
                  )
                })}
              </Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {children}
    </Command.Group>
  )
}

function Item({ children, ...props }: React.ComponentProps<typeof Command.Item>) {
  return (
    <Command.Item
      {...props}
      className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent [&_svg]:text-muted-foreground"
    >
      {children}
    </Command.Item>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  if (words.length === 0) return <>{text}</>
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"))
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[3px] bg-marigold/40 px-0.5 text-foreground">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  )
}
