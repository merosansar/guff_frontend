import { useState } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Check, Compass, Hash, Loader2, MessageSquare, Plus, Search, Users } from "lucide-react"
import { toast } from "sonner"
import { Avatar, EmptyState, ErrorState, Spinner } from "@/components/common"
import { CreateChannelDialog, useOpenDm } from "@/components/dialogs"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { keys, upsertChannel, useChannels, useUsers } from "@/features/data"
import { useMe } from "@/features/session"
import { api } from "@/lib/api"
import { lastSeen } from "@/lib/format"
import { useMediaQuery } from "@/lib/use-media-query"

/** Phones: the conversation list is the home screen. Larger screens: open the last conversation. */
export function HomePage() {
  const wide = useMediaQuery("(min-width: 768px)")
  const { channels, isPending } = useChannels()
  if (!wide) return <Sidebar className="flex-1" />
  if (isPending) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    )
  }
  let last: string | null = null
  try {
    last = localStorage.getItem("guff-last-channel")
  } catch {
    /* storage blocked */
  }
  const target = channels.find((c) => c.id === last) ?? channels.find((c) => c.name === "general") ?? channels[0]
  if (!target) return <EmptyState icon={Compass} title="You’re not in any conversations yet" className="flex-1 justify-center" />
  return <Navigate to={`/c/${target.id}`} replace />
}

function PageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <header className="border-b px-4 py-4 sm:px-8 sm:py-6">
      <Link to="/" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden">
        <ArrowLeft className="size-4" /> Conversations
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-muted-foreground">{description}</p>
        </div>
        {actions}
      </div>
    </header>
  )
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label} className="pl-9" />
    </div>
  )
}

export function BrowsePage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState<string | null>(null)
  const browse = useQuery({ queryKey: keys.browse(q.trim()), queryFn: () => api.channels.browse(q.trim()), placeholderData: (prev) => prev })

  const join = async (id: string, name: string) => {
    setJoining(id)
    try {
      upsertChannel(qc, await api.channels.join(id))
      void qc.invalidateQueries({ queryKey: ["browse"] })
      toast.success(`Joined #${name}`)
      navigate(`/c/${id}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setJoining(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader
        title="Browse channels"
        description="Every public channel in the workspace. Peek in before you join."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Create a channel
          </Button>
        }
      />
      <div className="px-4 py-4 sm:px-8">
        <SearchBox value={q} onChange={setQ} label="Search channels by name or topic" />
      </div>
      {browse.isPending ? (
        <Spinner className="mx-auto mt-10" />
      ) : browse.isError ? (
        <ErrorState error={browse.error} onRetry={() => void browse.refetch()} />
      ) : browse.data.length === 0 ? (
        <EmptyState icon={Hash} title="No channels match that">
          Try another word, or create the channel yourself.
        </EmptyState>
      ) : (
        <ul className="divide-y border-y sm:mx-8 sm:rounded-lg sm:border">
          {browse.data.map((c) => (
            <li key={c.id} className="flex items-center gap-4 px-4 py-3.5 hover:bg-accent/50">
              <Link to={`/c/${c.id}`} className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-semibold">
                  <Hash className="size-4 text-muted-foreground" aria-hidden="true" />
                  {c.name}
                  {c.joined && (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-semibold text-primary">
                      <Check className="size-3.5" /> Joined
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                  {c.memberCount} {c.memberCount === 1 ? "member" : "members"}
                  {c.topic && `. ${c.topic}`}
                </span>
              </Link>
              {!c.joined && (
                <Button variant="outline" size="sm" onClick={() => void join(c.id, c.name)} disabled={joining === c.id}>
                  {joining === c.id && <Loader2 className="animate-spin" />}
                  Join
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <CreateChannelDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

export function PeoplePage() {
  const me = useMe()
  const { users, isPending, isError, error, refetch } = useUsers()
  const openDm = useOpenDm()
  const [q, setQ] = useState("")
  const term = q.trim().toLowerCase()
  const shown = term ? users.filter((u) => u.name.toLowerCase().includes(term) || u.title.toLowerCase().includes(term)) : users
  const online = users.filter((u) => u.status !== "offline").length

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader title="People" description={`${users.length} people in the workspace, ${online} here right now.`} />
      <div className="px-4 py-4 sm:px-8">
        <SearchBox value={q} onChange={setQ} label="Find someone by name or role" />
      </div>
      {isPending ? (
        <Spinner className="mx-auto mt-10" />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Users} title="Nobody by that name" />
      ) : (
        <ul className="grid gap-3 px-4 pb-8 sm:grid-cols-2 sm:px-8 xl:grid-cols-3">
          {shown.map((u) => (
            <li key={u.id} className="flex items-center gap-3 rounded-lg border bg-card p-3.5">
              <Avatar name={u.name} color={u.color} size="md" status={u.status} ringClass="ring-card" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {u.name}
                  {u.id === me.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {u.customStatus ? `${u.customStatus.emoji} ${u.customStatus.text}`.trim() : u.title || u.email}
                </p>
                <p className="text-xs text-muted-foreground">
                  {u.status === "online" ? "Online" : u.status === "away" ? "Away" : lastSeen(u.lastSeenAt)}
                  {u.demo && ", demo teammate"}
                </p>
              </div>
              <Button variant="outline" size="icon" onClick={() => void openDm(u.id)} aria-label={`Message ${u.name}`} title={`Message ${u.name}`}>
                <MessageSquare className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function NotFoundPage() {
  return (
    <div className="grid min-h-svh place-items-center px-6 text-center">
      <div>
        <p className="text-5xl font-bold">404</p>
        <h1 className="mt-2 text-xl font-semibold">This page doesn’t exist</h1>
        <p className="mt-1 text-muted-foreground">The link may be old, or the conversation was removed.</p>
        <Button asChild className="mt-6">
          <Link to="/">Back to your conversations</Link>
        </Button>
      </div>
    </div>
  )
}
