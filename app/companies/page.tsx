'use client'

import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { LoadError } from '@/components/shell/LoadStates'
import { useRouter } from 'next/navigation'
import { AppStore } from '@/lib/stores/AppStore'
import CompanyScoreModal from '@/components/CompanyScoreModal'
import { firstPartyReportCount } from '@/lib/server/reportCounts'
import { isGradeableScore, MIN_REPORTS_FOR_GRADE } from '@/lib/gradeGate'
import { MIN_SEEN_REPORTS_FOR_HIGH_CONFIDENCE } from '@/lib/companyPageSummary'
import PageHeader from '@/components/shell/PageHeader'
import { gradeLetter, displayCompanyName } from '@/lib/companyDisplay'
import { gradeTone, ghostRateTone, responseRateTone, ghostRateWord, responseRateWord, toneText, toneFill } from '@/lib/ui/tone.js'
import { accountsLabel } from '@/lib/glossary.js'
import Badge, { Chip } from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import s from './companies.module.css'
import { useUrlPlace, replaceParam, readParam, useScrollMemory } from '@/lib/nav/urlState'

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
  // A zero is said as what the accounts ARE (public posts), not as a missing thing on every row (round 2: "0 from Seen users" on all 150).
  return `${accountsLabel(fp)} · ${seen === 0 ? 'all from public posts' : seen === 1 ? '1 from a Seen user' : `${seen} from Seen users`}`
}

// The top of the board is reserved for well-evidenced grades: a company needs this many applicant
// accounts to take one of the first TOP_SLOTS places. Thinner grades still appear, below, under their
// own heading — "#1 aaa · 100/100 · 11 reports" over "#2 united wholesale mortgage · 8" read as a board
// nobody curates.
const WELL_EVIDENCED_REPORTS = 10
const TOP_SLOTS = 20

// The confidence a card may CLAIM, from the fields the leaderboard payload carries (no stored data_quality
// reaches the client). It is the company page's own display cap (lib/companyPageSummary.ts
// capDisplayConfidence): a grade reads at most "Moderate confidence" until MIN_SEEN_REPORTS_FOR_HIGH_CONFIDENCE
// of its applicant accounts came from Seen users, and "Low" under WELL_EVIDENCED_REPORTS accounts (the
// thin-signal bar every ranked surface uses). Tier 2 = enough Seen-user reports for the stored word to be
// read uncapped; it never says "High" on its own, because that word is not in the payload (do not invent it).
type EvidenceTier = 0 | 1 | 2
function evidenceTier(sc: Company['score']): EvidenceTier {
  const fp = firstPartyReportCount(sc)
  if (fp < WELL_EVIDENCED_REPORTS) return 0
  return (sc.seen_user_report_count ?? 0) >= MIN_SEEN_REPORTS_FOR_HIGH_CONFIDENCE ? 2 : 1
}
function confidenceWord(tier: EvidenceTier): string {
  return tier === 0 ? 'Low confidence' : tier === 1 ? 'Moderate confidence' : 'Confidence not capped'
}
function confidenceNote(tier: EvidenceTier, sc: Company['score']): string {
  if (tier === 0) return `Fewer than ${WELL_EVIDENCED_REPORTS} applicant accounts behind this grade.`
  if (tier === 1) return `Shown as moderate until ${MIN_SEEN_REPORTS_FOR_HIGH_CONFIDENCE} reports come from Seen users (${sc.seen_user_report_count ?? 0} so far) — most of this evidence is public posts.`
  return `${sc.seen_user_report_count} of its applicant accounts were filed by Seen users.`
}

type SortKey = 'score' | 'ghost' | 'wait'
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'score', label: 'Best grade' },
  { key: 'ghost', label: 'Lowest ghost rate' },
  { key: 'wait', label: 'Shortest wait' },
]

const slugOf = (name: string) => encodeURIComponent(name.trim().toLowerCase().replace(/\s+/g, '-'))

// The board is the same for every visitor, so this tab keeps the last copy for a few minutes: Back
// from a company page shows the same rows at once instead of a skeleton and a refetch.
const BOARD_CACHE_KEY = 'seen_leaderboard_v1'
const BOARD_CACHE_TTL = 10 * 60 * 1000
function readBoardCache(): Company[] | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(BOARD_CACHE_KEY) || 'null') as { t?: number; companies?: Company[] } | null
    if (!c || !Array.isArray(c.companies) || typeof c.t !== 'number' || Date.now() - c.t > BOARD_CACHE_TTL) return null
    return c.companies
  } catch { return null }
}
function writeBoardCache(companies: Company[]) {
  try { sessionStorage.setItem(BOARD_CACHE_KEY, JSON.stringify({ t: Date.now(), companies })) } catch { /* ignore */ }
}
const isSortKey = (v: string): v is SortKey => SORTS.some(o => o.key === v)

export default function CompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [gradedTotal, setGradedTotal] = useState<number | null>(null) // every graded company, not just the 150 shown
  const [loading, setLoading] = useState(true)
  // The leaderboard request failed (API down / 500 / bad JSON): an error with Retry, never
  // "No company data yet" (R-1).
  const [loadFailed, setLoadFailed] = useState(false)
  // ONE box (audit #29: there were two — "look up" and "filter"): typing filters the board, Enter opens
  // the company's page whether or not it is on the board.
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('score')
  const [appliedCos, setAppliedCos] = useState<Set<string>>(new Set())
  // The open company is a place in the URL (?co=<name>): Back closes it, and Back from the company's
  // full page reopens it over the board.
  const coPlace = useUrlPlace('co')
  const modalCo = coPlace.value || null
  // The search box and sort live in the URL (?q=, ?sort=) so Back brings them back.
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const apps = AppStore.loadSync()
      setAppliedCos(new Set(apps.map(a => a.company.toLowerCase().trim())))
    } catch {}
  }, [])

  const loadLeaderboard = useCallback(async (useCache = false) => {
    if (useCache) {
      const cached = readBoardCache()
      if (cached) { setCompanies(cached); setLoadFailed(false); setLoading(false); return }
    }
    setLoading(true)
    setLoadFailed(false)
    try {
      // GET: the board is identical for every visitor and the edge serves it (lib/server/publicRead.js).
      const r = await fetch('/api/reports?type=leaderboard')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json() as { companies?: Company[]; graded_total?: number | null }
      if (typeof d.graded_total === 'number') setGradedTotal(d.graded_total)
      if (!Array.isArray(d.companies)) throw new Error('bad payload')
      // Grade gate: the API already ranks only gradeable companies; filter again so a CDN-cached
      // pre-gate payload can never put an ungraded company on the board.
      const board = d.companies.filter((c) => isGradeableScore(c.score))
      setCompanies(board)
      writeBoardCache(board)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])
  // Layout effect: the URL and the cached board are read before the first paint, so Back shows the
  // same rows with no skeleton flash.
  useLayoutEffect(() => {
    const q0 = readParam('q')
    const s0 = readParam('sort')
    if (q0) setQuery(q0)
    if (isSortKey(s0)) setSort(s0)
    setHydrated(true)
    void loadLeaderboard(true)
  }, [loadLeaderboard])
  useEffect(() => {
    if (!hydrated) return
    const t = setTimeout(() => replaceParam('q', query.trim() || null), 250)
    return () => clearTimeout(t)
  }, [query, hydrated])
  useEffect(() => {
    if (!hydrated) return
    replaceParam('sort', sort === 'score' ? null : sort)
  }, [sort, hydrated])
  useScrollMemory(hydrated && !loading)

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
    // Stable partition by evidence tier: grades whose confidence is not capped first, then the capped
    // ("0 from Seen users") ones, then the thin ones — each tier in the chosen order, equal values broken
    // by more applicant accounts, then more Seen-user reports. A perfect 100 with eleven public posts no
    // longer outranks a well-evidenced 94 (design review 2026-11-02). Filtering by name keeps the plain
    // order (the visitor asked for a name).
    if (q) return list
    const evidence = (a: Company, b: Company) => firstPartyReportCount(b.score) - firstPartyReportCount(a.score) || (b.score.seen_user_report_count ?? 0) - (a.score.seen_user_report_count ?? 0)
    const key = (c: Company) => sort === 'score' ? -c.score.overall_score : sort === 'ghost' ? c.score.ghost_rate : c.score.avg_wait_days
    const within = (a: Company, b: Company) => key(a) - key(b) || evidence(a, b)
    return ([2, 1, 0] as EvidenceTier[]).flatMap((t) => list.filter((c) => evidenceTier(c.score) === t).sort(within))
  }, [companies, q, sort])
  // Where each lower tier begins (its heading sits before that index), or -1 when none / searching / the
  // tier above it is empty (a heading over the whole board says nothing).
  const tierStart = useMemo(() => {
    const start = (t: EvidenceTier) => {
      if (q) return -1
      const i = filtered.findIndex((c) => evidenceTier(c.score) === t)
      return i > 0 ? i : -1
    }
    return { capped: start(1), thin: start(0) }
  }, [filtered, q])

  function lookUp(e: React.FormEvent) {
    e.preventDefault()
    if (!q) return
    replaceParam('q', q) // the typing debounce may not have written it yet; Back should find it
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

        {/* One box, like the hero's: the field and its button share a border; the button sits inside. */}
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
          <Button type="submit" variant="primary" disabled={!q} className={s.searchBtn}>Look up</Button>
          </div>
        </form>
        <p className={s.hint}>Not on the board? Press Enter to open its page — the first lookup researches it once and the result is cached for everyone.</p>

        <div className={s.controls} role="group" aria-label="Sort the scoreboard">
          {SORTS.map(o => <Chip key={o.key} selected={sort === o.key} onClick={() => setSort(o.key)}>{o.label}</Chip>)}
          {!loading && !loadFailed && <span className={s.total}>{q ? `${filtered.length} of ${companies.length}` : (gradedTotal && gradedTotal > companies.length ? `Top ${companies.length} of ${gradedTotal} graded companies` : `${companies.length} graded companies`)}</span>}
        </div>

        {loading ? (
          <div className={s.grid} aria-label="Loading the scoreboard" role="status">
            {Array.from({ length: 9 }, (_, i) => <div key={i} className={`sk ${s.skCard}`} />)}
          </div>
        ) : loadFailed ? (
          <LoadError what="the company scoreboard" detail="Seen could not be reached. You can still look up any company by name above." onRetry={() => loadLeaderboard()} />
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
              const tier = evidenceTier(co.score)
              const divider = tierStart.thin >= 0 && i === tierStart.thin ? (
                <li key="thin-divider" className={s.divider}>
                  Early grades · fewer than {WELL_EVIDENCED_REPORTS} applicant accounts{tierStart.thin >= TOP_SLOTS ? '' : ` · the top ${TOP_SLOTS} need ${WELL_EVIDENCED_REPORTS}+`}
                </li>
              ) : tierStart.capped >= 0 && i === tierStart.capped ? (
                <li key="capped-divider" className={s.divider}>
                  Moderate confidence · fewer than {MIN_SEEN_REPORTS_FOR_HIGH_CONFIDENCE} reports from Seen users — most evidence is public posts
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
                        replaceParam('q', q || null)
                        coPlace.open(co.name)
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
                      {/* The same word the company page shows, so a 100/100 built on public posts is read as it should be. */}
                      <Badge icon="gauge" title={confidenceNote(tier, co.score)} className={s.conf}>{confidenceWord(tier)}</Badge>
                      <div className={s.bar} aria-hidden="true"><div style={{ width: `${Math.max(4, co.score.overall_score)}%`, background: toneFill(tone) }} /></div>
                    </a>
                  </li>
                </React.Fragment>
              )
            })}
          </ol>
        )}
      </div>

      {modalCo && <CompanyScoreModal companyName={modalCo} onClose={coPlace.close} />}
    </div>
  )
}
