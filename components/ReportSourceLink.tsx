// Attribution link for a third-party report row (Reddit thread / public review site). The URL comes
// from lib/reportSource.ts reportSourceLink(), which only returns one for third-party rows whose
// trailing URL belongs to the row's own source site. nofollow + ugc: Seen does not vouch for it.
import type { CSSProperties } from 'react'

export default function ReportSourceLink({ url, host, posted, style, className }: { url: string; host: string; posted?: string | null; style?: CSSProperties; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="nofollow ugc noopener noreferrer"
      title={`Open the original public post on ${host}`}
      className={className}
      style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--blue)', textDecoration: 'none', ...style }}
    >
      Source: {host}{posted ? ` · posted ${posted}` : ''} ↗
    </a>
  )
}
