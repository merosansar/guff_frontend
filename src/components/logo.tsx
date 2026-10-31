import { cn } from "@/lib/utils"

/** A speech bubble with three dots: someone is about to say something. */
export function LogoMark({ className, onDark = true }: { className?: string; onDark?: boolean }) {
  const bubble = onDark ? "var(--marigold)" : "var(--sidebar)"
  const dots = onDark ? "var(--sidebar)" : "var(--marigold)"
  return (
    <svg viewBox="4 6 24 22" className={cn("size-7", className)} aria-hidden="true">
      <path
        d="M8.5 7.5h15A3.5 3.5 0 0 1 27 11v8a3.5 3.5 0 0 1-3.5 3.5H14l-5.2 4.1a.6.6 0 0 1-1-.5V22.4A3.5 3.5 0 0 1 5 19v-8a3.5 3.5 0 0 1 3.5-3.5Z"
        fill={bubble}
      />
      <circle cx="11" cy="15" r="1.7" fill={dots} />
      <circle cx="16" cy="15" r="1.7" fill={dots} />
      <circle cx="21" cy="15" r="1.7" fill={dots} />
    </svg>
  )
}

export function Wordmark({ className, onDark = true }: { className?: string; onDark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark onDark={onDark} />
      <span className="text-[1.35rem] leading-none font-bold tracking-tight">guff</span>
    </span>
  )
}
