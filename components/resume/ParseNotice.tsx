'use client'
// What Seen could not place, or placed on weak evidence, when it read the résumé — said on every screen that
// shows an upload or uses the résumé (parse engineer's hand-off 2026-11-10: no silent loss; "ask, don't assert").
//  - doc.meta.fidelity.unplaced: lines kept word for word under "Additional Information", named;
//  - doc.meta.fidelity.uncertain: one question per line with one tap each (components/resume/refile.js) — where
//    the screen can save the document (`onRefile`, Résumé Studio); elsewhere the questions link to Studio;
//  - the `columns_read_across` warning: a plain explanation and the paste-text route.
// Renders nothing when every line was placed and nothing is in doubt.
import Icon from '@/components/ui/Icon'
import { uncertainQuestion } from './refile.js'
import s from './ParseNotice.module.css'

type Uncertain = { line: string; placedIn: string; why: string }
type Fid = { placed?: number; total?: number; unplaced?: { line: string; keptIn?: string }[]; uncertain?: Uncertain[] }
type DocLike = { meta?: { fidelity?: Fid; warnings?: { code?: string; message?: string }[] } } | null | undefined

export default function ParseNotice({ doc, onPaste, onRefile, studioHref }: { doc: DocLike; onPaste?: () => void; onRefile?: (u: Uncertain, answer: 'yes' | 'no') => void; studioHref?: string }) {
  const fid = doc?.meta?.fidelity
  const unplaced = fid?.unplaced || []
  const columns = (doc?.meta?.warnings || []).some((w) => w.code === 'columns_read_across')
  const asks = (fid?.uncertain || []).map((u) => ({ u, q: uncertainQuestion(doc || {}, u) })).filter((x) => x.q) as { u: Uncertain; q: NonNullable<ReturnType<typeof uncertainQuestion>> }[]
  if (!unplaced.length && !columns && !asks.length) return null
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
        {asks.length > 0 && (
          <div className={s.asks} data-testid="parse-uncertain">
            <p className={s.p}>{asks.length === 1 ? 'One line Seen was not sure about:' : `${asks.length} lines Seen was not sure about:`}</p>
            <ul className={s.qList}>
              {asks.slice(0, 4).map(({ u, q }, i) => (
                <li key={i} className={s.q}>
                  <p className={s.qText}>{q.question}</p>
                  {q.why && q.kind !== 'note' && <p className={s.fine}>Seen {q.why.replace(/^read /, 'read it ')}.</p>}
                  {q.kind === 'note'
                    ? (studioHref ? <a className={s.link} href={studioHref}>Add the employer in Résumé Studio</a> : <p className={s.fine}>Add the employer in the editor.</p>)
                    : onRefile
                      ? <div className={s.qBtns}>
                          <button type="button" className={s.choice} onClick={() => onRefile(u, 'yes')} data-testid="refile-yes">{q.yes}</button>
                          <button type="button" className={s.choice} onClick={() => onRefile(u, 'no')} data-testid="refile-no">{q.no}</button>
                        </div>
                      : studioHref ? <a className={s.link} href={studioHref}>Answer in Résumé Studio</a> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
