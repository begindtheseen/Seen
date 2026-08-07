'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import MicroSurveyModal, { type MicroQuestion } from './MicroSurveyModal'
import { GENERAL_QUESTIONS, buildContextualQuestion } from '@/lib/server/microSurvey'

// MicroSurveyHost decides WHEN the no-incentive micro-survey pops. Mounted once, next to
// ToastHost, in the root layout. The whole design goal is "never nag":
//   • HARD frequency cap — at most ONCE per day per device (persisted in localStorage).
//   • TRUE randomization — only a low ~15% of eligible page loads roll a show, so it never
//     feels scheduled.
//   • A short dwell delay before it will even consider showing (a pop the instant a page
//     loads reads as a nag; a pop after the user has settled reads as ambient).
// Because there is no reward, there is nothing to farm — the point is BREADTH of hiring signal.

// Device-local cap state (NOT user data): "did we already pop today?". Safe to persist across
// sign-out — it carries no PII and no answers; the next account simply inherits "already shown
// today" at worst, which only ever suppresses a poll, never leaks anything.
const CAP_KEY = 'seen_msurvey_v1'
const SHOW_PROBABILITY = 0.15 // ~15% of eligible loads
const DWELL_MS = 20000 // settle for ~20s before considering a show
// Surfaces where a hiring-signal poll is off-topic or would hurt a first impression / conversion:
// the landing page ('/'), the employer side, admin, and auth/pricing funnels.
const SKIP_PREFIXES = ['/employers', '/admin', '/login', '/signup', '/pricing']

function todayStr(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD, UTC day bucket
}

// The hard once-per-day gate: true if we have already SHOWN a micro-survey today (regardless of
// whether it was answered or dismissed — either way the daily slot is spent).
function alreadyShownToday(): boolean {
  try {
    const raw = localStorage.getItem(CAP_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { day?: string }
    return parsed?.day === todayStr()
  } catch {
    return false
  }
}

function markShownToday(): void {
  try {
    localStorage.setItem(CAP_KEY, JSON.stringify({ day: todayStr(), at: Date.now() }))
  } catch {
    /* ignore — a private-mode storage failure just means we may re-roll later, never a crash */
  }
}

// CONTEXTUAL first: if the user recently viewed a company, ask about THAT one. seen_recent_cos is
// cleared on sign-out (lib/auth.tsx SESSION_LOCAL_KEYS), so a signed-out device never inherits the
// previous user's company — the contextual question is safe to build from it. Otherwise fall back
// to a random one-tap question from the fixed general pool.
function pickQuestion(): MicroQuestion | null {
  try {
    const raw = localStorage.getItem('seen_recent_cos')
    if (raw) {
      const list = JSON.parse(raw) as Array<{ name?: string }>
      const recent = Array.isArray(list)
        ? list.find((c) => c && typeof c.name === 'string' && c.name.trim().length > 0)
        : null
      if (recent?.name) {
        const q = buildContextualQuestion(recent.name)
        if (q) return q
      }
    }
  } catch {
    /* fall through to a general question */
  }

  if (!GENERAL_QUESTIONS.length) return null
  const g = GENERAL_QUESTIONS[Math.floor(Math.random() * GENERAL_QUESTIONS.length)]
  return { key: g.key, text: g.text, choices: [...g.choices] }
}

export default function MicroSurveyHost() {
  const pathname = usePathname()
  const [question, setQuestion] = useState<MicroQuestion | null>(null)
  const firedRef = useRef(false) // at most one pop per page-load session

  useEffect(() => {
    if (firedRef.current) return
    if (!pathname) return
    if (pathname === '/' || SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return
    if (alreadyShownToday()) return

    const t = setTimeout(() => {
      if (firedRef.current) return
      if (alreadyShownToday()) return // re-check: another tab or a race may have spent the slot
      if (Math.random() >= SHOW_PROBABILITY) return // lost the roll — a later load can try again
      const q = pickQuestion()
      if (!q) return
      firedRef.current = true
      markShownToday() // occupy today's slot the instant we commit to showing
      setQuestion(q)
    }, DWELL_MS)

    return () => clearTimeout(t)
    // Re-evaluate on route change (SPA nav); firedRef still caps it at one pop per session.
  }, [pathname])

  // Record an ANSWER (a real hiring-signal data point). Fire-and-forget with keepalive so it
  // survives an immediate navigation. Auth is optional — attach the Bearer token when signed in,
  // else the response is stored anonymously server-side. A DISMISS is intentionally NOT recorded
  // to the DB: it is not a hiring signal, and keeping the table answer-only is what makes this a
  // cleaner signal than the incented survey. The daily cap already covered the dismiss locally.
  async function recordAnswer(choice: string, q: MicroQuestion): Promise<void> {
    try {
      let token: string | null = null
      try {
        const s = await supabase.auth.getSession()
        token = s.data.session?.access_token ?? null
      } catch {
        /* anonymous */
      }
      await fetch('/api/micro-survey', {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question_key: q.key,
          choice,
          company: q.company ?? null,
        }),
      })
    } catch {
      /* fire-and-forget: a no-incentive poll write must never surface an error to the user */
    }
  }

  if (!question) return null

  return (
    <MicroSurveyModal
      question={question}
      onAnswer={(choice) => {
        void recordAnswer(choice, question)
        setQuestion(null)
      }}
      onDismiss={() => setQuestion(null)}
    />
  )
}
