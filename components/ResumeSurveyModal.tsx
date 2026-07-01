'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

interface SurveyQuestion {
  key: string
  text: string
  options: string[]
}

interface ResumeSurvey {
  company: string
  role: string
  company_norm: string
  questions: SurveyQuestion[]
}

interface ResumeSurveyModalProps {
  onClose: () => void
  onCreditsEarned?: (awarded: number) => void
  // When there's no résumé survey to show (no résumé / no employers parsed / all done),
  // the host can fall back to another survey source instead of the empty state.
  onExhausted?: (reason: string) => void
}

type Phase = 'loading' | 'intro' | 'question' | 'credit-pop' | 'done' | 'none' | 'error'

// Friendly copy for the empty-state reasons the API can return.
const NONE_COPY: Record<string, { title: string; body: string }> = {
  no_resume:     { title: 'Add your résumé first', body: 'Upload your résumé on the Résumé page, then come back to earn credits by sharing your past hiring experiences.' },
  no_employment: { title: 'No work history found', body: "We couldn't read any past employers from your résumé. Make sure it lists your companies and dates." },
  all_surveyed:  { title: 'All caught up!', body: "You've shared intel on every company in your work history. Thank you — that data makes Seen more valuable for everyone." },
  daily_cap:     { title: "You've hit today's cap", body: "You've earned the max credits from surveys today. Come back tomorrow for more." },
}

export default function ResumeSurveyModal({ onClose, onCreditsEarned, onExhausted }: ResumeSurveyModalProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [survey, setSurvey] = useState<ResumeSurvey | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [awarded, setAwarded] = useState(0)
  const [balance, setBalance] = useState(0)
  const [creditsLeft, setCreditsLeft] = useState(5)
  const [noneReason, setNoneReason] = useState<string>('all_surveyed')
  const [popVisible, setPopVisible] = useState(false)
  const tokenRef = useRef<string | null>(null)

  async function loadSurvey() {
    setPhase('loading')
    setQIndex(0)
    setSelected(null)
    setAnswers({})
    try {
      const r = await fetch('/api/user-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({ action: 'resume_survey' }),
      })
      const d = await r.json()
      if (!r.ok || d.error) { setPhase('error'); return }
      setBalance(d.balance || 0)
      setCreditsLeft(d.credits_left ?? 5)
      if (!d.survey || !Array.isArray(d.survey.questions) || !d.survey.questions.length) {
        const reason = d.reason || 'all_surveyed'
        // If a host provided a fallback (e.g. the tracker), hand off rather than dead-ending —
        // except on daily_cap, where any other survey would be capped too.
        if (onExhausted && reason !== 'daily_cap') { onExhausted(reason); return }
        setNoneReason(reason)
        setPhase('none')
        return
      }
      setSurvey(d.survey)
      setPhase('intro')
    } catch {
      setPhase('error')
    }
  }

  useEffect(() => {
    async function init() {
      const session = await supabase.auth.getSession()
      const tok = session.data.session?.access_token
      if (!tok) { onClose(); return }
      tokenRef.current = tok
      await loadSurvey()
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function chooseAndAdvance() {
    if (!selected || !survey) return
    const q = survey.questions[qIndex]
    const nextAnswers = { ...answers, [q.key]: selected }
    setAnswers(nextAnswers)
    setSelected(null)
    if (qIndex + 1 < survey.questions.length) {
      setQIndex(i => i + 1)
    } else {
      submitSurvey(nextAnswers)
    }
  }

  async function submitSurvey(finalAnswers: Record<string, string>) {
    if (!survey || !tokenRef.current) return
    setSubmitting(true)
    setPhase('loading')
    try {
      const r = await fetch('/api/user-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({
          action: 'submit_resume_survey',
          company: survey.company,
          role: survey.role,
          answers: finalAnswers,
        }),
      })
      const d = await r.json()
      setSubmitting(false)
      if (!r.ok || (!d.ok && d.error !== 'already_surveyed')) { setPhase('error'); return }
      const got = d.awarded || 0
      setAwarded(got)
      setBalance(d.balance ?? balance)
      if (got > 0) {
        setPopVisible(true)
        setPhase('credit-pop')
        window.dispatchEvent(new Event('seen:credits-updated'))
        onCreditsEarned?.(got)
        setTimeout(() => { setPopVisible(false); setPhase('done') }, 900)
      } else {
        setPhase('done')
      }
    } catch {
      setSubmitting(false)
      setPhase('error')
    }
  }

  const progress = survey ? (qIndex / survey.questions.length) * 100 : 0
  const companyLetter = survey?.company?.charAt(0).toUpperCase() || '?'

  // ── Styles (mirrors components/SurveyModal.tsx) ──────────────────────────────
  const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', zIndex: 9900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
  const modal: React.CSSProperties = { maxWidth: 420, width: '100%', background: 'var(--surface)', borderRadius: 18, border: '1px solid rgba(99,102,241,.3)', boxShadow: '0 0 80px rgba(99,102,241,.25)', overflow: 'hidden', position: 'relative' }
  const pad: React.CSSProperties = { padding: '28px 24px' }
  const close: React.CSSProperties = { position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4, zIndex: 1 }
  const avatar: React.CSSProperties = { width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg, rgba(99,102,241,.3), rgba(99,102,241,.1))', border: '1px solid rgba(99,102,241,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--indigo)', flexShrink: 0 }
  const primaryBtn: React.CSSProperties = { width: '100%', padding: '13px 20px', background: 'var(--indigo)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontFamily: 'var(--body)', fontWeight: 600, cursor: 'pointer', marginTop: 20 }
  const secondaryBtn: React.CSSProperties = { width: '100%', padding: '11px 20px', background: 'none', color: 'var(--sub)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, fontFamily: 'var(--body)', cursor: 'pointer', marginTop: 10 }
  const track: React.CSSProperties = { height: 4, background: 'var(--line)', borderRadius: 2, overflow: 'hidden', marginBottom: 22 }
  const fill: React.CSSProperties = { height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, var(--indigo), #818cf8)', borderRadius: 2, transition: 'width .4s cubic-bezier(.4,0,.2,1)' }
  const popOuter: React.CSSProperties = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.5)', zIndex: 10, pointerEvents: 'none' }
  const popInner: React.CSSProperties = { background: 'var(--card)', border: '1px solid rgba(99,102,241,.4)', borderRadius: 14, padding: '18px 32px', textAlign: 'center', animation: popVisible ? 'rsPopIn .35s cubic-bezier(.34,1.56,.64,1) forwards' : 'rsPopOut .3s ease forwards', boxShadow: '0 0 40px rgba(99,102,241,.3)' }

  const q = survey?.questions[qIndex]

  return (
    <>
      <style>{`
        @keyframes rsPopIn { from { opacity:0; transform:scale(.6) translateY(8px);} to { opacity:1; transform:scale(1) translateY(0);} }
        @keyframes rsPopOut { from { opacity:1; transform:scale(1);} to { opacity:0; transform:scale(.8);} }
        @keyframes rsFade { from { opacity:0; transform:translateY(10px);} to { opacity:1; transform:translateY(0);} }
        .rs-opt { display:block; width:100%; padding:11px 14px; text-align:left; background:var(--card); border:1px solid var(--line); border-radius:9px; font-family:var(--body); font-size:14px; color:var(--white); cursor:pointer; margin-bottom:8px; transition:border-color .15s, background .15s; line-height:1.4; }
        .rs-opt:hover { border-color:rgba(99,102,241,.5); background:rgba(99,102,241,.07); }
        .rs-opt.sel { border-color:var(--indigo); background:rgba(99,102,241,.14); color:#c7d2fe; }
        .rs-anim { animation: rsFade .25s ease forwards; }
      `}</style>

      <div style={backdrop} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={modal}>
          <button style={close} onClick={onClose} aria-label="Close">×</button>

          {phase === 'credit-pop' && (
            <div style={popOuter}>
              <div style={popInner}>
                <div style={{ fontSize: 36, marginBottom: 4 }}>✦</div>
                <div style={{ fontSize: 26, fontFamily: 'var(--display)', fontWeight: 700, color: '#a5b4fc', lineHeight: 1 }}>+{awarded}</div>
                <div style={{ fontSize: 13, color: 'var(--sub)', fontFamily: 'var(--mono)', marginTop: 4 }}>credits earned</div>
              </div>
            </div>
          )}

          {phase === 'loading' && (
            <div style={{ ...pad, textAlign: 'center', padding: '48px 24px' }}>
              <div style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--muted)', letterSpacing: '.08em' }}>
                {submitting ? 'saving your intel…' : 'reading your résumé…'}
              </div>
            </div>
          )}

          {phase === 'intro' && survey && (
            <div style={pad} className="rs-anim">
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 18 }}>
                <div style={avatar}>{companyLetter}</div>
                <div>
                  <div style={{ fontSize: 20, fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--white)', lineHeight: 1.2 }}>{survey.company}</div>
                  {survey.role && <div style={{ fontSize: 13, color: 'var(--sub)', fontFamily: 'var(--mono)', marginTop: 2 }}>{survey.role}</div>}
                </div>
              </div>

              <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--indigo)', marginBottom: 14 }}>
                ✦ We spotted {survey.company} on your résumé.
              </div>

              <div style={{ background: 'rgba(99,102,241,.07)', border: '1px solid rgba(99,102,241,.18)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--sub)', fontFamily: 'var(--body)', lineHeight: 1.5 }}>
                Tell us what it was like applying to <strong style={{ color: 'var(--white)' }}>{survey.company}</strong>. Your answers become real hiring intel future applicants can see — and you earn <strong style={{ color: '#a5b4fc' }}>AI credits</strong> for it.
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', margin: '18px 0' }}>
                {[
                  { v: String(survey.questions.length), l: 'questions' },
                  { v: '60s', l: 'to finish' },
                  { v: '+2', l: 'credits' },
                ].map(({ v, l }) => (
                  <div key={l}>
                    <div style={{ fontSize: 22, fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--indigo)', lineHeight: 1 }}>{v}</div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', marginTop: 3 }}>{l}</div>
                  </div>
                ))}
              </div>

              <button style={primaryBtn} onClick={() => setPhase('question')}>Start earning →</button>
              <p style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--body)', lineHeight: 1.5, marginTop: 8, textAlign: 'center' }}>
                The more data we have, the more valuable every company score becomes.
              </p>
            </div>
          )}

          {phase === 'question' && q && survey && (
            <div style={pad} className="rs-anim">
              <div style={track}><div style={fill} /></div>
              <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>Question {qIndex + 1} of {survey.questions.length}</span>
                <span style={{ color: 'var(--indigo)' }}>✦ {creditsLeft} left today</span>
              </div>
              <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--indigo)', marginBottom: 10, opacity: .75 }}>{survey.company}</div>
              <div style={{ fontSize: 18, fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--white)', lineHeight: 1.35, marginBottom: 18 }}>{q.text}</div>
              <div style={{ marginBottom: 4 }}>
                {q.options.map(opt => (
                  <button key={opt} className={`rs-opt${selected === opt ? ' sel' : ''}`} onClick={() => setSelected(opt)}>{opt}</button>
                ))}
              </div>
              <button
                style={{ ...primaryBtn, marginTop: 12, opacity: selected ? 1 : 0.45, cursor: selected ? 'pointer' : 'not-allowed' }}
                onClick={chooseAndAdvance}
                disabled={!selected}
              >
                {qIndex + 1 < survey.questions.length ? 'Next →' : 'Finish & earn →'}
              </button>
            </div>
          )}

          {phase === 'done' && (
            <div style={{ ...pad, textAlign: 'center' }} className="rs-anim">
              <div style={{ fontSize: 48, marginBottom: 12, lineHeight: 1 }}>✦</div>
              <div style={{ fontSize: 26, fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--white)', marginBottom: 6 }}>
                {awarded > 0 ? `You earned ${awarded} credit${awarded !== 1 ? 's' : ''}!` : 'Intel recorded'}
              </div>
              <div style={{ fontSize: 14, fontFamily: 'var(--mono)', color: 'var(--sub)', marginBottom: 18 }}>Balance: {balance} credits</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.25)', color: 'var(--green)', fontSize: 13, fontFamily: 'var(--mono)', fontWeight: 600, marginBottom: 20 }}>
                ✓ You're a Seen contributor
              </div>
              <div style={{ fontSize: 13, color: 'var(--sub)', fontFamily: 'var(--body)', lineHeight: 1.55, marginBottom: 22, padding: '0 8px' }}>
                Your intel is live — <strong style={{ color: 'var(--white)' }}>{survey?.company}</strong> applicants will see this data.
              </div>
              <button style={primaryBtn} onClick={loadSurvey}>Survey another company →</button>
              <button style={secondaryBtn} onClick={onClose}>Done</button>
            </div>
          )}

          {phase === 'none' && (
            <div style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>✓</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.5rem' }}>
                {(NONE_COPY[noneReason] || NONE_COPY.all_surveyed).title}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.65, marginBottom: '1.5rem' }}>
                {(NONE_COPY[noneReason] || NONE_COPY.all_surveyed).body}
              </div>
              <button onClick={onClose} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.72rem', borderRadius: 8, padding: '.6rem 1.25rem', cursor: 'pointer' }}>Close</button>
            </div>
          )}

          {phase === 'error' && (
            <div style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚠️</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.5rem' }}>Something went wrong</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.65, marginBottom: '1.5rem' }}>Tap retry to try again.</div>
              <button onClick={loadSurvey} style={{ background: 'var(--indigo)', border: 'none', color: '#fff', fontFamily: 'var(--body)', fontWeight: 600, fontSize: '.8rem', borderRadius: 8, padding: '.6rem 1.25rem', cursor: 'pointer', marginBottom: '0.5rem', width: '100%' }}>Retry →</button>
              <button onClick={onClose} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.72rem', borderRadius: 8, padding: '.6rem 1.25rem', cursor: 'pointer', width: '100%' }}>Close</button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
