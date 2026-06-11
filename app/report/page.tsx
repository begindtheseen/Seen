'use client'

import { useState } from 'react'

type Outcome = 'ghosted' | 'autoreject' | 'human' | 'waiting' | ''
type Stage = 'application' | 'phone' | 'interview' | 'final' | ''

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1.5px solid var(--line2)',
  borderRadius: 8,
  padding: '.62rem .9rem',
  color: 'var(--white)',
  fontFamily: 'var(--body)',
  fontSize: '.875rem',
  outline: 'none',
  caretColor: 'var(--blue)',
  marginBottom: '.85rem',
}

const selectStyle: React.CSSProperties = {
  ...{} as React.CSSProperties,
  width: '100%',
  background: 'var(--surface)',
  border: '1.5px solid var(--line2)',
  borderRadius: 8,
  padding: '.62rem .9rem',
  color: 'var(--white)',
  fontFamily: 'var(--body)',
  fontSize: '.875rem',
  outline: 'none',
  cursor: 'pointer',
  marginBottom: '.85rem',
}

const lbl = (text: string) => (
  <label style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.3rem' }}>
    {text}
  </label>
)

function RadioGroup<T extends string>({
  name, options, value, onChange,
}: {
  name: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
      {options.map(o => (
        <label
          key={o.value}
          style={{
            display: 'flex', alignItems: 'center', gap: '.35rem',
            background: value === o.value ? 'var(--bdim)' : 'var(--surface)',
            border: `1.5px solid ${value === o.value ? 'var(--blue)' : 'var(--line2)'}`,
            borderRadius: 8, padding: '.45rem .85rem', cursor: 'pointer',
            fontFamily: 'var(--mono)', fontSize: '.68rem', color: value === o.value ? 'var(--white)' : 'var(--sub)',
            transition: 'all .15s',
          }}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            style={{ display: 'none' }}
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}

export default function ReportPage() {
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [location, setLocation] = useState('')
  const [platform, setPlatform] = useState('')
  const [outcome, setOutcome] = useState<Outcome>('')
  const [stage, setStage] = useState<Stage>('')
  const [rounds, setRounds] = useState('0')
  const [unpaid, setUnpaid] = useState('na')
  const [experience, setExperience] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit() {
    if (!company.trim() || !role.trim() || !location.trim()) {
      setError('Company, job title, and location are required.')
      return
    }
    if (!outcome) {
      setError('Select an outcome.')
      return
    }
    setLoading(true)
    setError('')

    // Moderate first
    try {
      const modRes = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'moderate', company, role, location, experience: notes }),
      })
      if (modRes.ok) {
        const mod = await modRes.json() as { ok: boolean; issues?: string[] }
        if (!mod.ok && mod.issues?.length) {
          setError(mod.issues[0])
          setLoading(false)
          return
        }
      }
    } catch { /* moderate is non-blocking */ }

    // Submit
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          company: company.trim().toLowerCase(),
          role: role.trim(),
          location: location.trim(),
          platform: platform.trim(),
          outcome,
          ghost_stage: outcome === 'ghosted' ? stage : null,
          rounds: parseInt(rounds) || 0,
          unpaid_work: unpaid,
          experience_level: experience,
          report_text: notes.trim() || null,
        }),
      })
      if (!res.ok) throw new Error('Submit failed')
      setDone(true)
    } catch {
      setError('Submission failed. Please try again.')
    }
    setLoading(false)
  }

  if (done) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ textAlign: 'center', maxWidth: 440 }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.5rem' }}>
            Report submitted
          </h2>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
            Thank you. Your experience has been added to the transparency feed and will update {company}&apos;s score in real time.
          </p>
          <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center' }}>
            <a href="/feed" style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--sub)', textDecoration: 'none' }}>
              View feed →
            </a>
            <a href={`/company/${encodeURIComponent(company.trim().toLowerCase().replace(/\s+/g, '-'))}`} style={{ background: 'var(--blue)', border: 'none', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--mono)', fontSize: '.7rem', color: '#fff', textDecoration: 'none' }}>
              See {company} score →
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '2.5rem 2rem' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--blue)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 22, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
          Anonymous report
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.75rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.25rem' }}>
          Report your experience
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.82rem', fontWeight: 300, marginBottom: '2rem' }}>
          Takes 60 seconds. Helps thousands of job seekers tonight. 100% anonymous.
        </p>

        {error && (
          <div style={{ background: 'var(--rdim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '.72rem 1rem', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.75rem' }}>
          {/* Listing details */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
              The listing
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
              <div>
                {lbl('Company name *')}
                <input type="text" placeholder="e.g. Stripe" value={company} onChange={e => setCompany(e.target.value)} style={inputStyle} />
              </div>
              <div>
                {lbl('Job title *')}
                <input type="text" placeholder="e.g. Software Engineer" value={role} onChange={e => setRole(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
              <div>
                {lbl('City, State *')}
                <input type="text" placeholder="e.g. Austin, TX" value={location} onChange={e => setLocation(e.target.value)} style={inputStyle} />
              </div>
              <div>
                {lbl('Platform (optional)')}
                <input type="text" placeholder="LinkedIn, Indeed, Greenhouse..." value={platform} onChange={e => setPlatform(e.target.value)} style={inputStyle} />
              </div>
            </div>
          </div>

          {/* Outcome */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
              What happened?
            </div>
            {lbl('Outcome *')}
            <RadioGroup
              name="outcome"
              value={outcome}
              onChange={setOutcome}
              options={[
                { value: 'ghosted', label: '👻 Ghosted' },
                { value: 'autoreject', label: '🤖 Auto-rejected' },
                { value: 'human', label: '💬 Got a response' },
                { value: 'waiting', label: '⏳ Still waiting' },
              ]}
            />

            {outcome === 'ghosted' && (
              <>
                {lbl('Ghosted after which stage?')}
                <RadioGroup
                  name="stage"
                  value={stage}
                  onChange={setStage}
                  options={[
                    { value: 'application', label: 'Application' },
                    { value: 'phone', label: 'Phone screen' },
                    { value: 'interview', label: 'Interview' },
                    { value: 'final', label: 'Final round' },
                  ]}
                />
              </>
            )}
          </div>

          {/* Details */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
              Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.75rem' }}>
              <div>
                {lbl('Interview rounds')}
                <select value={rounds} onChange={e => setRounds(e.target.value)} style={selectStyle}>
                  {['0','1','2','3','4','5','6+'].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                {lbl('Unpaid work?')}
                <select value={unpaid} onChange={e => setUnpaid(e.target.value)} style={selectStyle}>
                  <option value="na">None</option>
                  <option value="take-home">Take-home test</option>
                  <option value="project">Full project</option>
                  <option value="presentation">Presentation</option>
                </select>
              </div>
              <div>
                {lbl('Your level')}
                <select value={experience} onChange={e => setExperience(e.target.value)} style={selectStyle}>
                  <option value="">Prefer not to say</option>
                  <option value="entry">Entry level</option>
                  <option value="mid">Mid level</option>
                  <option value="senior">Senior</option>
                  <option value="lead">Lead / Staff</option>
                </select>
              </div>
            </div>
            {lbl('Anything else? (optional)')}
            <textarea
              placeholder="What stood out about this process? How did it make you feel?"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              style={{ width: '100%', background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 8, padding: '.72rem 1rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem', outline: 'none', resize: 'vertical', lineHeight: 1.6, caretColor: 'var(--blue)' }}
            />
          </div>

          <button
            onClick={submit}
            disabled={loading}
            style={{ width: '100%', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', color: '#fff', border: 'none', borderRadius: 8, padding: '.85rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, boxShadow: '0 0 20px rgba(59,130,246,0.3)' }}
          >
            {loading ? 'Submitting...' : 'Submit report →'}
          </button>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', textAlign: 'center', marginTop: '.75rem' }}>
            100% anonymous · No account required · No personal data stored
          </p>
        </div>
      </div>
    </div>
  )
}
