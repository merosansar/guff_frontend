import { useEffect, useRef, useState } from "react"
import { Mic, Pause, Play, SendHorizontal, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { Attachment } from "@/lib/types"
import { cn } from "@/lib/utils"

const MAX_MS = 5 * 60_000
const BARS = 48

export const voiceSupported = () =>
  typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia

/** The first recording format this browser can make (Chrome/Firefox: WebM or Ogg; Safari: MP4). */
function pickMime(): { mime: string; ext: string } {
  for (const [mime, ext] of [
    ["audio/webm;codecs=opus", "webm"],
    ["audio/webm", "webm"],
    ["audio/ogg;codecs=opus", "ogg"],
    ["audio/mp4", "m4a"],
  ] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext }
  }
  return { mime: "", ext: "webm" }
}

/** Squeezes loudness samples into a fixed number of bars, scaled 0 to 100. */
function toBars(samples: number[], count = BARS): number[] {
  if (samples.length === 0) return Array(count).fill(4)
  const peak = Math.max(...samples, 0.01)
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i / count) * samples.length)
    const to = Math.max(from + 1, Math.floor(((i + 1) / count) * samples.length))
    const slice = samples.slice(from, to)
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length
    return Math.max(4, Math.round((avg / peak) * 100))
  })
}

export const formatClock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

export interface Recording {
  file: File
  durationMs: number
  waveform: number[]
}

/**
 * Hold a conversation with your voice: records from the microphone while showing a live
 * level meter, then hands back a file with its length and waveform.
 */
export function VoiceRecorder({ onRecorded, onActiveChange }: { onRecorded: (r: Recording) => void; onActiveChange?: (active: boolean) => void }) {
  const [state, setState] = useState<"idle" | "recording">("idle")
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const session = useRef<{
    recorder: MediaRecorder
    stream: MediaStream
    audio: AudioContext
    timer: ReturnType<typeof setInterval>
    samples: number[]
    started: number
    send: boolean
  } | null>(null)

  const cleanup = () => {
    const s = session.current
    if (!s) return
    clearInterval(s.timer)
    s.stream.getTracks().forEach((t) => t.stop())
    void s.audio.close().catch(() => {})
    session.current = null
    setState("idle")
    setLevels([])
    setElapsed(0)
    onActiveChange?.(false)
  }

  useEffect(() => () => {
    if (session.current) {
      session.current.send = false
      if (session.current.recorder.state !== "inactive") session.current.recorder.stop()
      cleanup()
    }
  }, [])

  const start = async () => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      toast.error("Guff can’t use your microphone. Allow it in the browser’s site settings.")
      return
    }
    const { mime, ext } = pickMime()
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    const audio = new AudioContext()
    const analyser = audio.createAnalyser()
    analyser.fftSize = 512
    audio.createMediaStreamSource(stream).connect(analyser)
    const buffer = new Uint8Array(analyser.fftSize)
    const samples: number[] = []
    const started = Date.now()

    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(buffer)
      let sum = 0
      for (const v of buffer) sum += ((v - 128) / 128) ** 2
      const rms = Math.sqrt(sum / buffer.length)
      samples.push(rms)
      setLevels((l) => [...l.slice(-31), rms])
      const ms = Date.now() - started
      setElapsed(ms)
      if (ms >= MAX_MS) stop(true)
    }, 100)

    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    recorder.onstop = () => {
      const s = session.current
      const durationMs = Date.now() - started
      const send = s?.send ?? false
      cleanup()
      if (!send) return
      if (durationMs < 700) {
        toast("That was a bit short. Hold on a little longer next time.")
        return
      }
      const type = recorder.mimeType || mime || "audio/webm"
      const file = new File(chunks, `Voice message.${ext}`, { type })
      onRecorded({ file, durationMs, waveform: toBars(samples) })
    }
    session.current = { recorder, stream, audio, timer, samples, started, send: false }
    recorder.start(250)
    setState("recording")
    onActiveChange?.(true)
  }

  const stop = (send: boolean) => {
    const s = session.current
    if (!s) return
    s.send = send
    if (s.recorder.state !== "inactive") s.recorder.stop()
  }

  if (state === "idle") {
    return (
      <button
        type="button"
        onClick={() => void start()}
        className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Record a voice message"
        title="Record a voice message"
      >
        <Mic className="size-[18px]" />
      </button>
    )
  }

  const peak = Math.max(...levels, 0.02)
  return (
    <div className="flex min-h-9 flex-1 items-center gap-2 px-1" role="group" aria-label="Recording a voice message">
      <button
        type="button"
        onClick={() => stop(false)}
        className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
        aria-label="Discard recording"
        title="Discard"
      >
        <Trash2 className="size-[18px]" />
      </button>
      <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
      <span className="w-11 shrink-0 text-sm tabular-nums" aria-live="off">
        {formatClock(elapsed)}
      </span>
      <span className="flex h-7 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden="true">
        {levels.map((l, i) => (
          <span key={i} className="w-[3px] shrink-0 rounded-full bg-primary/70" style={{ height: `${Math.max(12, (l / peak) * 100)}%` }} />
        ))}
      </span>
      <button
        type="button"
        onClick={() => stop(true)}
        className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        aria-label="Send voice message"
        title="Send"
      >
        <SendHorizontal className="size-[18px]" />
      </button>
    </div>
  )
}

/** Plays a voice message, with the waveform doubling as the progress bar. */
export function VoicePlayer({ attachment, className }: { attachment: Attachment; className?: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [failed, setFailed] = useState(false)
  const duration = attachment.durationMs ?? 0
  const bars = attachment.waveform?.length ? attachment.waveform : Array(BARS).fill(30)
  const progress = duration > 0 ? Math.min(position / duration, 1) : 0

  const toggle = () => {
    const el = audio.current
    if (!el) return
    if (el.paused) void el.play().catch(() => setFailed(true))
    else el.pause()
  }

  const seek = (fraction: number) => {
    const el = audio.current
    if (!el || !duration) return
    el.currentTime = (fraction * duration) / 1000
    setPosition(fraction * duration)
  }

  return (
    <div className={cn("flex w-72 max-w-full items-center gap-2.5 rounded-full border bg-card py-1.5 pr-4 pl-1.5", className)}>
      <audio
        ref={audio}
        src={attachment.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setPosition(0)
        }}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime * 1000)}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={failed}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
        aria-label={playing ? "Pause voice message" : "Play voice message"}
      >
        {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="ml-0.5 size-4" fill="currentColor" />}
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Position in voice message"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(position / 1000)}
        aria-valuetext={`${formatClock(position)} of ${formatClock(duration)}`}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          seek((e.clientX - rect.left) / rect.width)
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seek(Math.min(1, progress + 0.05))
          if (e.key === "ArrowLeft") seek(Math.max(0, progress - 0.05))
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault()
            toggle()
          }
        }}
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px] rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {bars.map((b, i) => (
          <span
            key={i}
            className={cn("w-[3px] flex-1 rounded-full", i / bars.length < progress ? "bg-primary" : "bg-muted-foreground/35")}
            style={{ height: `${Math.max(10, b)}%` }}
          />
        ))}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {failed ? "Can’t play" : formatClock(playing || position > 0 ? position : duration)}
      </span>
    </div>
  )
}

export function isVoice(a: Attachment) {
  return a.contentType.startsWith("audio/") && a.durationMs !== null
}

