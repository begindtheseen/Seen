'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { LoadError } from '@/components/shell/LoadStates'
import { useRouter } from 'next/navigation'
import { AppStore } from '@/lib/stores/AppStore'
import CompanyScoreModal from '@/components/CompanyScoreModal'
import { firstPartyReportCount } from '@/lib/server/reportCounts'
import { isGradeableScore, MIN_REPORTS_FOR_GRADE } from '@/lib/gradeGate'
import PageHeader from '@/components/shell/PageHeader'
import { gradeLetter, displayCompanyName } from '@/lib/companyDisplay'
import { gradeTone, ghostRateTone, responseRateTone, ghostRateWord, responseRateWord, toneText, toneFill } from '@/lib/ui/tone.js'
import { accountsLabel } from '@/lib/glossary.js'
import Badge, { Chip } from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import s from './companies.module.css'

interface Company {
  id: string
  name: string
  industry?: string
  verified?: boolean
  score: {
    overall_score: number
    ghost_rate: number
    response_rate: number
    avg_wait_days: number
    /** FUSED total (first-party + web-research claim) — sorting only, never a "reports" label. */
    report_count: number
    /** Applicant accounts behind the grade: public posts + Seen-user reports (api/reports.js leaderboard). */
    first_party_report_count?: number
    /** Of those, how many a Seen user filed; null/absent = unknown (no split shown). */
    seen_user_report_count?: number | null
    data_source?: string | null
    risk_level: 'safe' | 'warn' | 'danger'
    waste: number
  }
}

// "48 applicant accounts · 1 from a Seen user" — the split only when the API knows it (audit #3). A
// score with no accounts behind it is a web-research estimate and says so.
function evidenceLabel(sc: Company['score']): string {
  const fp = firstPartyReportCount(sc)
  if (fp <= 0) return 'web-research estimate'
  const seen = sc.seen_user_report_count
  if (seen == null) return accountsLabel(fp)
  return `${accountsLabel(fp)} · ${seen === 1 ? '1 from a Seen user' : `${seen} from Seen users`}`
}

// The top of the board is reserved for well-evidenced grades: a company needs this many applicant
// accounts to take one of the first TOP_SLOTS places. Thinner grades still appear, below, under their
// own heading — "#1 aaa · 100/100 · 11 reports" over "#2 united wholesale mortgage · 8" read as a board
// nobody curates.
const WELL_EVIDENCED_REPORTS = 10
const TOP_SLOTS = 20

type SortKey = 'score' | 'ghost' | 'wait'
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'score', label: 'Best grade' },
  { key: 'ghost', label: 'Lowest ghost rate' },
  { key: 'wait', label: 'Shortest wait' },
]

const slugOf = (name: string) => encodeURIComponent(name.trim().toLowerCase().replace(/\s+/g, '-'))

export default function CompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  // The leaderboard request failed (API down / 500 / bad JSON): an error with Retry, never
  // "No company data yet" (R-1).
  const [loadFailed, setLoadFailed] = useState(false)
  // ONE box (audit #29: there were two — "look up" and "filter"): typing filters the board, Enter opens
  // the company's page whether or not it is on the board.
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('score')
  const [appliedCos, setAppliedCos] = useState<Set<string>>(new Set())
  const [modalCo, setModalCo] = useState<string | null>(null)

  useEffect(() => {
    try {
      const apps = AppStore.loadSync()
      setAppliedCos(new Set(apps.map(a => a.company.toLowerCase().trim())))
    } catch {}
  }, [])

  const loadLeaderboard = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      // GET: the board is identical for every visitor and the edge serves it (lib/server/publicRead.js).
      const r = await fetch('/api/reports?type=leaderboard')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json() as { companies?: Company[] }
      if (!Array.isArray(d.companies)) throw new Error('bad payload')
      // Grade gate: the API already ranks only gradeable companies; filter again so a CDN-cached
      // pre-gate payload can never put an ungraded company on the board.
      setCompanies(d.companies.filter((c) => isGradeableScore(c.score)))
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void loadLeaderboard() }, [loadLeaderboard])

  const q = query.trim()
  const filtered = useMemo(() => {
    let list = companies
    if (q) {
      const needle = q.toLowerCase()
      list = list.filter((c) => c.name.toLowerCase().includes(needle) || (c.industry || '').toLowerCase().includes(needle))
    }
    if (sort === 'score') list = [...list].sort((a, b) => b.score.overall_score - a.score.overall_score)
    if (sort === 'ghost') list = [...list].sort((a, b) => a.score.ghost_rate - b.score.ghost_rate)
    if (sort === 'wait') list = [...list].sort((a, b) => a.score.avg_wait_days - b.score.avg_wait_days)
    // Stable partition: well-evidenced companies take the top slots in the chosen order; the rest
    // follow in the same order. Filtering by name keeps the plain order (the visitor asked for a name).
    if (q) return list
    const strong = list.filter((c) => firstPartyReportCount(c.score) >= WELL_EVIDENCED_REPORTS)
    const thin = list.filter((c) => firstPartyReportCount(c.score) < WELL_EVIDENCED_REPORTS)
    return [...strong, ...thin]
  }, [companies, q, sort])
  // Where the thinner grades begin (the heading sits before this index), or -1 when none / searching.
  const thinStart = useMemo(() => {
    if (q) return -1
    const i = filtered.findIndex((c) => firstPartyReportCount(c.score) < WELL_EVIDENCED_REPORTS)
    return i >= 0 && i < filtered.length ? i : -1
  }, [filtered, q])

  function lookUp(e: React.FormEvent) {
    e.preventDefault()
    if (!q) return
    // An exact board match opens its page; anything else is looked up (and researched) by name.
    router.push(`/company/${slugOf(q)}`)
  }

  return (
    <div className="page-full">
      <div className={s.page}>
        <PageHeader
          eyebrow="Transparency rankings"
          title="Company scoreboard"
          crumbLabel="Companies"
          sub={<>Ranked by Seen Grade: who answers applicants, who ghosts them, and how long they take. A company is graded once it has at least one real applicant account (sent to Seen or posted publicly) and {MIN_REPORTS_FOR_GRADE} in total (an online mention counts half).</>}
        />

        <form onSubmit={lookUp} className={s.search} role="search">
          <label htmlFor="co-search" className="sr-only">Search the scoreboard or look up any company</label>
          <div className={s.field}>
          <Icon name="search" size={18} className={s.searchIcon} />
          <input
            id="co-search"
            type="text"
            className={`ui-input ${s.searchInput}`}
            placeholder="Search companies, or look up any company"
            value={query}
            name="seen-company-lookup"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            onChange={(e) => setQuery(e.target.value)}
          />
          </div>
          <Button type="submit" variant="primary" disabled={!q} className={s.searchBtn}>Look up</Button>
        </form>
        <p className={s.hint}>Not on the board? Press Enter to open its page — the first lookup researches it once and the result is cached for everyone.</p>

        <div className={s.controls} role="group" aria-label="Sort the scoreboard">
          {SORTS.map(o => <Chip key={o.key} selected={sort === o.key} onClick={() => setSort(o.key)}>{o.label}</Chip>)}
          {!loading && !loadFailed && <span className={s.total}>{q ? `${filtered.length} of ${companies.length}` : `${companies.length} graded companies`}</span>}
        </div>

        {loading ? (
          <div className={s.grid} aria-label="Loading the scoreboard" role="status">
            {Array.from({ length: 9 }, (_, i) => <div key={i} className={`sk ${s.skCard}`} />)}
          </div>
        ) : loadFailed ? (
          <LoadError what="the company scoreboard" detail="Seen could not be reached. You can still look up any company by name above." onRetry={loadLeaderboard} />
        ) : filtered.length === 0 ? (
          <div className={s.empty}>
            {q ? (
              <>
                <p>&ldquo;{q}&rdquo; isn&apos;t on the scoreboard yet.</p>
                <Button variant="secondary" href={`/company/${slugOf(q)}`} iconRight="arrow-right">Look up &ldquo;{q}&rdquo;</Button>
                <p className={s.hint}>Seen researches the company once and caches the result for everyone.</p>
              </>
            ) : (
              <p>No company data yet. Use the search above to look up any company.</p>
            )}
          </div>
        ) : (
          <ol className={s.grid}>
            {filtered.map((co, i) => {
              const tone = gradeTone(co.score.overall_score)
              const g = gradeLetter(co.score.overall_score)
              const gt = co.score.ghost_rate > 0 ? ghostRateTone(co.score.ghost_rate) : null
              const rt = co.score.response_rate > 0 ? responseRateTone(co.score.response_rate) : null
              const divider = thinStart >= 0 && i === thinStart ? (
                <li key="thin-divider" className={s.divider}>
                  Early grades · fewer than {WELL_EVIDENCED_REPORTS} applicant accounts{thinStart >= TOP_SLOTS ? '' : ` · the top ${TOP_SLOTS} need ${WELL_EVIDENCED_REPORTS}+`}
                </li>
              ) : null
              return (
                <React.Fragment key={co.id || co.name}>
                  {divider}
                  <li className={s.item}>
                    <a
                      href={`/company/${slugOf(co.name)}`}
                      className={s.card}
                      onClick={(e) => {
                        // Plain click pops the score modal in place. Cmd/Ctrl/Shift/middle-click keep the
                        // native <a> behavior so "open in new tab" still works.
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                        e.preventDefault()
                        setModalCo(co.name)
                      }}
                    >
                      <div className={s.cardTop}>
                        <span className={s.letter} style={{ color: toneText(tone) }} aria-label={`Grade ${g}`}>{g}</span>
                        <div className={s.who}>
                          <span className={s.name}>{displayCompanyName(co.name)}</span>
                          {co.industry && <span className={s.industry}>{co.industry}</span>}
                        </div>
                        <span className={s.rank} aria-label={`Rank ${i + 1}`}>#{i + 1}</span>
                      </div>
                      <div className={s.badges}>
                        {gt && <Badge tone={gt}>{Math.round(co.score.ghost_rate * 100)}% ghosted · {ghostRateWord(gt)}</Badge>}
                        {rt && <Badge tone={rt}>{Math.round(co.score.response_rate * 100)}% hear back · {responseRateWord(rt)}</Badge>}
                        {co.verified && <Badge tone="info" icon="shield-check">Verified</Badge>}
                        {appliedCos.has(co.name.toLowerCase().trim()) && <Badge tone="accent" icon="check">Applied</Badge>}
                      </div>
                      <div className={s.foot}>
                        <span className={s.score}><b className="tnum">{co.score.overall_score}</b>/100</span>
                        <span className={s.basis}>{evidenceLabel(co.score)}</span>
                      </div>
                      <div className={s.bar} aria-hidden="true"><div style={{ width: `${Math.max(4, co.score.overall_score)}%`, background: toneFill(tone) }} /></div>
                    </a>
                  </li>
                </React.Fragment>
              )
            })}
          </ol>
        )}
      </div>

      {modalCo && <CompanyScoreModal companyName={modalCo} onClose={() => setModalCo(null)} />}
    </div>
  )
}
