import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { api, onSessionChange, refreshSession, setAccessToken, tokenLifetimeLeft } from "@/lib/api"
import { closeSocket } from "@/lib/socket"
import type { Session } from "@/lib/types"
import { FullPageSpinner } from "@/components/common"

/** Not a secret: remembers that a refresh cookie probably exists, so new visitors skip the refresh call. */
const HINT = "guff-signed-in"
const hint = {
  get: () => {
    try {
      return localStorage.getItem(HINT) === "1"
    } catch {
      return true
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(HINT, "1")
      else localStorage.removeItem(HINT)
    } catch {
      /* storage blocked */
    }
  },
}

/** Signing out in one tab signs out every tab. */
const tabs = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("guff-session") : null

type Status = "loading" | "signed-in" | "signed-out"

interface SessionValue {
  user: Session["user"] | null
  status: Status
  login: (email: string, password: string) => Promise<void>
  register: (body: { name: string; email: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  /** Keep the signed-in user's own details in step after a profile edit. */
  updateUser: (user: Session["user"]) => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<Session["user"] | null>(null)
  const [status, setStatus] = useState<Status>(() => (hint.get() ? "loading" : "signed-out"))

  const apply = useCallback(
    (session: Session | null) => {
      setAccessToken(session?.accessToken ?? null, session?.expiresIn)
      hint.set(!!session)
      setUser(session?.user ?? null)
      setStatus(session ? "signed-in" : "signed-out")
      if (!session) {
        closeSocket()
        queryClient.clear()
      }
    },
    [queryClient],
  )

  useEffect(() => {
    onSessionChange(apply)
    if (hint.get()) void refreshSession().then(apply)
    const onMessage = (e: MessageEvent) => {
      if (e.data === "signed-out") apply(null)
      if (e.data === "signed-in") void refreshSession().then(apply)
    }
    tabs?.addEventListener("message", onMessage)
    return () => tabs?.removeEventListener("message", onMessage)
  }, [apply])

  // Refresh the access token a minute before it runs out, so neither requests nor the socket hit a 401.
  useEffect(() => {
    if (status !== "signed-in") return
    const timer = setTimeout(
      () => void refreshSession().then((s) => s ? apply(s) : apply(null)),
      Math.max(tokenLifetimeLeft() - 60_000, 10_000),
    )
    return () => clearTimeout(timer)
  }, [status, user, apply])

  const value = useMemo<SessionValue>(
    () => ({
      user,
      status,
      login: async (email, password) => {
        apply(await api.auth.login(email, password))
        tabs?.postMessage("signed-in")
      },
      register: async (body) => {
        apply(await api.auth.register(body))
        tabs?.postMessage("signed-in")
      },
      logout: async () => {
        try {
          await api.auth.logout()
        } finally {
          apply(null)
          tabs?.postMessage("signed-out")
        }
      },
      updateUser: (next) => setUser(next),
    }),
    [user, status, apply],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>")
  return ctx
}

/** The signed-in person. Only use inside <RequireAuth>. */
export function useMe() {
  const { user } = useSession()
  if (!user) throw new Error("useMe needs a signed-in user")
  return user
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const location = useLocation()
  if (status === "loading") return <FullPageSpinner />
  if (status === "signed-out") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

export function GuestOnly({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const location = useLocation()
  if (status === "loading") return <FullPageSpinner />
  if (status === "signed-in") {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from !== "/login" ? from : "/"} replace />
  }
  return <>{children}</>
}
