import { Fragment, type ReactNode } from "react"
import { Link } from "react-router-dom"
import type { User } from "./types"

/**
 * Renders message text into React elements (never HTML strings), so nothing a person
 * types can run as code. Supports <@mentions>, #channel links, `code`, ``` blocks,
 * **bold**, _italic_ and web links.
 */

export interface MarkupContext {
  users: Map<string, User>
  meId: string
  channels: Map<string, string>
}

const INLINE = new RegExp(
  [
    String.raw`<@(?<mention>[a-f\d]{24})>`,
    String.raw`\x60(?<code>[^\x60\n]+)\x60`,
    String.raw`\*\*(?<bold>(?=\S)[\s\S]*?\S)\*\*`,
    String.raw`(?<![\p{L}\p{N}_])_(?<italic>(?=\S)[^_\n]*?\S)_(?![\p{L}\p{N}_])`,
    String.raw`(?<url>https?:\/\/[^\s<>]*[^\s<>.,:;"')\]!?])`,
    String.raw`(?<![\p{L}\p{N}&\/])#(?<channel>[a-z0-9][a-z0-9-]{1,39})`,
  ].join("|"),
  "gu",
)

function inline(text: string, ctx: MarkupContext, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const match of text.matchAll(INLINE)) {
    const start = match.index
    if (start > last) out.push(text.slice(last, start))
    const g = match.groups!
    const key = `${keyPrefix}-${i++}`
    if (g.mention) {
      const user = ctx.users.get(g.mention)
      const isMe = g.mention === ctx.meId
      out.push(
        <span
          key={key}
          className={
            isMe
              ? "rounded-[4px] bg-marigold/35 px-0.5 font-semibold text-foreground"
              : "rounded-[4px] bg-primary/10 px-0.5 font-semibold text-primary"
          }
        >
          @{user?.name ?? "someone"}
        </span>,
      )
    } else if (g.code) {
      out.push(<code key={key}>{g.code}</code>)
    } else if (g.bold) {
      out.push(<strong key={key}>{inline(g.bold, ctx, key)}</strong>)
    } else if (g.italic) {
      out.push(<em key={key}>{inline(g.italic, ctx, key)}</em>)
    } else if (g.url) {
      out.push(
        <a key={key} href={g.url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2">
          {g.url.replace(/^https?:\/\//, "")}
        </a>,
      )
    } else if (g.channel) {
      const id = ctx.channels.get(g.channel)
      out.push(
        id ? (
          <Link key={key} to={`/c/${id}`} className="font-semibold text-primary hover:underline">
            #{g.channel}
          </Link>
        ) : (
          `#${g.channel}`
        ),
      )
    }
    last = start + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function renderMessageText(text: string, ctx: MarkupContext): ReactNode {
  const parts = text.split(/```(?:[a-z0-9+-]*\n)?([\s\S]*?)```/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <pre key={i}>
        <code>{part.replace(/\n$/, "")}</code>
      </pre>
    ) : (
      <Fragment key={i}>{inline(part.replace(/^\n|\n$/g, ""), ctx, String(i))}</Fragment>
    ),
  )
}

/** A message that is only one to three emoji is shown bigger. */
export function isJumboEmoji(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 24) return false
  if (!/^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u.test(trimmed)) return false
  if (/^[\d#*\s]+$/.test(trimmed)) return false
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed.replace(/\s/g, ""))]
  return segments.length <= 3
}

/** Plain text for previews and notifications. */
export function plainText(text: string, users: Map<string, User>): string {
  return text
    .replace(/<@([a-f\d]{24})>/gi, (_m, id: string) => `@${users.get(id)?.name ?? "someone"}`)
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
