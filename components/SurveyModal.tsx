'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { Application } from '@/lib/types'

interface Question {
  key: string
  company: string
  prompt: string
  text: string
  options: string[]
  credit_value: number
  source: string
}

interface SurveyModalProps {
  apps: Application[]
  onClose: () => void
  onCreditsEarned: (total: number) => void
}

type Phase = 'loading' | 'intro' | 'question' | 'credit-pop' | 'done' | 'no-surveys' | 'error'

function pickBestApp(apps: Application[], exclude?: string): Application | null {
  const pool = exclude ? apps.filter(a => a.id !== exclude) : apps
  if (!pool.length) return null

  const ghosted = pool.filter(a => a.status === 'ghosted').sort((a, b) => b.appliedAt - a.appliedAt)
  const rejected = pool.filter(a => a.status === 'rejected').sort((a, b) => b.appliedAt - a.appliedAt)
  const hired = pool.filter(a => a.status === 'hired').sort((a, b) => b.appliedAt - a.appliedAt)
  const active = pool.filter(a => a.status === 'active').sort((a, b) => a.appliedAt - b.appliedAt)

  return ghosted[0] || rejected[0] || hired[0] || active[0] || null
}

export default function SurveyModal({ apps, onClose, onCreditsEarned }: SurveyModalProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [questions, setQuestions] = useState<Question[]>([])
  const [qIndex, setQIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [creditsEarned, setCreditsEarned] = useState(0)
  const [balance, setBalance] = useState(0)
  const [creditsLeft, setCreditsLeft] = useState(5)
  const [targetApp, setTargetApp] = useState<Application | null>(null)
  const [creditPopVal, setCreditPopVal] = useState(0)
  const [surveyedIds, setSurveyedIds] = useState<string[]>([])
  const [nextApp, setNextApp] = useState<Application | null>(null)
  const [creditPopVisible, setCreditPopVisible] = useState(false)
  const tokenRef = useRef<string | null>(null)

  async function loadSurvey(app: Application) {
    setPhase('loading')
    setQIndex(0)
    setSelected(null)
    setQuestions([])
    setTargetApp(app)

    try {
      const r = await fetch('/api/user-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({
          action: 'company_survey',
          company: app.company,
          role: app.role,
          status: app.status,
          stage: app.stage,
          days_since_apply: Math.floor((Date.now() - app.appliedAt) / 86400000),
        }),
      })
      const d = await r.json()
      if (!r.ok || d.error || !Array.isArray(d.questions)) {
        setPhase('error')
        return
      }
      if (!d.questions.length) {
        setPhase('no-surveys')
        return
      }
      setQuestions(d.questions)
      setBalance(d.balance || 0)
      setCreditsLeft(d.credits_left || 5)
      setPhase('intro')
    } catch {
      setPhase('error')
    }
  }

  useEffect(() => {
    async function init() {
      const session = await supabase.auth.getSession()
      const tok = session.data.session?.access_token
      if (!tok) {
        onClose()
        return
      }
      tokenRef.current = tok

      const pick = pickBestApp(apps)
      if (!pick) {
        onClose()
        return
      }

      try {
        await loadSurvey(pick)
      } catch {
        setPhase('error')
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit() {
    if (!selected || !tokenRef.current || submitting) return
    setSubmitting(true)
    const q = questions[qIndex]
    const r = await fetch('/api/user-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenRef.current}`,
      },
      body: JSON.stringify({
        action: 'submit_answer',
        question_key: q.key,
        answer: selected,
      }),
    })
    const d = await r.json()
    setSubmitting(false)

    if (d.ok) {
      const earned = creditsEarned + 1
      setCreditsEarned(earned)
      setBalance(d.balance || balance)
      // Each answered question earns a credit — refresh the Nav balance immediately, not
      // only when the whole survey completes.
      window.dispatchEvent(new CustomEvent('seen:credits-updated'))
      setCreditPopVal(1)
      setCreditPopVisible(true)
      setPhase('credit-pop')
      setTimeout(() => {
        setCreditPopVisible(false)
        setSelected(null)
        if (qIndex + 1 < questions.length) {
          setQIndex(i => i + 1)
          setPhase('question')
        } else {
          const newSurveyed = [...surveyedIds, targetApp!.id]
          setSurveyedIds(newSurveyed)
          const next = pickBestApp(apps, targetApp!.id)
          setNextApp(next)
          onCreditsEarned(earned)
          window.dispatchEvent(new CustomEvent('seen:credits-updated'))
          setPhase('done')
        }
      }, 800)
    } else {
      // Already answered or cap hit — just advance
      setSelected(null)
      if (qIndex + 1 < questions.length) {
        setQIndex(i => i + 1)
        setPhase('question')
      } else {
        const newSurveyed = [...surveyedIds, targetApp!.id]
        setSurveyedIds(newSurveyed)
        const next = pickBestApp(apps, targetApp!.id)
        setNextApp(next)
        setPhase('done')
      }
    }
  }

  async function handleSurveyAnother() {
    if (!nextApp) return
    const earned = creditsEarned
    setCreditsEarned(earned)
    await loadSurvey(nextApp)
  }

  const daysAgo = targetApp
    ? Math.floor((Date.now() - targetApp.appliedAt) / 86400000)
    : 0

  const progress = questions.length > 0 ? (qIndex / questions.length) * 100 : 0
  const questionsLeft = questions.length - qIndex - 1

  const companyLetter = targetApp?.company?.charAt(0).toUpperCase() || '?'

  // ── Styles ──────────────────────────────────────────────────────────────────

  const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.85)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    zIndex: 9900,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  }

  const modalStyle: React.CSSProperties = {
    maxWidth: 420,
    width: '100%',
    background: 'var(--surface)',
    borderRadius: 18,
    border: '1px solid rgba(99,102,241,.3)',
    boxShadow: '0 0 80px rgba(99,102,241,.25)',
    overflow: 'hidden',
    position: 'relative',
  }

  const paddingBox: React.CSSProperties = {
    padding: '28px 24px',
  }

  const closeBtn: React.CSSProperties = {
    position: 'absolute',
    top: 14,
    right: 16,
    background: 'none',
    border: 'none',
    color: 'var(--muted)',
    fontSize: 20,
    cursor: 'pointer',
    lineHeight: 1,
    padding: 4,
    zIndex: 1,
  }

  const avatarStyle: React.CSSProperties = {
    width: 56,
    height: 56,
    borderRadius: 14,
    background: 'linear-gradient(135deg, rgba(99,102,241,.3), rgba(99,102,241,.1))',
    border: '1px solid rgba(99,102,241,.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    fontFamily: 'var(--display)',
    fontWeight: 700,
    color: 'var(--indigo)',
    flexShrink: 0,
  }

  const hrStyle: React.CSSProperties = {
    border: 'none',
    borderTop: '1px solid var(--line)',
    margin: '20px 0',
  }

  const metaRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: 16,
    alignItems: 'center',
    fontSize: 13,
    color: 'var(--sub)',
    fontFamily: 'var(--mono)',
  }

  const pillStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 20,
    fontSize: 12,
    fontFamily: 'var(--mono)',
    background: 'rgba(99,102,241,.12)',
    color: 'var(--indigo)',
    border: '1px solid rgba(99,102,241,.2)',
  }

  const lossHookStyle: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--muted)',
    fontFamily: 'var(--body)',
    lineHeight: 1.5,
    marginTop: 8,
    textAlign: 'center' as const,
  }

  const primaryBtnStyle: React.CSSProperties = {
    width: '100%',
    padding: '13px 20px',
    background: 'var(--indigo)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontFamily: 'var(--body)',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 20,
    transition: 'opacity .15s',
  }

  const secondaryBtnStyle: React.CSSProperties = {
    width: '100%',
    padding: '11px 20px',
    background: 'none',
    color: 'var(--sub)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    fontSize: 14,
    fontFamily: 'var(--body)',
    cursor: 'pointer',
    marginTop: 10,
    transition: 'border-color .15s, color .15s',
  }

  const progressBarTrack: React.CSSProperties = {
    height: 4,
    background: 'var(--line)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 22,
  }

  const progressBarFill: React.CSSProperties = {
    height: '100%',
    width: `${progress}%`,
    background: 'linear-gradient(90deg, var(--indigo), #818cf8)',
    borderRadius: 2,
    transition: 'width .4s cubic-bezier(.4,0,.2,1)',
  }

  const questionCounterStyle: React.CSSProperties = {
    fontSize: 12,
    fontFamily: 'var(--mono)',
    color: 'var(--muted)',
    marginBottom: 6,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }

  const questionPromptStyle: React.CSSProperties = {
    fontSize: 12,
    fontFamily: 'var(--mono)',
    color: 'var(--indigo)',
    marginBottom: 10,
    opacity: 0.75,
  }

  const questionTextStyle: React.CSSProperties = {
    fontSize: 18,
    fontFamily: 'var(--display)',
    fontWeight: 700,
    color: 'var(--white)',
    lineHeight: 1.35,
    marginBottom: 18,
  }

  const creditPopStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,.5)',
    zIndex: 10,
    pointerEvents: 'none',
  }

  const creditPopInnerStyle: React.CSSProperties = {
    background: 'var(--card)',
    border: '1px solid rgba(99,102,241,.4)',
    borderRadius: 14,
    padding: '18px 32px',
    textAlign: 'center',
    animation: creditPopVisible ? 'surveyPopIn .35s cubic-bezier(.34,1.56,.64,1) forwards' : 'surveyPopOut .3s ease forwards',
    boxShadow: '0 0 40px rgba(99,102,241,.3)',
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Keyframe injection */}
      <style>{`
        @keyframes surveyPopIn {
          from { opacity: 0; transform: scale(.6) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes surveyPopOut {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(.8); }
        }
        @keyframes surveyFadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .survey-option-btn {
          display: block;
          width: 100%;
          padding: 11px 14px;
          text-align: left;
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: 9px;
          font-family: var(--body);
          font-size: 14px;
          color: var(--white);
          cursor: pointer;
          margin-bottom: 8px;
          transition: border-color .15s, background .15s;
          line-height: 1.4;
        }
        .survey-option-btn:hover {
          border-color: rgba(99,102,241,.5);
          background: rgba(99,102,241,.07);
        }
        .survey-option-btn.selected {
          border-color: var(--indigo);
          background: rgba(99,102,241,.14);
          color: #c7d2fe;
        }
        .survey-modal-animate {
          animation: surveyFadeIn .25s ease forwards;
        }
      `}</style>

      <div style={backdropStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={modalStyle}>

          {/* Close button */}
          <button style={closeBtn} onClick={onClose} aria-label="Close">×</button>

          {/* Credit pop overlay */}
          {phase === 'credit-pop' && (
            <div style={creditPopStyle}>
              <div style={creditPopInnerStyle}>
                <div style={{ fontSize: 36, marginBottom: 4 }}>✦</div>
                <div style={{
                  fontSize: 26,
                  fontFamily: 'var(--display)',
                  fontWeight: 700,
                  color: '#a5b4fc',
                  lineHeight: 1,
                }}>
                  +{creditPopVal}
                </div>
                <div style={{
                  fontSize: 13,
                  color: 'var(--sub)',
                  fontFamily: 'var(--mono)',
                  marginTop: 4,
                }}>
                  credit earned
                </div>
              </div>
            </div>
          )}

          {/* ── LOADING ── */}
          {phase === 'loading' && (
            <div style={{ ...paddingBox, textAlign: 'center', padding: '48px 24px' }}>
              <div style={{
                fontSize: 13,
                fontFamily: 'var(--mono)',
                color: 'var(--muted)',
                letterSpacing: '.08em',
              }}>
                loading survey…
              </div>
            </div>
          )}

          {/* ── INTRO ── */}
          {phase === 'intro' && targetApp && (
            <div style={paddingBox} className="survey-modal-animate">
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 18 }}>
                <div style={avatarStyle}>{companyLetter}</div>
                <div>
                  <div style={{
                    fontSize: 20,
                    fontFamily: 'var(--display)',
                    fontWeight: 700,
                    color: 'var(--white)',
                    lineHeight: 1.2,
                  }}>
                    {targetApp.company}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--sub)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                    {targetApp.role}
                  </div>
                </div>
              </div>

              <div style={metaRowStyle}>
                <span>Applied {daysAgo === 0 ? 'today' : `${daysAgo}d ago`}</span>
                <span style={{ color: 'var(--line)' }}>·</span>
                <span style={{
                  color: targetApp.status === 'ghosted' ? 'var(--amber)' :
                    targetApp.status === 'rejected' ? 'var(--red)' :
                      targetApp.status === 'hired' ? 'var(--green)' : 'var(--sub)',
                  textTransform: 'capitalize',
                }}>
                  {targetApp.status}
                </span>
              </div>

              <hr style={hrStyle} />

              <div style={{
                display: 'flex',
                justifyContent: 'space-around',
                textAlign: 'center',
                marginBottom: 18,
              }}>
                {[
                  { value: questions.length.toString(), label: 'questions' },
                  { value: '90s', label: 'to complete' },
                  { value: `+${questions.length}`, label: 'credits' },
                ].map(({ value, label }) => (
                  <div key={label}>
                    <div style={{
                      fontSize: 22,
                      fontFamily: 'var(--display)',
                      fontWeight: 700,
                      color: 'var(--indigo)',
                      lineHeight: 1,
                    }}>
                      {value}
                    </div>
                    <div style={{
                      fontSize: 11,
                      fontFamily: 'var(--mono)',
                      color: 'var(--muted)',
                      marginTop: 3,
                    }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                background: 'rgba(99,102,241,.07)',
                border: '1px solid rgba(99,102,241,.18)',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--sub)',
                fontFamily: 'var(--body)',
                lineHeight: 1.5,
              }}>
                Your experience at <strong style={{ color: 'var(--white)' }}>{targetApp.company}</strong> helps future applicants make better decisions. Real signal from real people.
              </div>

              <button
                style={primaryBtnStyle}
                onClick={() => setPhase('question')}
              >
                Start earning →
              </button>

              <p style={lossHookStyle}>
                Takes 90 seconds. Skip and this data never gets collected.
              </p>
            </div>
          )}

          {/* ── QUESTION ── */}
          {phase === 'question' && questions[qIndex] && (
            <div style={paddingBox} className="survey-modal-animate">
              {/* Progress bar */}
              <div style={progressBarTrack}>
                <div style={progressBarFill} />
              </div>

              {/* Counter row */}
              <div style={questionCounterStyle}>
                <span>
                  Question {qIndex + 1} of {questions.length}
                  {questionsLeft > 0 && (
                    <span style={{ color: 'var(--indigo)', marginLeft: 6 }}>
                      · {questionsLeft} left
                    </span>
                  )}
                </span>
                <span style={pillStyle}>✦ {creditsLeft} credits left</span>
              </div>

              {/* Company prompt context */}
              <div style={questionPromptStyle}>
                {questions[qIndex].prompt || `${targetApp?.company} · ${targetApp?.role}`}
              </div>

              {/* Question text */}
              <div style={questionTextStyle}>
                {questions[qIndex].text}
              </div>

              {/* Options */}
              <div style={{ marginBottom: 4 }}>
                {questions[qIndex].options.map(opt => (
                  <button
                    key={opt}
                    className={`survey-option-btn${selected === opt ? ' selected' : ''}`}
                    onClick={() => setSelected(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>

              {/* Submit */}
              <button
                style={{
                  ...primaryBtnStyle,
                  marginTop: 12,
                  opacity: selected && !submitting ? 1 : 0.45,
                  cursor: selected && !submitting ? 'pointer' : 'not-allowed',
                }}
                onClick={handleSubmit}
                disabled={!selected || submitting}
              >
                {submitting ? 'Submitting…' : 'Submit answer →'}
              </button>
            </div>
          )}

          {/* ── NO SURVEYS ── */}
          {phase === 'no-surveys' && (
            <div style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>✓</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.5rem' }}>All caught up!</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.65, marginBottom: '1.5rem' }}>
                You've answered all available questions for your applications.<br/>Check back after new applications are added.
              </div>
              <button onClick={onClose} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.72rem', borderRadius: 8, padding: '.6rem 1.25rem', cursor: 'pointer' }}>
                Close
              </button>
            </div>
          )}

          {/* ── ERROR ── */}
          {phase === 'error' && (
            <div style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚠️</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.5rem' }}>Couldn't load survey</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', lineHeight: 1.65, marginBottom: '1.5rem' }}>
                Something went wrong — tap retry to try again.
              </div>
              <button
                onClick={() => targetApp && loadSurvey(targetApp)}
                style={{ background: 'var(--indigo)', border: 'none', color: '#fff', fontFamily: 'var(--body)', fontWeight: 600, fontSize: '.8rem', borderRadius: 8, padding: '.6rem 1.25rem', cursor: 'pointer', marginBottom: '0.5rem', width: '100%' }}
              >
                Retry →
              </button>
              <button onClick={onClose} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.72rem', borderRadius: 8, padding: '.6rem 1.25rem', cursor: 'pointer', width: '100%' }}>
                Close
              </button>
            </div>
          )}

          {/* ── DONE ── */}
          {phase === 'done' && (
            <div style={{ ...paddingBox, textAlign: 'center' }} className="survey-modal-animate">
              <div style={{ fontSize: 48, marginBottom: 12, lineHeight: 1 }}>✦</div>

              <div style={{
                fontSize: 26,
                fontFamily: 'var(--display)',
                fontWeight: 700,
                color: 'var(--white)',
                marginBottom: 6,
              }}>
                You earned {creditsEarned} credit{creditsEarned !== 1 ? 's' : ''}!
              </div>

              <div style={{
                fontSize: 14,
                fontFamily: 'var(--mono)',
                color: 'var(--sub)',
                marginBottom: 18,
              }}>
                Balance: {balance} credits
              </div>

              {/* Contributor badge */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                borderRadius: 20,
                background: 'rgba(34,197,94,.1)',
                border: '1px solid rgba(34,197,94,.25)',
                color: 'var(--green)',
                fontSize: 13,
                fontFamily: 'var(--mono)',
                fontWeight: 600,
                marginBottom: 20,
              }}>
                ✓ You're a Seen contributor
              </div>

              <div style={{
                fontSize: 13,
                color: 'var(--sub)',
                fontFamily: 'var(--body)',
                lineHeight: 1.55,
                marginBottom: 22,
                padding: '0 8px',
              }}>
                Your intel is live — <strong style={{ color: 'var(--white)' }}>{targetApp?.company}</strong> applicants will see this data.
              </div>

              {nextApp && (
                <button
                  style={primaryBtnStyle}
                  onClick={handleSurveyAnother}
                >
                  Survey {nextApp.company} →
                </button>
              )}

              <button style={secondaryBtnStyle} onClick={onClose}>
                Done
              </button>
            </div>
          )}

        </div>
      </div>
    </>
  )
}
