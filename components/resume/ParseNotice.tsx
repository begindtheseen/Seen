'use client'
// What Seen could not place when it read the résumé — said on every screen that shows an upload or uses the
// résumé (parse engineer's hand-off 2026-11-10: no silent loss). Reads doc.meta.fidelity and the parser's own
// `unplaced_lines` / `columns_read_across` warnings; names the lines and where they were kept, and offers the
// paste-text route for a two-column file. Renders nothing when every line was placed.
import Icon from '@/components/ui/Icon'
import s from './ParseNotice.module.css'

type Fid = { placed?: number; total?: number; unplaced?: { line: string; keptIn?: string }[] }
type DocLike = { meta?: { fidelity?: Fid; warnings?: { code?: string; message?: string }[] } } | null | undefined

export default function ParseNotice({ doc, onPaste }: { doc: DocLike; onPaste?: () => void }) {
  const fid = doc?.meta?.fidelity
  const unplaced = fid?.unplaced || []
  const columns = (doc?.meta?.warnings || []).some((w) => w.code === 'columns_read_across')
  if (!unplaced.length && !columns) return null
  const kept = unplaced[0]?.keptIn || 'Additional Information'
  return (
    <div className={s.box} role="status" data-testid="parse-notice">
      <Icon name="triangle-alert" size={16} className={s.ico} />
      <div className={s.body}>
        {unplaced.length > 0 && (
          <>
            <p className={s.p}>
              Seen could not tell where {unplaced.length === 1 ? 'one line' : `${unplaced.length} lines`} of your résumé belong{unplaced.length === 1 ? 's' : ''}, so {unplaced.length === 1 ? 'it is' : 'they are'} kept word for word under “{kept}”{typeof fid?.total === 'number' ? ` (${fid.placed} of ${fid.total} lines placed)` : ''}:
            </p>
            <ul className={s.list}>{unplaced.slice(0, 5).map((u, i) => <li key={i}>“{u.line.length > 90 ? `${u.line.slice(0, 90)}…` : u.line}”</li>)}</ul>
            {unplaced.length > 5 && <p className={s.fine}>and {unplaced.length - 5} more.</p>}
          </>
        )}
        {columns && (
          <p className={s.p}>Your file looks like two columns side by side, and its text came out mixed between them — check that each job, date and skill sits where you put it.{onPaste ? <> <button type="button" className={s.link} onClick={onPaste}>Paste the text instead</button></> : ' Pasting the text instead reads reliably.'}</p>
        )}
      </div>
    </div>
  )
}
