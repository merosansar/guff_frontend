import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { AvatarColor } from "@/lib/types"
import { Avatar, TypingDots } from "./common"

/**
 * The sign-in page's one moment of motion: a short conversation that plays out live,
 * typing indicators and all. With reduced motion it simply shows the finished thread.
 */

interface Line {
  name: string
  color: AvatarColor
  text: string
  reaction?: { emoji: string; count: number }
}

const SCRIPT: Line[] = [
  { name: "Sita Sharma", color: "teal", text: "RC1 is ready for testing 🎉" },
  { name: "Bikash Thapa", color: "rose", text: "Payments are live on staging. Refunds work end to end ✅", reaction: { emoji: "🙌", count: 3 } },
  { name: "Nima Sherpa", color: "sky", text: "Testing on Android now. Chiya at 4?" },
  { name: "Anjali Gurung", color: "amber", text: "Only if someone brings sel roti 😄", reaction: { emoji: "😂", count: 2 } },
]

type Step = { shown: number; typing: number | null; reacted: number }

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function LivePreview({ className }: { className?: string }) {
  const [step, setStep] = useState<Step>(() =>
    reducedMotion() ? { shown: SCRIPT.length, typing: null, reacted: SCRIPT.length } : { shown: 0, typing: 0, reacted: 0 },
  )

  useEffect(() => {
    if (reducedMotion()) return
    const timers: ReturnType<typeof setTimeout>[] = []
    let t = 600
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
    const play = () => {
      SCRIPT.forEach((line, i) => {
        at(t, () => setStep((s) => ({ ...s, typing: i })))
        t += 900 + line.text.length * 22
        at(t, () => setStep((s) => ({ ...s, shown: i + 1, typing: null })))
        t += 500
        if (line.reaction) {
          at(t, () => setStep((s) => ({ ...s, reacted: i + 1 })))
          t += 400
        }
        t += 700
      })
      t += 3800
      at(t, () => {
        setStep({ shown: 0, typing: 0, reacted: 0 })
        t = 600
        play()
      })
    }
    play()
    return () => timers.forEach(clearTimeout)
  }, [])

  const typingLine = step.typing !== null ? SCRIPT[step.typing] : null

  return (
    <div className={cn("w-full max-w-md", className)} aria-hidden="true">
      <div className="rounded-xl border border-sidebar-border bg-white/[0.04] p-4 shadow-2xl shadow-black/20 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2 border-b border-sidebar-border pb-3 text-sm font-semibold text-white">
          <span className="text-sidebar-muted">#</span>yatra-launch
          <span className="ml-auto flex items-center gap-1.5 text-xs font-normal text-sidebar-muted">
            <span className="size-2 rounded-full bg-online" /> 5 here
          </span>
        </div>
        <ol className="flex min-h-[17.5rem] flex-col justify-end gap-3">
          {SCRIPT.slice(0, step.shown).map((line, i) => (
            <li key={`${line.name}-${i}`} className="flex gap-2.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300">
              <Avatar name={line.name} color={line.color} size="sm" />
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-white">{line.name}</p>
                <p className="text-[14.5px] leading-snug text-sidebar-foreground">{line.text}</p>
                {line.reaction && step.reacted > i && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-sidebar-border bg-sidebar-active px-2 py-0.5 text-xs font-semibold text-white motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-200">
                    {line.reaction.emoji} {line.reaction.count}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 flex h-5 items-center gap-2 text-xs text-sidebar-muted">
          {typingLine && (
            <>
              <TypingDots />
              <span>
                <strong className="text-sidebar-foreground">{typingLine.name.split(" ")[0]}</strong> is typing
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
