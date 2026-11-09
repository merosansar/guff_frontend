import { useEffect, useMemo, useState } from "react"
import { Link, NavLink } from "react-router-dom"
import {
  Archive,
  Bell,
  BellOff,
  BellRing,
  Bookmark,
  Check,
  Clock,
  Compass,
  Hash,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Search,
  Smile,
  Sun,
  UserRound,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { Avatar, TypingDots } from "@/components/common"
import { DND_OPTIONS, ScheduledDialog, StatusDialog, StatusEmoji, usePauseNotifications } from "@/components/extras"
import { Wordmark } from "@/components/logo"
import { useTheme, type Theme } from "@/components/theme-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { channelTitle, useChannels, useConfig, useUsers } from "@/features/data"
import { disableNotifications, enableNotifications, notificationsSupported, notificationsWanted } from "@/features/notify"
import { disablePush, enablePush, pushSupported } from "@/features/push"
import { useMe, useSession } from "@/features/session"
import { useAllTyping } from "@/lib/stores"
import type { Channel } from "@/lib/types"
import { cn } from "@/lib/utils"
import { WORKSPACE_NAME } from "@/lib/config"
import { CreateChannelDialog, NewMessageDialog, ProfileDialog } from "./dialogs"
import { openCommandPalette } from "./command-palette"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

export function Sidebar({ className }: { className?: string }) {
  const me = useMe()
  const { channels } = useChannels()
  const { byId } = useUsers()
  const typing = useAllTyping()
  const [creating, setCreating] = useState(false)
  const [messaging, setMessaging] = useState(false)

  const { rooms, dms } = useMemo(() => {
    // Archived channels sink to the bottom.
    const rooms = channels
      .filter((c) => c.kind !== "dm")
      .sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || a.name.localeCompare(b.name))
    const dms = channels
      .filter((c) => c.kind === "dm")
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
    return { rooms, dms }
  }, [channels])

  // "(3) Guff": mentions plus unread DMs, like the badge on a phone.
  useEffect(() => {
    const count = channels.reduce((n, c) => n + (c.kind === "dm" ? c.unread : c.mentions), 0)
    document.title = count > 0 ? `(${count}) Guff` : "Guff"
  }, [channels])

  const typingIn = (c: Channel) => (typing[c.id] ?? []).filter((id) => id !== me.id)

  return (
    <nav aria-label="Conversations" className={cn("flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground", className)}>
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <Link to="/" className="rounded-md focus-visible:ring-2 focus-visible:ring-marigold focus-visible:outline-none">
          <Wordmark className="text-white" />
        </Link>
        <span className="truncate text-sm text-sidebar-muted" title="Workspace">
          {WORKSPACE_NAME}
        </span>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-sidebar-border bg-white/[0.04] px-2.5 text-left text-sm text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-marigold focus-visible:outline-none"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="flex-1">Search or jump to</span>
          <kbd className="hidden rounded border border-sidebar-border px-1.5 text-[11px] md:inline">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
      </div>

      <div className="mt-2 space-y-px px-2">
        <SideLink to="/browse" icon={Compass}>
          Browse channels
        </SideLink>
        <SideLink to="/people" icon={Users}>
          People
        </SideLink>
        <SideLink to="/saved" icon={Bookmark}>
          Saved for later
        </SideLink>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-color:var(--sidebar-active)_transparent]">
        <Section
          title="Channels"
          action={
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <SectionButton label="Add a channel" />
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">Add a channel</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => setCreating(true)}>
                  <Plus /> Create a channel
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/browse">
                    <Compass /> Browse channels
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        >
          {rooms.map((c) => (
            <ConversationLink key={c.id} channel={c} typing={typingIn(c).length > 0}>
              {c.archivedAt ? (
                <Archive className="size-3.5 shrink-0 opacity-70" aria-label="Archived" />
              ) : c.kind === "private" ? (
                <Lock className="size-3.5 shrink-0 opacity-70" aria-label="Private" />
              ) : (
                <Hash className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
              )}
              <span className="truncate">{c.name}</span>
              {c.notify === "mute" && <BellOff className="size-3 shrink-0 opacity-60" aria-label="Muted" />}
            </ConversationLink>
          ))}
        </Section>

        <Section
          title="Direct messages"
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <SectionButton label="New message" onClick={() => setMessaging(true)} />
              </TooltipTrigger>
              <TooltipContent side="right">New message</TooltipContent>
            </Tooltip>
          }
        >
          {dms.map((c) => {
            const other = c.dmUserId ? byId.get(c.dmUserId) : undefined
            return (
              <ConversationLink key={c.id} channel={c} typing={typingIn(c).length > 0} dm status={other?.id === me.id ? undefined : other?.status}>
                {other ? (
                  <Avatar name={other.name} color={other.color} size="xs" status={other.status} ringClass="ring-sidebar" statusDecorative />
                ) : (
                  <UserRound className="size-4" aria-hidden="true" />
                )}
                <span className="truncate">{channelTitle(c, byId, me.id)}</span>
                {other && other.id !== me.id && <StatusEmoji status={other.customStatus} />}
                {c.notify === "mute" && <BellOff className="size-3 shrink-0 opacity-60" aria-label="Muted" />}
              </ConversationLink>
            )
          })}
          {dms.length === 0 && (
            <button
              type="button"
              onClick={() => setMessaging(true)}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-sidebar-muted hover:bg-sidebar-hover"
            >
              Message someone
            </button>
          )}
        </Section>
      </div>

      <MeMenu />
      <CreateChannelDialog open={creating} onOpenChange={setCreating} />
      <NewMessageDialog open={messaging} onOpenChange={setMessaging} />
    </nav>
  )
}

function SideLink({ to, icon: Icon, children }: { to: string; icon: typeof Hash; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-marigold focus-visible:outline-none",
          isActive && "bg-sidebar-active text-white",
        )
      }
    >
      <Icon className="size-4" aria-hidden="true" />
      {children}
    </NavLink>
  )
}

function Section({ title, action, children }: { title: string; action: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-3 first:mt-0">
      <div className="flex items-center justify-between px-2 pb-1">
        <h2 className="text-[13px] font-semibold text-sidebar-muted">{title}</h2>
        {action}
      </div>
      <div className="space-y-px">{children}</div>
    </section>
  )
}

function SectionButton({ label, ...props }: { label: string } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid size-6 place-items-center rounded text-sidebar-muted hover:bg-sidebar-hover hover:text-white focus-visible:ring-2 focus-visible:ring-marigold focus-visible:outline-none"
      {...props}
    >
      <Plus className="size-4" aria-hidden="true" />
    </button>
  )
}

function ConversationLink({
  channel,
  typing,
  dm = false,
  status,
  children,
}: {
  channel: Channel
  typing: boolean
  dm?: boolean
  status?: "online" | "away" | "offline"
  children: React.ReactNode
}) {
  // Muted conversations don't shout: no bold, only a mention badge.
  const unread = channel.unread > 0 && channel.notify !== "mute"
  // In channels, only mentions earn a badge; every unread DM is for you, so it shows the count.
  const badge = dm && channel.notify !== "mute" ? channel.unread : channel.mentions
  const label = [
    status,
    unread && `${channel.unread >= 100 ? "99+" : channel.unread} unread`,
    channel.mentions > 0 && `${channel.mentions} mention${channel.mentions === 1 ? "" : "s"}`,
    typing && "someone is typing",
  ]
    .filter(Boolean)
    .join(", ")
  return (
    <NavLink
      to={`/c/${channel.id}`}
      className={({ isActive }) =>
        cn(
          "group flex h-8 items-center gap-2 rounded-md px-2 text-[14.5px] transition-colors hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-marigold focus-visible:outline-none",
          unread ? "font-semibold text-white" : "text-sidebar-muted hover:text-sidebar-foreground",
          isActive && "bg-sidebar-active text-white",
        )
      }
    >
      {children}
      {label && <span className="sr-only">, {label}</span>}
      <span className="ml-auto flex items-center gap-1.5 pl-1">
        {typing && <TypingDots />}
        {badge > 0 && (
          <span className="min-w-5 rounded-full bg-marigold px-1.5 text-center text-[11px] leading-5 font-bold text-marigold-foreground">
            {badge >= 100 ? "99+" : badge}
          </span>
        )}
      </span>
    </NavLink>
  )
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match my device", icon: Monitor },
]

function MeMenu() {
  const me = useMe()
  const { byId } = useUsers()
  const { logout } = useSession()
  const { theme, setTheme } = useTheme()
  const config = useConfig()
  const [profileOpen, setProfileOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [scheduledOpen, setScheduledOpen] = useState(false)
  const [notifyOn, setNotifyOn] = useState(notificationsWanted)
  const pause = usePauseNotifications()
  const self = byId.get(me.id)
  const dnd = !!self?.dndUntil && new Date(self.dndUntil).getTime() > Date.now()

  const toggleNotifications = async () => {
    if (notifyOn) {
      disableNotifications()
      await disablePush().catch(() => {})
      setNotifyOn(false)
      toast("Notifications are off")
      return
    }
    const on = await enableNotifications()
    setNotifyOn(on)
    if (!on) return void toast.error("Notifications are blocked in this browser. Allow them in the site settings first.")
    // Push reaches you even when no Guff tab is open.
    const push = config?.pushKey && pushSupported() ? await enablePush(config.pushKey).catch(() => false) : false
    toast.success(push ? "You’ll be notified about DMs and mentions, even when Guff is closed" : "You’ll be notified about DMs and mentions while Guff is in the background")
  }

  return (
    <div className="border-t border-sidebar-border p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Your profile and settings"
            className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-marigold focus-visible:outline-none"
          >
            <Avatar name={me.name} color={me.color} size="sm" status={self?.status ?? "online"} ringClass="ring-sidebar" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 truncate text-sm font-semibold text-white">
                <span className="truncate">{me.name}</span>
                <StatusEmoji status={self?.customStatus} />
              </span>
              <span className="block truncate text-xs text-sidebar-muted">
                {dnd ? "Notifications paused" : self?.customStatus?.text || me.title || me.email}
              </span>
            </span>
            {dnd && <BellOff className="size-4 shrink-0 text-sidebar-muted" aria-label="Notifications paused" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <span className="block font-semibold">{me.name}</span>
            <span className="block text-xs text-muted-foreground">{me.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setStatusOpen(true)}>
            <Smile /> {self?.customStatus ? "Change status" : "Set a status"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <UserRound /> Edit profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setScheduledOpen(true)}>
            <Clock /> Scheduled messages and reminders
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {notificationsSupported() && (
            <DropdownMenuItem onSelect={() => void toggleNotifications()}>
              {notifyOn ? <BellOff /> : <Bell />}
              {notifyOn ? "Turn off notifications" : "Turn on notifications"}
            </DropdownMenuItem>
          )}
          {dnd ? (
            <DropdownMenuItem onSelect={() => void pause(null)}>
              <BellRing /> Resume notifications
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Pause notifications</DropdownMenuLabel>
              {DND_OPTIONS.map((o) => (
                <DropdownMenuItem key={o.label} onSelect={() => void pause(o.until())}>
                  <BellOff /> {o.label}
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
          {THEMES.map((t) => (
            <DropdownMenuItem key={t.value} onSelect={() => setTheme(t.value)}>
              <t.icon /> {t.label}
              {theme === t.value && <Check className="ml-auto" aria-label="Selected" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void logout()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} />
      <ScheduledDialog open={scheduledOpen} onOpenChange={setScheduledOpen} />
    </div>
  )
}
