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
}

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
  joined: boolean
  role: "owner" | "member" | null
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
  role: "owner" | "member"
  joinedAt: string
  lastReadId: string | null
}

export type Ack<T = unknown> = { ok: true; data: T } | { ok: false; error: { status: number; message: string } }

export const REACTIONS = ["👍", "❤️", "😂", "🎉", "🙏", "👀", "✅", "🔥", "😮", "😢", "💯", "🙌"] as const
