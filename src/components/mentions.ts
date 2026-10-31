import type { User } from "@/lib/types"

/**
 * In the composer a mention reads "@Sita Sharma"; on the wire it is "<@userId>", so a
 * mention keeps pointing at the right person even if they change their name.
 */

/** "<@id>" → "@Name" for editing and copying. */
export function fromWire(text: string, users: Map<string, User>): string {
  return text.replace(/<@([a-f\d]{24})>/gi, (_m, id: string) => `@${users.get(id)?.name ?? "someone"}`)
}

/** "@Name" → "<@id>" for every mention chosen from the list. Longest names first, so "@Sita Sharma" beats "@Sita". */
export function toWire(text: string, mentions: Map<string, string>): string {
  let out = text
  const names = [...mentions.keys()].sort((a, b) => b.length - a.length)
  for (const display of names) {
    const escaped = display.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    out = out.replace(new RegExp(`${escaped}(?![\\p{L}\\p{N}])`, "gu"), `<@${mentions.get(display)}>`)
  }
  return out
}

/** The "@query" right before the caret, if the person is typing a mention. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(before)
  if (!match) return null
  return { start: before.length - match[2]!.length - 1, query: match[2]! }
}
