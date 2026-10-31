import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Check, Loader2, Lock, Search } from "lucide-react"
import { toast } from "sonner"
import { Avatar } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { keys, upsertChannel, upsertUser, useMembers, useUsers } from "@/features/data"
import { useMe, useSession } from "@/features/session"
import { api } from "@/lib/api"
import type { Channel, User } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Same rules as the server: lower case, letters, numbers and dashes. */
export function channelSlug(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "")
}

function FieldError({ children }: { children?: string | null }) {
  if (!children) return null
  return (
    <p className="text-sm text-destructive" role="alert">
      {children}
    </p>
  )
}

// ---- choosing people -------------------------------------------------------------

function PersonPicker({
  people,
  selected,
  onToggle,
  multiple,
  emptyText = "Everyone is already here.",
}: {
  people: User[]
  selected: Set<string>
  onToggle: (id: string) => void
  multiple: boolean
  emptyText?: string
}) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const shown = q ? people.filter((p) => p.name.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)) : people
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find someone by name" className="pl-9" aria-label="Find someone" />
      </div>
      <ul className="max-h-64 overflow-y-auto rounded-md border" role={multiple ? "group" : "listbox"} aria-label="People">
        {shown.map((p) => {
          const on = selected.has(p.id)
          return (
            <li key={p.id}>
              <button
                type="button"
                role={multiple ? "checkbox" : "option"}
                aria-checked={multiple ? on : undefined}
                aria-selected={multiple ? undefined : on}
                onClick={() => onToggle(p.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <Avatar name={p.name} color={p.color} size="sm" status={p.status} ringClass="ring-card" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.title || p.email}</span>
                </span>
                {multiple && (
                  <span
                    className={cn(
                      "grid size-5 place-items-center rounded border",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                    )}
                    aria-hidden="true"
                  >
                    {on && <Check className="size-3.5" />}
                  </span>
                )}
              </button>
            </li>
          )
        })}
        {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{q ? "Nobody by that name." : emptyText}</li>}
      </ul>
    </div>
  )
}

// ---- create a channel ------------------------------------------------------------

export function CreateChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const me = useMe()
  const { users } = useUsers()
  const [name, setName] = useState("")
  const [topic, setTopic] = useState("")
  const [isPrivate, setIsPrivate] = useState(false)
  const [members, setMembers] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const slug = channelSlug(name)
  const others = useMemo(() => users.filter((u) => u.id !== me.id), [users, me.id])

  const reset = () => {
    setName("")
    setTopic("")
    setIsPrivate(false)
    setMembers(new Set())
    setError(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (slug.length < 2) return setError("Give the channel a name of at least 2 letters or numbers, like “design-team”.")
    setSaving(true)
    setError(null)
    try {
      const channel = await api.channels.create({
        name,
        topic: topic.trim() || undefined,
        kind: isPrivate ? "private" : "public",
        memberIds: [...members],
      })
      upsertChannel(qc, channel)
      void qc.invalidateQueries({ queryKey: ["browse"] })
      onOpenChange(false)
      reset()
      toast.success(`Created #${channel.name}`)
      navigate(`/c/${channel.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t create the channel.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Create a channel</DialogTitle>
            <DialogDescription>Channels work best around a topic, like a project or a team.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="channel-name">Name</Label>
            <Input id="channel-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. tihar-campaign" autoFocus maxLength={60} />
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {slug ? (
                <>
                  It will be called <strong className="text-foreground">#{slug}</strong>
                </>
              ) : (
                "Lower-case letters, numbers and dashes."
              )}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="channel-topic">
              Topic <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="channel-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What’s it about?" maxLength={250} />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="channel-private" className="flex items-center gap-1.5">
                <Lock className="size-3.5" aria-hidden="true" /> Make private
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">Only people you add can see it or find it.</p>
            </div>
            <Switch id="channel-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
          {isPrivate && (
            <div className="grid gap-1.5">
              <Label>Add people</Label>
              <PersonPicker
                people={others}
                selected={members}
                multiple
                onToggle={(id) =>
                  setMembers((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                }
              />
            </div>
          )}
          <FieldError>{error}</FieldError>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Create channel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---- start a DM ----------------------------------------------------------------

export function useOpenDm() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return async (userId: string) => {
    try {
      const channel = await api.dms.open(userId)
      upsertChannel(qc, channel)
      navigate(`/c/${channel.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t open that conversation.")
    }
  }
}

export function NewMessageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { users } = useUsers()
  const openDm = useOpenDm()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>Choose who to talk to. Pick yourself for a private notepad.</DialogDescription>
        </DialogHeader>
        <PersonPicker
          people={users}
          selected={new Set()}
          multiple={false}
          onToggle={(id) => {
            onOpenChange(false)
            void openDm(id)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

// ---- add people to a channel --------------------------------------------------------

export function AddPeopleDialog({ channel, open, onOpenChange }: { channel: Channel; open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient()
  const { users } = useUsers()
  const members = useMembers(channel.id)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const memberIds = new Set((members.data ?? []).map((m) => m.userId))
  const candidates = users.filter((u) => !memberIds.has(u.id))

  const submit = async () => {
    if (selected.size === 0) return setError("Choose at least one person.")
    setSaving(true)
    try {
      const updated = await api.channels.addMembers(channel.id, [...selected])
      upsertChannel(qc, updated)
      void qc.invalidateQueries({ queryKey: keys.members(channel.id) })
      toast.success(`Added ${selected.size === 1 ? "1 person" : `${selected.size} people`} to #${channel.name}`)
      setSelected(new Set())
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t add them.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add people to #{channel.name}</DialogTitle>
          <DialogDescription>They’ll see the channel’s history from now on.</DialogDescription>
        </DialogHeader>
        <PersonPicker
          people={candidates}
          selected={selected}
          multiple
          onToggle={(id) =>
            setSelected((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }
        />
        <FieldError>{error}</FieldError>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Add {selected.size > 0 ? selected.size : ""} {selected.size === 1 ? "person" : "people"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- your profile ------------------------------------------------------------------

export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient()
  const me = useMe()
  const { updateUser } = useSession()
  const [name, setName] = useState(me.name)
  const [title, setTitle] = useState(me.title)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const user = await api.users.updateMe({ name, title })
      upsertUser(qc, user)
      updateUser({ id: user.id, name: user.name, email: user.email, title: user.title, color: user.color, lastSeenAt: user.lastSeenAt })
      toast.success("Profile saved")
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save your profile.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (next) {
          setName(me.name)
          setTitle(me.title)
          setError(null)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>This is how your teammates see you.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar name={name || me.name} color={me.color} size="lg" />
            <p className="text-sm text-muted-foreground">{me.email}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-name">Full name</Label>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-title">What you do</Label>
            <Input id="profile-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Backend engineer" maxLength={80} />
          </div>
          <FieldError>{error}</FieldError>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Save profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
