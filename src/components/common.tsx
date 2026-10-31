import { AlertCircle, Loader2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AvatarColor, PresenceStatus } from "@/lib/types"
import { initials } from "@/lib/format"

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-muted-foreground", className)} aria-label={label} role="status" />
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-svh place-items-center">
      <Spinner className="size-6" />
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)} role="alert">
      <AlertCircle className="size-6 text-destructive" aria-hidden="true" />
      <p className="max-w-sm text-sm text-muted-foreground">{error instanceof Error ? error.message : "Something went wrong."}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: LucideIcon
  title: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-14 text-center", className)}>
      <Icon className="mb-1 size-7 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}

const SIZES = { xs: "size-[22px] text-[9.5px]", sm: "size-7 text-[11px]", md: "size-9 text-[13px]", lg: "size-16 text-xl" } as const

/** Initials on the person's colour, with an optional presence dot. */
export function Avatar({
  name,
  color,
  size = "md",
  status,
  ringClass = "ring-background",
  statusDecorative = false,
  className,
}: {
  name: string
  color: AvatarColor
  size?: keyof typeof SIZES
  status?: PresenceStatus
  /** The dot's ring should match whatever the avatar sits on. */
  ringClass?: string
  /** Set when the status is already spelled out in nearby text. */
  statusDecorative?: boolean
  className?: string
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn("grid place-items-center rounded-md font-bold tracking-wide text-white select-none", SIZES[size])}
        style={{ backgroundColor: `var(--avatar-${color})` }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      {status && (
        <PresenceDot
          status={status}
          decorative={statusDecorative}
          className={cn("absolute ring-2", size === "xs" ? "-right-1 -bottom-1 size-2" : "-right-0.5 -bottom-0.5", ringClass)}
        />
      )}
    </span>
  )
}

/** Online: filled green. Away: hollow amber. Offline: hollow grey. Shape differs, not just colour. */
export function PresenceDot({ status, className, decorative = false }: { status: PresenceStatus; className?: string; decorative?: boolean }) {
  const label = status === "online" ? "Online" : status === "away" ? "Away" : "Offline"
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      title={label}
      className={cn(
        "inline-block size-2.5 rounded-full",
        status === "online" && "bg-online",
        status === "away" && "border-2 border-away bg-transparent",
        status === "offline" && "border-2 border-muted-foreground/60 bg-transparent",
        className,
      )}
    />
  )
}

export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("typing-dots inline-flex items-center", className)} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}
