/** Mirrors guff_backend/src/services/dto.ts. */

export type PresenceStatus = "online" | "away" | "offline"
export type AvatarColor = "indigo" | "teal" | "rose" | "amber" | "sky" | "violet" | "green" | "orange"

export interface User {
  id: string
  name: string
  email: string
  title: string
  color: AvatarColor
  lastSeenAt: string | null
  status: PresenceStatus
  demo: boolean
  customStatus: CustomStatus | null
  /** Do not disturb until this time. */
  dndUntil: string | null
  emailVerified: boolean
}

export interface CustomStatus {
  emoji: string
  text: string
  expiresAt: string | null
}

export interface Session {
  accessToken: string
  expiresIn: number
  user: Omit<User, "status" | "demo">
}

export interface Attachment {
  id: string
  name: string
  size: number
  contentType: string
  width: number | null
  height: number | null
  url: string
  /** Voice messages: length and a loudness outline (0 to 100). */
  durationMs: number | null
  waveform: number[] | null
}

export interface LinkPreview {
  url: string
  title: string
  description: string
  image: string | null
  siteName: string
}

export interface Message {
  id: string
  channelId: string
  authorId: string
  kind: "user" | "system"
  clientId: string | null
  text: string
  mentions: string[]
  replyTo: { messageId: string; authorId: string; excerpt: string } | null
  reactions: { emoji: string; userIds: string[] }[]
  attachments: Attachment[]
  automated: boolean
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  editCount: number
  pinnedAt: string | null
  pinnedBy: string | null
  /** Set on a reply inside a thread. */
  threadRootId: string | null
  /** Set on a message that has replies in a thread. */
  thread: { replyCount: number; lastReplyAt: string | null; participantIds: string[] } | null
  linkPreview: LinkPreview | null
  /** Posted by an integration (incoming webhook). */
  webhook: { id: string; name: string } | null
  /** A reminder you set, delivered to your notes. */
  reminder: boolean
  ref: { channelId: string; messageId: string; authorId: string; excerpt: string } | null
}

export type Role = "owner" | "admin" | "member"
export type NotifyLevel = "all" | "mentions" | "mute"

export interface Channel {
  id: string
  kind: "public" | "private" | "dm"
  name: string
  topic: string
  isDefault: boolean
  memberCount: number
  createdBy: string
  createdAt: string
  lastMessageAt: string | null
  dmUserId: string | null
  archivedAt: string | null
  joined: boolean
  role: Role | null
  notify: NotifyLevel
  lastReadId: string | null
  unread: number
  mentions: number
}

export interface MessagePage {
  messages: Message[]
  hasMoreBefore: boolean
  hasMoreAfter: boolean
}

export interface Member {
  userId: string
  role: Role
  joinedAt: string
  lastReadId: string | null
}

export interface Thread {
  root: Message
  replies: Message[]
}

export interface SavedMessage {
  savedAt: string
  message: Message
}

export interface Scheduled {
  id: string
  kind: "message" | "reminder"
  channelId: string
  text: string
  threadRootId: string | null
  messageId: string | null
  sendAt: string
  status: "pending" | "sending" | "sent" | "failed"
  error: string | null
}

export interface Webhook {
  id: string
  channelId: string
  name: string
  createdBy: string
  createdAt: string
  lastUsedAt: string | null
}

export interface HistoryEntry {
  text: string
  writtenAt: string
  current: boolean
}

export interface Summary {
  summary: string
  scope: "unread" | "recent"
  messageCount: number
}

/** What this server can do (features that depend on keys being set). */
export interface AppConfig {
  ai: boolean
  pushKey: string | null
  iceServers: RTCIceServer[]
  maxUploadMb: number
}

export interface CallInvite {
  callId: string
  channelId: string
  fromUserId: string
  fromSocketId: string
  video: boolean
}

export type Ack<T = unknown> = { ok: true; data: T } | { ok: false; error: { status: number; message: string } }

export const REACTIONS = ["👍", "❤️", "😂", "🎉", "🙏", "👀", "✅", "🔥", "😮", "😢", "💯", "🙌"] as const
