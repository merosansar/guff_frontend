import type { QueryClient } from "@tanstack/react-query"
import { ApiError } from "@/lib/api"
import { emitAck, getSocket } from "@/lib/socket"
import { addPending, pendingStore, removePending, updatePending, type PendingMessage } from "@/lib/stores"
import type { Attachment, Message } from "@/lib/types"
import { keys, patchChannel, putMessage } from "./data"
import type { Channel } from "@/lib/types"

const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

/** Errors that a retry can't fix (validation, permissions). Network trouble is retried. */
const permanent = (error: unknown) => error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429

async function deliver(qc: QueryClient, pending: PendingMessage) {
  try {
    const message = await emitAck<Message>("message:send", {
      channelId: pending.channelId,
      clientId: pending.clientId,
      text: pending.text,
      replyToId: pending.replyToId ?? undefined,
      attachmentIds: pending.attachments.map((a) => a.id),
    })
    putMessage(qc, message)
    removePending(pending.clientId)
  } catch (error) {
    if (permanent(error)) {
      updatePending(pending.clientId, { status: "failed", error: (error as Error).message })
    } else if (!getSocket()?.connected) {
      // Offline: stays "sending" and goes out again on reconnect (same clientId, so no duplicates).
    } else {
      updatePending(pending.clientId, { status: "failed", error: (error as Error).message })
    }
  }
}

/** Shows the message straight away, then sends it. */
export function sendMessage(
  qc: QueryClient,
  input: { channelId: string; text: string; replyToId?: string | null; attachments?: Attachment[] },
) {
  const pending: PendingMessage = {
    clientId: newClientId(),
    channelId: input.channelId,
    text: input.text,
    replyToId: input.replyToId ?? null,
    attachments: input.attachments ?? [],
    createdAt: new Date().toISOString(),
    status: "sending",
  }
  addPending(pending)
  void deliver(qc, pending)
}

export function retryMessage(qc: QueryClient, clientId: string) {
  const pending = pendingStore.get().find((m) => m.clientId === clientId)
  if (!pending) return
  updatePending(clientId, { status: "sending", error: undefined })
  void deliver(qc, { ...pending, status: "sending" })
}

/** After a reconnect: everything still marked "sending" goes out again. */
export function flushOutbox(qc: QueryClient) {
  for (const pending of pendingStore.get()) if (pending.status === "sending") void deliver(qc, pending)
}

export async function editMessage(qc: QueryClient, messageId: string, text: string) {
  putMessage(qc, await emitAck<Message>("message:edit", { messageId, text }))
}

export async function deleteMessage(qc: QueryClient, messageId: string) {
  putMessage(qc, await emitAck<Message>("message:delete", { messageId }))
}

export async function toggleReaction(qc: QueryClient, messageId: string, emoji: string) {
  putMessage(qc, await emitAck<Message>("reaction:toggle", { messageId, emoji }))
}

const lastSentRead = new Map<string, string>()

/** Moves your read marker to this message (never backwards) and clears the sidebar badge. */
export function markRead(qc: QueryClient, channelId: string, messageId: string) {
  const channel = qc.getQueryData<Channel[]>(keys.channels)?.find((c) => c.id === channelId)
  const already = lastSentRead.get(channelId) ?? channel?.lastReadId ?? ""
  if (messageId <= already) {
    if (channel && (channel.unread > 0 || channel.mentions > 0)) patchChannel(qc, channelId, (c) => ({ ...c, unread: 0, mentions: 0 }))
    return
  }
  lastSentRead.set(channelId, messageId)
  patchChannel(qc, channelId, (c) => ({ ...c, lastReadId: messageId, unread: 0, mentions: 0 }))
  emitAck("channel:read", { channelId, messageId }).catch(() => lastSentRead.delete(channelId))
}
