'use client'

import { useRouter } from 'next/navigation'

// First-run getting-started guide shown at the top of the dashboard. It reflects REAL
// progress (résumé uploaded? first application tracked? a company checked?) so it doubles
// as a live checklist and disappears on its own once the user is set up. Dismissible.
//
// This exists because new users landed cold on the dashboard with no idea what to do first.
// The three steps are the core loop: know yourself (résumé) → track your search → check
// companies before you apply.

export interface OnboardingState {
  hasResume: boolean
  appsCount: number
  companiesChecked: number
}

export default function WelcomeOnboarding({
  name,
  state,
  onDismiss,
}: {
  name: string
  state: OnboardingState
  onDismiss: () => void
}) {
  const router = useRouter()

  const steps = [
    {
      done: state.hasResume,
      icon: '📄',
      title: 'Add your résumé',
      sub: 'Unlocks résumé-fit scoring and lets you earn AI credits',
      cta: 'Upload résumé',
      go: () => router.push('/resume'),
    },
    {
      done: state.appsCount > 0,
      icon: '✓',
      title: 'Track your first application',
      sub: 'See your real response and ghost rates as outcomes come in',
      cta: 'Find jobs',
      go: () => router.push('/jobs'),
    },
    {
      done: state.companiesChecked > 0,
      icon: '🏢',
      title: 'Check a company before you apply',
      sub: 'Know who actually responds — and who ghosts — up front',
      cta: 'Browse companies',
      go: () => router.push('/companies'),
    },
  ]

  const doneCount = steps.filter(s => s.done).length
  const nextIdx = steps.findIndex(s => !s.done)

  return (
    <section
      style={{
        position: 'relative',
        background: 'linear-gradient(160deg, rgba(99,102,241,.10), rgba(59,130,246,.05) 60%, transparent)',
        border: '1px solid rgba(99,102,241,.28)',
        borderRadius: 16,
        padding: '1.15rem 1.15rem 1.25rem',
        boxShadow: '0 0 40px rgba(99,102,241,.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '.75rem', marginBottom: '.35rem' }}>
        <div style={{ minWidth: 0 }}>
          <div className="deyebrow" style={{ color: 'var(--indigo)' }}>✦ Getting started</div>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: '.35rem 0 .2rem' }}>
            Welcome to Seen, {name} 👋
          </h2>
          <p style={{ fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.55, margin: 0 }}>
            Seen shows you which companies actually respond — so you stop wasting applications. Three quick steps to set you up:
          </p>
        </div>
        <button
          onClick={onDismiss}
          title="Hide getting started"
          style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: '.95rem', lineHeight: 1, padding: '.15rem .25rem' }}
        >✕</button>
      </div>

      {/* Progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', margin: '.85rem 0 1rem' }}>
        <div style={{ flex: 1, height: 5, background: 'var(--line2)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${(doneCount / steps.length) * 100}%`, background: 'linear-gradient(90deg,var(--blue),var(--indigo))', borderRadius: 4, transition: 'width .4s ease' }} />
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', flexShrink: 0, fontWeight: 700 }}>{doneCount}/{steps.length} done</span>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {steps.map((s, i) => {
          const isNext = i === nextIdx
          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: '.7rem',
                background: s.done ? 'transparent' : 'var(--surface)',
                border: `1px solid ${isNext ? 'rgba(99,102,241,.4)' : 'var(--line2)'}`,
                borderRadius: 11, padding: '.65rem .7rem',
                opacity: s.done ? 0.72 : 1,
              }}
            >
              <span
                style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '.8rem',
                  background: s.done ? 'rgba(16,185,129,.15)' : 'var(--raised)',
                  border: `1px solid ${s.done ? 'rgba(16,185,129,.4)' : 'var(--line2)'}`,
                  color: s.done ? 'var(--green)' : 'var(--sub)',
                }}
              >{s.done ? '✓' : s.icon}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: '.8rem', fontWeight: 700, color: s.done ? 'var(--sub)' : 'var(--white)', textDecoration: s.done ? 'line-through' : 'none' }}>{s.title}</div>
                {!s.done && <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', marginTop: '.15rem', lineHeight: 1.45 }}>{s.sub}</div>}
              </div>
              {!s.done && (
                <button
                  onClick={s.go}
                  className={isNext ? 'dbtn dbtn-primary' : 'dbtn dbtn-ghost'}
                  style={{ flexShrink: 0, flex: 'none', padding: '.42rem .8rem', fontSize: '.66rem' }}
                >{s.cta} →</button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
