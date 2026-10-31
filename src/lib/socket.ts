import { io, type Socket } from "socket.io-client"
import { ApiError, getAccessToken, onAccessToken, refreshSession } from "./api"
import { connectionStore } from "./stores"
import type { Ack, Session } from "./types"

let socket: Socket | null = null
let onSignedOut: (() => void) | null = null
let stopRenewing: (() => void) | null = null

export const getSocket = () => socket

/**
 * One socket per tab. The token is read on every (re)connect, so a reconnect after a
 * long sleep picks up a freshly refreshed token.
 */
export function openSocket(handlers: { onSignedOut: () => void; onSession: (s: Session) => void }): Socket {
  if (socket) return socket
  onSignedOut = handlers.onSignedOut
  connectionStore.set("connecting")

  const s = io({
    path: "/socket.io",
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  })
  socket = s

  const reauthenticate = async () => {
    const session = await refreshSession()
    if (!session) return onSignedOut?.()
    handlers.onSession(session)
    s.connect()
  }

  s.on("connect", () => connectionStore.set("online"))
  s.on("disconnect", (reason) => {
    connectionStore.set("reconnecting")
    // The server only hangs up on purpose when the token ran out; anything else retries by itself.
    if (reason === "io server disconnect") void reauthenticate()
  })
  s.on("connect_error", (error) => {
    connectionStore.set("reconnecting")
    if (error.message === "unauthorized") void reauthenticate()
  })

  // When the access token is refreshed, hand it to the open socket so it isn't cut off.
  stopRenewing = onAccessToken((token) => {
    if (token && s.connected) s.emit("auth:renew", { token })
  })
  return s
}

export function closeSocket() {
  stopRenewing?.()
  stopRenewing = null
  socket?.removeAllListeners()
  socket?.disconnect()
  socket = null
  connectionStore.set("connecting")
}

/** Emits and waits for the server's answer. Throws ApiError with the server's message. */
export async function emitAck<T>(event: string, payload: unknown, timeoutMs = 10_000): Promise<T> {
  const s = socket
  if (!s || !s.connected) throw new ApiError(0, "You’re offline. Guff will send this when you’re back.")
  let ack: Ack<T>
  try {
    ack = (await s.timeout(timeoutMs).emitWithAck(event, payload)) as Ack<T>
  } catch {
    throw new ApiError(0, "The server didn’t answer in time.")
  }
  if (!ack.ok) throw new ApiError(ack.error.status, ack.error.message)
  return ack.data
}

/** Typing indicators are best-effort: no answer expected. */
export function emitTyping(channelId: string, typing: boolean) {
  if (socket?.connected) socket.emit("typing", { channelId, typing })
}
