'use client'

// "Before you apply" — help for a beginner, read from THIS posting only (lib/jobs/beforeYouApply.js):
//   • a calm caution when the posting asks the applicant to pay (training, a kit, a fee, a deposit);
//   • the posting's own "training is paid back if you leave before N months", as a plain fact;
//   • what the employer checks for a new hire, each line from one of the posting's sentences (hover shows it);
//   • the credential words the posting uses, each one tap from a short neutral definition (lib/jobs/termGlossary.js);
//   • one text link to the résumé check for this listing (the Optimize sheet's free fit check — no new flow).
// Shown for entry / trains-beginners / trade and oilfield postings, and for any posting that asks for money. Renders
// nothing until the reader has loaded (it is loaded on demand: the posting reader is not part of the page bundle).
import { useEffect, useState } from 'react'
import type { Job } from '@/lib/types'
import Icon from '@/components/ui/Icon'
import s from './BeforeYouApply.module.css'

interface Check { key: string; text: string; status: 'required' | 'preferred' | 'after_hire' | null; sentence: string }
interface Term { key: string; term: string; def: string }
interface Read {
  beginner: boolean
  entry: boolean
  checks: Check[]
  terms: Term[]
  payToTrain: { sentence: string } | null
  repayment: { months: number | null; sentence: string } | null
}

const WHEN: Record<string, string> = { preferred: 'preferred, not required', after_hire: 'the posting says this can come after you are hired' }

function repaymentLine(r: NonNullable<Read['repayment']>): string {
  if (!r.months) return 'This posting says training is paid back if you leave early.'
  const span = r.months % 12 === 0 && r.months >= 24 ? `${r.months / 12} years` : `${r.months} months`
  return `Training is paid back if you leave before ${span}.`
}

export default function BeforeYouApply({ job, onCheckResume }: {
  job: Pick<Job, 'id' | 'title' | 'description' | 'trains_beginners'>
  /** Opens the résumé check for this listing (the Optimize sheet). Left out where the listing cannot be optimized. */
  onCheckResume?: () => void
}) {
  const [read, setRead] = useState<Read | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const { id, title, description, trains_beginners: trains } = job

  useEffect(() => {
    let live = true
    setRead(null); setOpen(null)
    import('@/lib/jobs/beforeYouApply.js')
      .then(m => { if (live) setRead(m.beforeYouApply({ title, description, trains_beginners: trains }) as unknown as Read | null) })
      .catch(() => { /* no reader = no block */ })
    return () => { live = false }
  }, [id, title, description, trains])

  if (!read) return null
  const { checks, terms, payToTrain, repayment } = read
  if (!checks.length && !terms.length && !payToTrain && !repayment) return null
  const openTerm = terms.find(t => t.key === open) || null

  return (
    <section className={s.card} aria-label="Before you apply" data-testid="before-you-apply">
      <h3 className="ui-eyebrow">Before you apply</h3>

      {payToTrain && (
        // FTC job-scam guidance (lib/jobs/payToTrain.js): an ask for money to get hired is the warning sign.
        <p className={s.caution} role="note" data-testid="pay-to-train">
          <Icon name="triangle-alert" size={14} />
          <span>
            <b>Caution:</b> This posting asks you to pay for training or a fee. Honest employers don&apos;t charge you to get hired.
            <span className={s.quote}>It says: “{payToTrain.sentence.length > 220 ? `${payToTrain.sentence.slice(0, 217).trimEnd()}…` : payToTrain.sentence}”</span>
          </span>
        </p>
      )}
      {repayment && (
        <p className={s.fact} title={`From the posting: ${repayment.sentence}`} data-testid="training-repayment">
          <Icon name="info" size={14} />
          <span>{repaymentLine(repayment)}</span>
        </p>
      )}

      {checks.length > 0 && (
        <>
          {/* "for a beginner" only when the posting takes beginners (a journeyman / experienced posting's asks are just asks) */}
          <h4 className={s.h}>{read.entry ? 'What they check for a beginner' : 'What the posting asks for'}</h4>
          <ul className={s.list}>
            {checks.map(c => (
              <li key={c.key} className={s.item} title={c.sentence ? `From the posting: ${c.sentence}` : undefined}>
                <Icon name="check" size={14} />
                <span>{c.text}{c.status && WHEN[c.status] ? <span className={s.when}> · {WHEN[c.status]}</span> : null}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {terms.length > 0 && (
        <>
          <div className={s.terms}>
            <span>Words in this posting:</span>
            {terms.map(t => (
              <button
                key={t.key}
                type="button"
                className={s.term}
                aria-expanded={open === t.key}
                aria-controls="bya-def"
                onClick={() => setOpen(o => (o === t.key ? null : t.key))}
              >
                {t.term}<Icon name="circle-help" size={12} />
              </button>
            ))}
          </div>
          {openTerm && <p id="bya-def" className={s.def} role="note"><b>{openTerm.term}.</b> {openTerm.def}</p>}
        </>
      )}

      {onCheckResume && (
        <button type="button" className={s.link} onClick={onCheckResume} data-testid="bya-check-resume">
          Check your résumé against this<Icon name="arrow-right" size={14} />
        </button>
      )}
    </section>
  )
}
