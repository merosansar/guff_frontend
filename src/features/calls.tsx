import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react"
import { toast } from "sonner"
import { Avatar } from "@/components/common"
import { formatClock } from "@/components/voice"
import { emitAck, getSocket } from "@/lib/socket"
import { useConnection } from "@/lib/stores"
import type { CallInvite, Channel, User } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useConfig, useUsers } from "./data"
import { notify } from "./notify"
import { useMe } from "./session"

/**
 * One-to-one voice and video calls in DMs, browser to browser (WebRTC). The server only
 * relays the set-up messages between the two people; audio and video go directly
 * between the browsers (or through a TURN server when ICE_SERVERS has one).
 */

type Phase = "outgoing" | "incoming" | "connecting" | "active"

interface CallState {
  callId: string
  channelId: string
  peerId: string
  video: boolean
  role: "caller" | "callee"
  phase: Phase
  /** The other browser tab taking part (known once the call is answered). */
  peerSocketId: string | null
  startedAt: number | null
}

type Signal = { type: "offer" | "answer"; sdp: string } | { type: "candidate"; candidate: RTCIceCandidateInit }

const RING_MS = 35_000
const newCallId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

interface CallsValue {
  start: (channel: Channel, video: boolean) => void
  busy: boolean
}

const CallsContext = createContext<CallsValue>({ start: () => {}, busy: false })
export const useCalls = () => useContext(CallsContext)

/** A gentle two-tone ring, made with WebAudio so there's no sound file to ship. */
function startRinging(): () => void {
  try {
    const ctx = new AudioContext()
    const beep = () => {
      for (const [freq, at] of [
        [880, 0],
        [660, 0.25],
      ] as const) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + at)
        gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22)
        osc.connect(gain).connect(ctx.destination)
        osc.start(ctx.currentTime + at)
        osc.stop(ctx.currentTime + at + 0.25)
      }
    }
    beep()
    const timer = setInterval(beep, 2000)
    return () => {
      clearInterval(timer)
      void ctx.close().catch(() => {})
    }
  } catch {
    return () => {}
  }
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const me = useMe()
  const { byId } = useUsers()
  const config = useConfig()
  const connection = useConnection()
  const [call, setCall] = useState<CallState | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const callRef = useRef<CallState | null>(null)
  const pc = useRef<RTCPeerConnection | null>(null)
  const local = useRef<MediaStream | null>(null)
  const queued = useRef<RTCIceCandidateInit[]>([])
  const ringTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stopRing = useRef<(() => void) | null>(null)
  const pendingInvite = useRef<CallInvite | null>(null)

  const update = useCallback((next: CallState | null) => {
    callRef.current = next
    setCall(next)
  }, [])

  const iceServers = config?.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }]

  const teardown = useCallback(() => {
    clearTimeout(ringTimer.current)
    stopRing.current?.()
    stopRing.current = null
    pc.current?.close()
    pc.current = null
    local.current?.getTracks().forEach((t) => t.stop())
    local.current = null
    queued.current = []
    pendingInvite.current = null
    setLocalStream(null)
    setRemoteStream(null)
    setMuted(false)
    setCameraOff(false)
    update(null)
  }, [update])

  const signal = useCallback((data: Signal) => {
    const c = callRef.current
    if (!c?.peerSocketId) return
    emitAck("call:signal", { callId: c.callId, channelId: c.channelId, toSocketId: c.peerSocketId, data }).catch(() => {})
  }, [])

  /** Ends the call for both sides. Only the person who ends it writes the line in the DM. */
  const hangUp = useCallback(
    (reason: "hangup" | "missed" = "hangup") => {
      const c = callRef.current
      if (!c) return
      const durationSec = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0
      const log = c.startedAt ? "ended" : c.role === "caller" ? "missed" : undefined
      emitAck("call:end", { callId: c.callId, channelId: c.channelId, log: reason === "missed" ? "missed" : log, durationSec, video: c.video }).catch(() => {})
      teardown()
    },
    [teardown],
  )

  const getMedia = async (video: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { width: 1280, height: 720 } : false })
    local.current = stream
    setLocalStream(stream)
    return stream
  }

  const makePeer = (stream: MediaStream) => {
    const peer = new RTCPeerConnection({ iceServers })
    stream.getTracks().forEach((t) => peer.addTrack(t, stream))
    peer.onicecandidate = (e) => e.candidate && signal({ type: "candidate", candidate: e.candidate.toJSON() })
    peer.ontrack = (e) => setRemoteStream(e.streams[0] ?? new MediaStream([e.track]))
    peer.onconnectionstatechange = () => {
      const c = callRef.current
      if (!c) return
      if (peer.connectionState === "connected" && c.phase !== "active") update({ ...c, phase: "active", startedAt: Date.now() })
      if (peer.connectionState === "failed") {
        toast.error("The call couldn’t connect. Networks that block direct connections need a TURN server (ICE_SERVERS).")
        hangUp()
      }
    }
    pc.current = peer
    return peer
  }

  const flushCandidates = async () => {
    for (const candidate of queued.current.splice(0)) await pc.current?.addIceCandidate(candidate).catch(() => {})
  }

  // ---- starting a call --------------------------------------------------------------
  const start = useCallback(
    (channel: Channel, video: boolean) => {
      if (callRef.current) return toast("You’re already in a call.")
      const peerId = channel.dmUserId
      if (!peerId || peerId === me.id) return
      const callId = newCallId()
      update({ callId, channelId: channel.id, peerId, video, role: "caller", phase: "outgoing", peerSocketId: null, startedAt: null })
      void (async () => {
        try {
          await getMedia(video)
        } catch {
          teardown()
          return toast.error(video ? "Guff can’t use your camera or microphone. Allow them in the site settings." : "Guff can’t use your microphone. Allow it in the site settings.")
        }
        try {
          await emitAck("call:invite", { callId, channelId: channel.id, video })
        } catch (e) {
          teardown()
          return toast.error((e as Error).message)
        }
        ringTimer.current = setTimeout(() => {
          toast("No answer")
          hangUp("missed")
        }, RING_MS)
      })()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me.id, teardown, hangUp, update],
  )

  // ---- answering --------------------------------------------------------------------
  const accept = async (withVideo: boolean) => {
    const invite = pendingInvite.current
    const c = callRef.current
    if (!invite || !c) return
    stopRing.current?.()
    try {
      await getMedia(withVideo && invite.video)
    } catch {
      toast.error("Guff can’t use your microphone or camera. Allow them in the site settings.")
      return decline()
    }
    update({ ...c, phase: "connecting", peerSocketId: invite.fromSocketId, video: invite.video })
    makePeer(local.current!)
    emitAck("call:accept", { callId: invite.callId, channelId: invite.channelId, toSocketId: invite.fromSocketId }).catch(() => {
      toast.error("The call ended before you answered.")
      teardown()
    })
  }

  const decline = () => {
    const invite = pendingInvite.current
    if (invite) emitAck("call:decline", { callId: invite.callId, channelId: invite.channelId, toSocketId: invite.fromSocketId }).catch(() => {})
    teardown()
  }

  // ---- socket events ----------------------------------------------------------------
  useEffect(() => {
    const socket = getSocket()
    if (!socket || connection !== "online") return

    const onIncoming = (invite: CallInvite) => {
      if (callRef.current) {
        // Already busy: let the caller know.
        emitAck("call:decline", { callId: invite.callId, channelId: invite.channelId, toSocketId: invite.fromSocketId }).catch(() => {})
        return
      }
      pendingInvite.current = invite
      update({
        callId: invite.callId,
        channelId: invite.channelId,
        peerId: invite.fromUserId,
        video: invite.video,
        role: "callee",
        phase: "incoming",
        peerSocketId: invite.fromSocketId,
        startedAt: null,
      })
      stopRing.current = startRinging()
      const caller = byId.get(invite.fromUserId)
      notify(`${caller?.name ?? "Someone"} is calling`, invite.video ? "Video call" : "Voice call", () => {})
      ringTimer.current = setTimeout(() => teardown(), RING_MS + 5000)
    }

    const onAccepted = async (e: { callId: string; bySocketId: string }) => {
      const c = callRef.current
      if (!c || c.callId !== e.callId) return
      if (c.role === "callee") {
        // Answered in another of your tabs.
        if (e.bySocketId !== socket.id) teardown()
        return
      }
      clearTimeout(ringTimer.current)
      update({ ...c, phase: "connecting", peerSocketId: e.bySocketId })
      const peer = makePeer(local.current!)
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      signal({ type: "offer", sdp: offer.sdp ?? "" })
    }

    const onSignal = async (e: { callId: string; fromSocketId: string; data: Signal }) => {
      const c = callRef.current
      const peer = pc.current
      if (!c || c.callId !== e.callId || !peer || e.fromSocketId !== c.peerSocketId) return
      const data = e.data
      try {
        if (data.type === "offer") {
          await peer.setRemoteDescription({ type: "offer", sdp: data.sdp })
          await flushCandidates()
          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)
          signal({ type: "answer", sdp: answer.sdp ?? "" })
        } else if (data.type === "answer") {
          await peer.setRemoteDescription({ type: "answer", sdp: data.sdp })
          await flushCandidates()
        } else if (data.type === "candidate") {
          if (peer.remoteDescription) await peer.addIceCandidate(data.candidate).catch(() => {})
          else queued.current.push(data.candidate)
        }
      } catch {
        toast.error("The call couldn’t be set up.")
        hangUp()
      }
    }

    const onDeclined = (e: { callId: string }) => {
      const c = callRef.current
      if (!c || c.callId !== e.callId) return
      toast(`${byId.get(c.peerId)?.name.split(" ")[0] ?? "They"} can’t talk right now`)
      hangUp("missed")
    }

    const onEnded = (e: { callId: string }) => {
      const c = callRef.current
      if (!c || c.callId !== e.callId) return
      if (c.phase === "active") toast("Call ended")
      teardown()
    }

    socket.on("call:incoming", onIncoming)
    socket.on("call:accepted", onAccepted)
    socket.on("call:signal", onSignal)
    socket.on("call:declined", onDeclined)
    socket.on("call:ended", onEnded)
    return () => {
      socket.off("call:incoming", onIncoming)
      socket.off("call:accepted", onAccepted)
      socket.off("call:signal", onSignal)
      socket.off("call:declined", onDeclined)
      socket.off("call:ended", onEnded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, byId, teardown, hangUp, signal, update])

  // Leaving the page ends the call properly.
  useEffect(() => {
    const onUnload = () => callRef.current && hangUp()
    window.addEventListener("pagehide", onUnload)
    return () => window.removeEventListener("pagehide", onUnload)
  }, [hangUp])

  const toggleMute = () => {
    const next = !muted
    local.current?.getAudioTracks().forEach((t) => (t.enabled = !next))
    setMuted(next)
  }
  const toggleCamera = () => {
    const next = !cameraOff
    local.current?.getVideoTracks().forEach((t) => (t.enabled = !next))
    setCameraOff(next)
  }

  return (
    <CallsContext.Provider value={{ start, busy: call !== null }}>
      {children}
      {call && (
        <CallWindow
          call={call}
          peer={byId.get(call.peerId)}
          localStream={localStream}
          remoteStream={remoteStream}
          muted={muted}
          cameraOff={cameraOff}
          onAccept={(video) => void accept(video)}
          onDecline={decline}
          onHangUp={() => hangUp()}
          onMute={toggleMute}
          onCamera={toggleCamera}
        />
      )}
    </CallsContext.Provider>
  )
}

function MediaView({ stream, muted, className, mirror }: { stream: MediaStream | null; muted?: boolean; className?: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
  }, [stream])
  return <video ref={ref} autoPlay playsInline muted={muted} className={cn(className, mirror && "-scale-x-100")} />
}

function CallWindow({
  call,
  peer,
  localStream,
  remoteStream,
  muted,
  cameraOff,
  onAccept,
  onDecline,
  onHangUp,
  onMute,
  onCamera,
}: {
  call: CallState
  peer: User | undefined
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  muted: boolean
  cameraOff: boolean
  onAccept: (video: boolean) => void
  onDecline: () => void
  onHangUp: () => void
  onMute: () => void
  onCamera: () => void
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const name = peer?.name ?? "Someone"
  const label =
    call.phase === "incoming"
      ? call.video
        ? "Incoming video call"
        : "Incoming call"
      : call.phase === "outgoing"
        ? "Calling…"
        : call.phase === "connecting"
          ? "Connecting…"
          : formatClock(now - (call.startedAt ?? now))
  const remoteHasVideo = !!remoteStream?.getVideoTracks().some((t) => t.readyState === "live")
  const big = call.video && call.phase !== "incoming"

  return (
    <div
      role="dialog"
      aria-label={`Call with ${name}`}
      className={cn(
        "fixed z-50 overflow-hidden rounded-xl border bg-sidebar text-white shadow-2xl",
        big ? "inset-2 sm:inset-auto sm:right-4 sm:bottom-4 sm:h-[min(70vh,540px)] sm:w-[min(92vw,720px)]" : "right-3 bottom-3 left-3 sm:left-auto sm:w-80",
      )}
    >
      {big && (
        <div className="absolute inset-0 grid place-items-center bg-black">
          {remoteHasVideo ? (
            <MediaView stream={remoteStream} className="size-full object-contain" />
          ) : (
            peer && <Avatar name={peer.name} color={peer.color} size="lg" />
          )}
          {localStream && !cameraOff && <MediaView stream={localStream} muted mirror className="absolute right-3 bottom-20 w-28 rounded-lg border border-white/20 object-cover shadow-lg sm:w-40" />}
        </div>
      )}
      {!call.video && remoteStream && <MediaView stream={remoteStream} className="hidden" />}

      <div className={cn("relative flex items-center gap-3 p-4", big && "bg-gradient-to-b from-black/60 to-transparent")}>
        {!big && peer && <Avatar name={peer.name} color={peer.color} size="md" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{name}</p>
          <p className="text-sm text-white/70 tabular-nums" aria-live="polite">
            {label}
          </p>
        </div>
      </div>

      <div className={cn("relative flex items-center justify-center gap-3 p-4 pt-1", big && "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent")}>
        {call.phase === "incoming" ? (
          <>
            <RoundButton label="Decline" onClick={onDecline} className="bg-red-600 hover:bg-red-500">
              <PhoneOff />
            </RoundButton>
            {call.video && (
              <RoundButton label="Answer with audio only" onClick={() => onAccept(false)} className="bg-white/15 hover:bg-white/25">
                <Phone />
              </RoundButton>
            )}
            <RoundButton label={call.video ? "Answer with video" : "Answer"} onClick={() => onAccept(true)} className="bg-emerald-600 hover:bg-emerald-500">
              {call.video ? <Video /> : <Phone />}
            </RoundButton>
          </>
        ) : (
          <>
            <RoundButton label={muted ? "Unmute" : "Mute"} onClick={onMute} pressed={muted} className={muted ? "bg-white text-sidebar" : "bg-white/15 hover:bg-white/25"}>
              {muted ? <MicOff /> : <Mic />}
            </RoundButton>
            {call.video && (
              <RoundButton label={cameraOff ? "Turn camera on" : "Turn camera off"} onClick={onCamera} pressed={cameraOff} className={cameraOff ? "bg-white text-sidebar" : "bg-white/15 hover:bg-white/25"}>
                {cameraOff ? <VideoOff /> : <Video />}
              </RoundButton>
            )}
            <RoundButton label="Hang up" onClick={onHangUp} className="bg-red-600 hover:bg-red-500">
              <PhoneOff />
            </RoundButton>
          </>
        )}
      </div>
    </div>
  )
}

function RoundButton({ label, children, className, pressed, ...props }: { label: string; pressed?: boolean } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn("grid size-12 place-items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none [&_svg]:size-5", className)}
      {...props}
    >
      {children}
    </button>
  )
}
