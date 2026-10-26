import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import {
  getScore, titleCase, slugify, grade, riskColor, riskLabel, pct, firstPartyReportCount,
  SEED_COMPANIES, MIN_REPORTS_FOR_GRADE, type GrowthScore,
} from '@/lib/growth'
import { jsonLdHtml } from '@/lib/jsonLd'

// Evergreen long-tail FAQ pages: /faq/does-amazon-ghost-applicants, /faq/google-hiring-process, etc.
// Server-rendered, factual, embedding the company's LIVE grade + ghost data. Targets the exact
// phrasing people type into Google/Reddit. Never fabricates — if no data, honest "be the first".
// "Reported"/"real data" wording is used ONLY when first-party applicant reports back the score
// (firstPartyReportCount). A score built from web research alone is worded as Seen's estimate from
// aggregated public data — the fused report_count includes the web pipeline's claimed mentions
// and is never presented as applicant reports.
//
// SEARCH (plan 2026-10-24): these pages repeat the company page's numbers (grade, ghost / response
// rate, wait) with a few template sentences, and the company page now answers the same questions
// ("<x> hiring process", "<x> application status", "does <x> ghost applicants") in its own FAQ and
// FAQPage JSON-LD. Two URLs with the same answer split the ranking, and an open-ended slug route is
// exactly the scaled templated content Google demotes. So: for a GRADED company the page's canonical
// is the company page (the stronger, fuller copy collects the signals); for anything else (no grade,
// unknown company, unparseable slug) the page is noindex with links followed. noindex and a cross-page
// canonical are never combined. They are no longer in the sitemap.

export const revalidate = 3600
export const dynamicParams = true

// Two intent shapes per company → the two highest-volume long-tail queries.
const INTENTS = [
  { kind: 'ghost', prefix: 'does-', suffix: '-ghost-applicants' },
  { kind: 'process', prefix: '', suffix: '-hiring-process' },
] as const

// Parse a slug back into { company, intent }. Returns null for unrecognized shapes.
function parseSlug(slug: string): { company: string; kind: 'ghost' | 'process' } | null {
  const s = decodeURIComponent(slug).toLowerCase()
  if (s.startsWith('does-') && s.endsWith('-ghost-applicants')) {
    return { company: s.slice('does-'.length, -'-ghost-applicants'.length), kind: 'ghost' }
  }
  if (s.endsWith('-hiring-process')) {
    return { company: s.slice(0, -'-hiring-process'.length), kind: 'process' }
  }
  return null
}

export function generateStaticParams() {
  const params: { slug: string }[] = []
  for (const name of SEED_COMPANIES) {
    const cslug = slugify(name)
    for (const i of INTENTS) params.push({ slug: `${i.prefix}${cslug}${i.suffix}` })
  }
  return params
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const parsed = parseSlug(slug)
  if (!parsed) return { ...pageMetadata({ title: 'Hiring FAQ', description: 'Frequently asked questions about how companies hire, from real applicant reports.', path: `/faq/${slug}` }), robots: { index: false, follow: true } }
  const name = titleCase(parsed.company)
  const s = await getScore(parsed.company)
  const ghostPct = pct(s?.ghost_rate)
  const reported = firstPartyReportCount(s) > 0
  const graded = s != null && s.gradeable && s.overall_score != null
  // Graded → canonical (and og:url) is the company page; otherwise this URL, kept out of the index.
  const url = graded ? `https://seenjobs.io/company/${slugify(parsed.company)}` : `https://seenjobs.io/faq/${slug}`
  const robots = graded ? {} : { robots: { index: false, follow: true } }

  if (parsed.kind === 'ghost') {
    const title = `Does ${name} Ghost Applicants? (${reported ? 'Real Data' : 'Hiring Data'}, ${new Date().getFullYear()})`
    const description = ghostPct != null
      ? (reported
          ? `${name} ghosts roughly ${ghostPct}% of applicants based on real reported outcomes. See ${name}'s response rate, average wait time, and what Reddit says before you apply.`
          : `Seen estimates ${name} ghosts roughly ${ghostPct}% of applicants, from aggregated public hiring data — no applicant reports yet. See the estimate and add your own experience.`)
      : `Does ${name} ghost applicants? See real reported hiring outcomes, response rates, and wait times — and add your own experience.`
    return {
      ...pageMetadata({
        title, description, path: url, ogTitle: title, type: 'article',
        keywords: [`does ${name} ghost applicants`, `${name} ghosting`, `${name} no response`, `${name} reddit hiring`, `is ${name} ghosting candidates`],
      }),
      ...robots,
    }
  }
  const title = `${name} Hiring Process: Stages, Wait Time & Ghost Rate`
  const description = `How ${name}'s hiring process works — stages, average wait time${ghostPct != null ? `, and a ${ghostPct}% ${reported ? '' : 'estimated '}ghost rate` : ''} — ${reported ? 'from real applicant reports' : 'estimated from aggregated public hiring data'}. What to expect before you apply.`
  return {
    ...pageMetadata({
      title, description, path: url, ogTitle: title, type: 'article',
      keywords: [`${name} hiring process`, `${name} interview process`, `${name} application timeline`, `how long does ${name} take to respond`, `${name} hiring stages`],
    }),
    ...robots,
  }
}

const S = {
  wrap: { maxWidth: 760, margin: '0 auto', padding: '3.5rem 1.25rem 5rem', width: '100%', boxSizing: 'border-box' as const },
  eyebrow: { fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase' as const, letterSpacing: '.2em', color: 'var(--blue)', marginBottom: '.7rem', display: 'flex', alignItems: 'center', gap: 10 },
  h1: { fontFamily: 'var(--display)', fontSize: 'clamp(1.6rem,5vw,2.3rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.1, margin: '0 0 1rem' },
  lead: { color: 'var(--sub)', fontSize: 'var(--fs-body)', lineHeight: 1.7, fontWeight: 300, margin: '0 0 2rem' },
  h2: { fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 700, color: 'var(--white)', margin: '2.2rem 0 .8rem', letterSpacing: '-.01em' },
  p: { color: 'var(--sub)', fontSize: 'var(--fs-ui)', lineHeight: 1.75, margin: '0 0 1rem', fontWeight: 300 },
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: '1 1 120px', minWidth: 0, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '.9rem 1rem' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xl)', fontWeight: 500, color, lineHeight: 1, letterSpacing: '-.02em' }}>{value}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginTop: '.45rem' }}>{label}</div>
    </div>
  )
}

function DataPanel({ name, s }: { name: string; s: GrowthScore }) {
  if (s.overall_score == null) return null // grade gate: only graded scores reach here
  const accent = riskColor(s.risk_level)
  const ghostPct = pct(s.ghost_rate)
  const respPct = pct(s.response_rate)
  const wait = s.avg_wait_days != null ? Math.round(s.avg_wait_days) : null
  const fp = firstPartyReportCount(s)
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderLeft: `3px solid ${accent}`, borderRadius: 12, padding: '1.2rem 1.25rem', margin: '0 0 1.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-h2)', fontWeight: 800, color: accent, lineHeight: 1 }}>{grade(s.overall_score)}</div>
        <div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 700, color: 'var(--white)' }}>Seen Grade {s.overall_score}/100</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', letterSpacing: '.1em', color: accent }}>{riskLabel(s.risk_level)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        {ghostPct != null && <MetricCard label="Ghost rate" value={`${ghostPct}%`} color="var(--red)" />}
        {respPct != null && <MetricCard label="Response rate" value={`${respPct}%`} color="var(--green)" />}
        {wait != null && <MetricCard label="Avg wait" value={`${wait}d`} color="var(--amber)" />}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', marginTop: '.9rem' }}>
        {`Based on ${fp.toLocaleString()} applicant report${fp === 1 ? '' : 's'}`} · A community signal, not a verified fact
      </div>
    </div>
  )
}

function CTAs({ name, cslug }: { name: string; cslug: string }) {
  return (
    <div style={{ display: 'flex', gap: '.7rem', flexWrap: 'wrap', margin: '2.4rem 0 0' }}>
      <Link href={`/company/${cslug}`} className="btn" style={{ background: 'linear-gradient(135deg,var(--g-start),var(--g-mid),var(--g-end))', color: '#fff', padding: '.7rem 1.3rem', fontWeight: 700 }}>
        See {name}&apos;s full hiring report →
      </Link>
      <Link href={`/tracker?add=1&company=${encodeURIComponent(name)}`} className="btn btn-ghost" style={{ padding: '.7rem 1.3rem' }}>
        Track your application
      </Link>
      <Link href="/report" className="btn btn-ghost" style={{ padding: '.7rem 1.3rem' }}>
        Report your experience
      </Link>
    </div>
  )
}

export default async function FaqSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const parsed = parseSlug(slug)
  if (!parsed) {
    return (
      <div className="page-full"><div style={S.wrap}>
        <h1 style={S.h1}>Hiring FAQ</h1>
        <p style={S.p}>We couldn&apos;t find that question. <Link href="/faq" style={{ color: 'var(--blue)' }}>Browse the FAQ</Link> or <Link href="/companies" style={{ color: 'var(--blue)' }}>search a company</Link>.</p>
      </div></div>
    )
  }

  const name = titleCase(parsed.company)
  const cslug = slugify(parsed.company)
  const s = await getScore(parsed.company)
  const ghostPct = pct(s?.ghost_rate)
  const respPct = pct(s?.response_rate)
  const wait = s?.avg_wait_days != null ? Math.round(s.avg_wait_days) : null
  const year = new Date().getFullYear()
  // true → first-party applicant reports back the numbers; false → web-research estimate.
  const reported = firstPartyReportCount(s) > 0
  // Grade gate: a grade/ghost% is shown only with ≥ MIN_REPORTS_FOR_GRADE real reports (getScore nulls
  // the verdict fields below that). `fp` reports may still exist and are mentioned, never graded.
  const fp = firstPartyReportCount(s)
  const graded = s != null && s.overall_score != null ? s : null
  const notEnough = `${name} isn't graded yet — it has ${Math.min(fp, MIN_REPORTS_FOR_GRADE)} of the ${MIN_REPORTS_FOR_GRADE} applicant reports Seen needs before it shows a grade or ghost rate.`

  const isGhost = parsed.kind === 'ghost'
  const h1 = isGhost ? `Does ${name} ghost applicants?` : `${name} hiring process: what to expect`

  // Short answer line — straight, factual, no fabrication.
  let shortAnswer: string
  if (graded && ghostPct != null && reported) {
    shortAnswer = isGhost
      ? `Based on real reported outcomes, ${name} ghosts roughly ${ghostPct}% of applicants${respPct != null ? `, and responds to about ${respPct}%` : ''}. That puts ${name} at a Seen Grade of ${graded.overall_score}/100 (${riskLabel(graded.risk_level).toLowerCase()}).`
      : `${name} carries a Seen Grade of ${graded.overall_score}/100${wait != null ? `, with an average wait of about ${wait} days to hear back` : ''}${ghostPct != null ? ` and a ${ghostPct}% ghost rate` : ''}. Here's what applicants report.`
  } else if (graded) {
    shortAnswer = `${name} has a Seen Grade of ${graded.overall_score}/100. We don't yet have a precise ghost rate — add your experience to sharpen the picture for the next applicant.`
  } else if (fp > 0) {
    shortAnswer = `${notEnough} Read what applicants have reported so far, and add yours if you've applied.`
  } else {
    shortAnswer = `We don't have enough applicant reports for ${name} yet. If you've applied, you can be the first to report what happened — and help the next person decide.`
  }

  // FAQ JSON-LD (real Q&A) so this can win a rich result and be cited by AI answer engines.
  const faqQa: { q: string; a: string }[] = [
    {
      q: isGhost ? `Does ${name} ghost applicants?` : `How long does ${name}'s hiring process take?`,
      a: graded && ghostPct != null
        ? (reported
            ? (isGhost
                ? `${name} ghosts about ${ghostPct}% of applicants based on reported outcomes${respPct != null ? `, and responds to roughly ${respPct}%` : ''}.`
                : `${name}'s reported average wait is ${wait != null ? `about ${wait} days` : 'variable'}, with a ${ghostPct}% ghost rate.`)
            : (isGhost
                ? `Seen has no applicant reports for ${name} yet. Its estimate from aggregated public hiring data is a ghost rate of about ${ghostPct}%${respPct != null ? ` and a response rate of roughly ${respPct}%` : ''}.`
                : `Seen has no applicant reports for ${name} yet. Its estimate from aggregated public hiring data is an average wait of ${wait != null ? `about ${wait} days` : 'unknown length'}, with a ${ghostPct}% ghost rate.`))
        : fp > 0 ? notEnough : `We don't have enough verified reports for ${name} yet. Reported outcomes update this answer in real time.`,
    },
    {
      q: `What is ${name}'s Seen Grade?`,
      a: graded ? `${name} has a Seen Grade of ${graded.overall_score}/100 (${riskLabel(graded.risk_level).toLowerCase()}). Higher is more transparent.` : fp > 0 ? notEnough : `${name} doesn't have a Seen Grade yet — be the first to report.`,
    },
    {
      q: `Is ${name}'s ghost rate a verified fact?`,
      a: `No. Seen scores are aggregated community signals from applicant reports, not verified facts. Treat them as a directional signal, not a verdict.`,
    },
  ]
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqQa.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }

  return (
    <div className="page-full">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <div style={S.wrap}>
        <div style={S.eyebrow}>
          <span style={{ width: 20, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
          Hiring FAQ · {year}
        </div>
        <h1 style={S.h1}>{h1}</h1>
        <p style={S.lead}>{shortAnswer}</p>

        {graded ? <DataPanel name={name} s={graded} /> : (
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderLeft: '3px solid var(--blue)', borderRadius: 12, padding: '1.2rem 1.25rem', margin: '0 0 1.8rem' }}>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>{fp > 0 ? `Not enough reviews to grade ${name} yet (${Math.min(fp, MIN_REPORTS_FOR_GRADE)} of ${MIN_REPORTS_FOR_GRADE})` : `No reports yet for ${name}`}</div>
            <p style={{ ...S.p, margin: 0 }}>{fp > 0 ? `Read the ${fp} applicant report${fp === 1 ? '' : 's'} on ${name}'s page — and add yours so it can be graded fairly.` : `Be the first to report how ${name} treated your application. Your report becomes the data the next applicant searches for tonight.`}</p>
          </div>
        )}

        <h2 style={S.h2}>{isGhost ? `Why applicants think ${name} ghosts them` : `What ${name}'s hiring process looks like`}</h2>
        <p style={S.p}>
          {isGhost
            ? `"Ghosting" means applying and never hearing back — no rejection, no update, nothing. ${s && respPct != null ? `${name}'s ${reported ? 'reported' : 'estimated'} response rate is ${respPct}%, so a meaningful share of applicants never get a reply.` : `Reported response data for ${name} is still thin — every new report makes the signal sharper.`} Common reasons: roles filled internally, listings left open after closing, or high applicant volume that outpaces recruiting capacity.`
            : `${s?.summary ? s.summary : `Seen does not have a written summary of ${name}'s hiring process yet.`} ${wait != null ? `${reported ? 'Reported' : 'Estimated'} average time to first response is about ${wait} days.` : ''} ${s?.avg_rounds ? (reported ? `Applicants report roughly ${Math.round(s.avg_rounds)} interview round(s).` : `Public hiring data suggests roughly ${Math.round(s.avg_rounds)} interview round(s).`) : ''}`}
        </p>

        <h2 style={S.h2}>What you can do before you apply</h2>
        <p style={S.p}>
          Check {name}&apos;s full hiring report for the latest grade, the city-by-city breakdown, and recent applicant reports. If you&apos;ve already applied, track it so you know exactly when to follow up — and report what happened so the data stays honest for everyone after you.
        </p>

        <CTAs name={name} cslug={cslug} />

        <p style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', marginTop: '2.5rem', lineHeight: 1.7 }}>
          Seen aggregates real applicant reports into a 0–100 transparency grade. Scores are community signals, not verified facts, and update as new reports come in. Last refreshed hourly.
        </p>
      </div>
    </div>
  )
}
