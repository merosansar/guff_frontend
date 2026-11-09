import type {
  AppConfig,
  Attachment,
  Channel,
  CustomStatus,
  HistoryEntry,
  Member,
  Message,
  MessagePage,
  NotifyLevel,
  SavedMessage,
  Scheduled,
  Session,
  Summary,
  Thread,
  User,
  Webhook,
} from "./types"

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "ApiError"
  }
}

const OFFLINE_MESSAGE = "Can’t reach the Guff API. Make sure the API window is open and shows “API ready”."

/** The access token lives in memory only; the refresh token is an httpOnly cookie. */
let accessToken: string | null = null
let expiresAt = 0
const tokenListeners = new Set<(token: string | null) => void>()

export function getAccessToken() {
  return accessToken
}

export function setAccessToken(token: string | null, expiresIn = 0) {
  accessToken = token
  expiresAt = token ? Date.now() + expiresIn * 1000 : 0
  tokenListeners.forEach((fn) => fn(token))
}

/** Called whenever the access token changes (the socket uses it to renew itself). */
export function onAccessToken(fn: (token: string | null) => void) {
  tokenListeners.add(fn)
  return () => tokenListeners.delete(fn)
}

/** Milliseconds until the access token expires. */
export const tokenLifetimeLeft = () => expiresAt - Date.now()

let sessionListener: ((session: Session | null) => void) | null = null
export function onSessionChange(fn: (session: Session | null) => void) {
  sessionListener = fn
}

let refreshing: Promise<Session | null> | null = null

/** One refresh at a time, however many requests hit a 401 together. */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: { "X-Guff-Client": "web" },
  })
    .then(async (res) => (res.ok ? ((await res.json()) as Session) : null))
    .catch(() => null)
    .then((session) => {
      setAccessToken(session?.accessToken ?? null, session?.expiresIn)
      return session
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

type Query = Record<string, string | number | undefined | null>

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query; form?: FormData } = {},
): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin)
  for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v))

  const send = () => {
    const headers: Record<string, string> = { "X-Guff-Client": "web" }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    if (options.body !== undefined) headers["Content-Type"] = "application/json"
    return fetch(url, {
      method: options.method ?? "GET",
      credentials: "include",
      headers,
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    })
  }

  let res: Response
  try {
    res = await send()
    if (res.status === 401 && !path.startsWith("/auth/")) {
      const session = await refreshSession()
      sessionListener?.(session)
      if (session) res = await send()
    }
  } catch {
    throw new ApiError(0, OFFLINE_MESSAGE)
  }
  if (res.status === 502 || res.status === 504) throw new ApiError(res.status, OFFLINE_MESSAGE)
  if (!res.ok) {
    let message = `Something went wrong (${res.status}).`
    try {
      const body = (await res.json()) as { message?: string }
      if (body.message) message = body.message
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Uploads with progress (fetch can't report upload progress). */
export function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  voice?: { durationMs: number; waveform: number[] },
): Promise<Attachment> {
  const attempt = () =>
    new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open("POST", "/api/uploads")
      xhr.withCredentials = true
      xhr.setRequestHeader("X-Guff-Client", "web")
      if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`)
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
      xhr.onload = () => {
        let body: unknown = null
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          /* empty */
        }
        resolve({ status: xhr.status, body })
      }
      xhr.onerror = () => reject(new ApiError(0, OFFLINE_MESSAGE))
      xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"))
      signal?.addEventListener("abort", () => xhr.abort())
      const form = new FormData()
      if (voice) {
        // Text fields first, so the server has them when the file arrives.
        form.append("voice", "1")
        form.append("durationMs", String(Math.round(voice.durationMs)))
        form.append("waveform", JSON.stringify(voice.waveform))
      }
      form.append("file", file)
      xhr.send(form)
    })

  return attempt().then(async (first) => {
    let result = first
    if (result.status === 401) {
      const session = await refreshSession()
      sessionListener?.(session)
      if (session) result = await attempt()
    }
    if (result.status >= 200 && result.status < 300) return result.body as Attachment
    const message = (result.body as { message?: string } | null)?.message ?? `Upload failed (${result.status}).`
    throw new ApiError(result.status, message)
  })
}

export const api = {
  auth: {
    login: (email: string, password: string) => request<Session>("/auth/login", { method: "POST", body: { email, password } }),
    register: (body: { name: string; email: string; password: string }) =>
      request<Session>("/auth/register", { method: "POST", body }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    forgot: (email: string) => request<void>("/auth/forgot", { method: "POST", body: { email } }),
    reset: (token: string, password: string) => request<void>("/auth/reset", { method: "POST", body: { token, password } }),
    verifyEmail: (token: string) => request<void>("/auth/verify-email", { method: "POST", body: { token } }),
    sendVerification: () => request<void>("/auth/verify-email/send", { method: "POST" }),
  },
  config: () => request<AppConfig>("/config"),
  users: {
    list: () => request<User[]>("/users"),
    updateMe: (body: {
      name?: string
      title?: string
      customStatus?: (Omit<CustomStatus, "expiresAt"> & { expiresAt: string | null }) | null
      dndUntil?: string | null
    }) => request<User>("/users/me", { method: "PATCH", body }),
  },
  channels: {
    list: () => request<Channel[]>("/channels"),
    browse: (q = "") => request<Channel[]>("/channels/browse", { query: { q } }),
    get: (id: string) => request<Channel>(`/channels/${id}`),
    create: (body: { name: string; topic?: string; kind: "public" | "private"; memberIds?: string[] }) =>
      request<Channel>("/channels", { method: "POST", body }),
    update: (id: string, body: { name?: string; topic?: string }) => request<Channel>(`/channels/${id}`, { method: "PATCH", body }),
    join: (id: string) => request<Channel>(`/channels/${id}/join`, { method: "POST" }),
    leave: (id: string) => request<void>(`/channels/${id}/leave`, { method: "POST" }),
    members: (id: string) => request<Member[]>(`/channels/${id}/members`),
    addMembers: (id: string, userIds: string[]) => request<Channel>(`/channels/${id}/members`, { method: "POST", body: { userIds } }),
    messages: (id: string, query: { before?: string; after?: string; around?: string; limit?: number }) =>
      request<MessagePage>(`/channels/${id}/messages`, { query }),
    pins: (id: string) => request<Message[]>(`/channels/${id}/pins`),
    setRole: (id: string, userId: string, role: "admin" | "member") =>
      request<void>(`/channels/${id}/members/${userId}/role`, { method: "POST", body: { role } }),
    removeMember: (id: string, userId: string) => request<void>(`/channels/${id}/members/${userId}`, { method: "DELETE" }),
    archive: (id: string, archived: boolean) => request<Channel>(`/channels/${id}/archive`, { method: "POST", body: { archived } }),
    notify: (id: string, level: NotifyLevel) => request<Channel>(`/channels/${id}/notify`, { method: "PUT", body: { level } }),
    summary: (id: string) => request<Summary>(`/channels/${id}/summary`, { method: "POST" }),
    webhooks: (id: string) => request<Webhook[]>(`/channels/${id}/webhooks`),
    createWebhook: (id: string, name: string) =>
      request<{ webhook: Webhook; url: string }>(`/channels/${id}/webhooks`, { method: "POST", body: { name } }),
  },
  webhooks: {
    remove: (id: string) => request<void>(`/webhooks/${id}`, { method: "DELETE" }),
  },
  messages: {
    pin: (id: string, pinned: boolean) => request<Message>(`/messages/${id}/pin`, { method: "POST", body: { pinned } }),
    bookmark: (id: string, saved: boolean) => request<{ saved: boolean }>(`/messages/${id}/bookmark`, { method: "PUT", body: { saved } }),
    history: (id: string) => request<HistoryEntry[]>(`/messages/${id}/history`),
    thread: (id: string) => request<Thread>(`/messages/${id}/thread`),
  },
  bookmarks: () => request<SavedMessage[]>("/bookmarks"),
  scheduled: {
    list: () => request<Scheduled[]>("/scheduled"),
    create: (body: { channelId: string; text: string; sendAt: string; threadRootId?: string }) =>
      request<Scheduled>("/scheduled", { method: "POST", body }),
    remind: (messageId: string, remindAt: string) => request<Scheduled>("/reminders", { method: "POST", body: { messageId, remindAt } }),
    cancel: (id: string) => request<void>(`/scheduled/${id}`, { method: "DELETE" }),
  },
  push: {
    subscribe: (sub: PushSubscriptionJSON) => request<void>("/push/subscribe", { method: "POST", body: sub }),
    unsubscribe: (endpoint: string) => request<void>("/push/unsubscribe", { method: "POST", body: { endpoint } }),
  },
  dms: {
    open: (userId: string) => request<Channel>("/dms", { method: "POST", body: { userId } }),
  },
  search: (q: string) => request<Message[]>("/search", { query: { q } }),
}
