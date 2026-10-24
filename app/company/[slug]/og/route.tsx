import { ImageResponse } from 'next/og'
import { getScore, titleCase, displayCompanyName, grade, pct, firstPartyReportCount } from '@/lib/growth'
import { lastUpdatedLabel } from '@/lib/companyDisplay'
import { loadCardFonts } from '@/lib/server/cardFonts'
import { INK, TEXT, ACCENTS, accentKeyForRisk, riskForScore, rgba } from '@/lib/cardTheme.js'
import { companyVerdict, companyStatPairs, confidenceLine, ogNoDataLines } from '@/lib/cardCopy.js'

// Dynamic OG share image for company pages — the biggest virality lever. The SAME design family as
// the canvas grade card (lib/cardKit.ts): ink, the company name in Syne, the grade letter as a
// watermark with the score beneath it, three typographic stat pairs, the confidence line and the
// URL footer. Palette/type from lib/cardTheme.js, every sentence from lib/cardCopy.js, fonts from
// assets/fonts via lib/server/cardFonts.ts. 1200×630.
//
// A company nobody has graded gets its own honest design (never a "?" ring): the headline says so
// and the second line claims only what the row proves (its real report count, or "Be the first.").
//
// Satori (next/og) rule: every <div> with more than one child node MUST set display:flex.
// ROUTE HANDLER, not the opengraph-image file convention — deliberately. The convention
// auto-attaches og:image with a per-deploy build-hash query AND takes priority over explicit
// metadata images, so the crawler-facing URL rotated every deploy (cold render every time —
// Reddit's ~4s budget → permanently cached blank unfurls). This URL (/company/<slug>/og) is
// STABLE across deploys; app/company/[slug]/layout.tsx points og:image + twitter:image here.
export const runtime = 'nodejs'

const size = { width: 1200, height: 630 }
const PAD = 72
const DISPLAY = 'Syne'
const TEXTF = 'Instrument Sans'
const white = (a: number) => `rgba(255,255,255,${a})`

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [s, fonts] = await Promise.all([getScore(slug), loadCardFonts()])
  // Prefer the STORED canonical name — a slug can't carry punctuation, so titleCase(slug)
  // rendered "Lowe S" on the public unfurl where the company is actually "Lowe's".
  const name = s?.company_name ? displayCompanyName(s.company_name) : titleCase(slug)

  const score = s?.overall_score ?? null
  const hasData = score != null
  const risk = s?.risk_level ?? (hasData ? riskForScore(score) : 'warn')
  const A = ACCENTS[accentKeyForRisk(risk)]
  const accent = hasData ? A.hex : ACCENTS.interview.hex
  const letter = hasData ? grade(score) : null
  const ghostPct = pct(s?.ghost_rate)
  const respPct = pct(s?.response_rate)
  const wait = s?.avg_wait_days != null ? Math.round(s.avg_wait_days) : 0

  // Only FIRST-PARTY rows may be published as "applicant reports" — the fused count once put
  // the LLM's claimed web-mention number (e.g. "12,775 applicant reports") on every share unfurl.
  const fp = firstPartyReportCount(s)
  const updated = hasData ? lastUpdatedLabel(s?.updated_at) : ''
  const verdict = hasData ? companyVerdict({ ghostRate: s?.ghost_rate ?? 0, responseRate: s?.response_rate ?? 0 }) : ''
  const pairs = hasData ? companyStatPairs({ ghostRate: s?.ghost_rate ?? 0, responseRate: s?.response_rate ?? 0, avgWaitDays: wait }) : []
  const conf = hasData ? confidenceLine(fp, updated) : ''
  const [noDataHead, noDataSub] = ogNoDataLines(name, fp)
  const url = `seenjobs.io/company/${slug}`

  // Name size: one line, never wrapped or clipped. Syne ExtraBold runs ~0.72em per character, so
  // size from the length against the 1000px the row can hold (it may run under the watermark).
  const nameSize = Math.max(40, Math.min(96, Math.floor(1000 / (Math.max(1, name.length) * 0.72))))

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: INK,
          backgroundImage: hasData
            ? `radial-gradient(circle at 82% 48%, ${rgba(accent, A.bloom)} 0%, ${rgba(accent, A.bloom * 0.35)} 32%, ${rgba(accent, 0)} 60%), radial-gradient(${white(0.05)} 1px, transparent 1.4px)`
            : `radial-gradient(circle at 70% 60%, ${rgba(accent, 0.14)} 0%, ${rgba(accent, 0.05)} 32%, ${rgba(accent, 0)} 60%), radial-gradient(${white(0.05)} 1px, transparent 1.4px)`,
          backgroundSize: '100% 100%, 36px 36px',
          padding: `${PAD - 12}px ${PAD}px ${PAD - 16}px`, fontFamily: TEXTF, color: white(TEXT.full),
          border: `1px solid ${white(0.06)}`,
        }}
      >
        {/* top row: wordmark + meta */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', width: 15, height: 15, borderRadius: 999, background: accent }} />
            <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: 34, fontWeight: 800, marginLeft: 12, marginTop: -4 }}>Seen</div>
          </div>
          <div style={{ display: 'flex', fontSize: 18, fontWeight: 500, letterSpacing: 2.6, color: white(TEXT.meta) }}>
            {hasData ? 'SEEN GRADE' : 'NO GRADE YET'}
          </div>
        </div>

        {hasData ? (
          <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
            {/* the grade letter as a watermark, the score solid beneath it */}
            <div style={{ display: 'flex', position: 'absolute', right: -12, top: -36, fontFamily: DISPLAY, fontSize: 440, fontWeight: 800, lineHeight: 1, color: rgba(accent, 0.22) }}>
              {letter}
            </div>
            <div style={{ display: 'flex', position: 'absolute', right: 0, top: 322, alignItems: 'baseline' }}>
              <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: 56, fontWeight: 800, color: accent }}>{score}</div>
              <div style={{ display: 'flex', fontSize: 24, fontWeight: 500, color: white(TEXT.faint), marginLeft: 6 }}>/100</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', width: 1000, marginTop: 52 }}>
              <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: nameSize, fontWeight: 800, lineHeight: 1, letterSpacing: -1, whiteSpace: 'nowrap' }}>{name}</div>
              <div style={{ display: 'flex', fontSize: 27, lineHeight: 1.3, color: white(TEXT.strong), marginTop: 22, maxWidth: 620 }}>{verdict}</div>

              <div style={{ display: 'flex', marginTop: 46 }}>
                {pairs.map((p) => (
                  <div key={p.label} style={{ display: 'flex', flexDirection: 'column', marginRight: 56 }}>
                    <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: 60, fontWeight: 800, lineHeight: 1 }}>{p.value}</div>
                    <div style={{ display: 'flex', fontSize: 20, color: white(TEXT.meta), marginTop: 8 }}>{p.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', fontSize: 19, color: white(TEXT.meta), marginTop: 26 }}>{conf}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', paddingBottom: 12 }}>
            <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: name.length > 18 ? 54 : 64, fontWeight: 800, lineHeight: 1.06, letterSpacing: -1, maxWidth: 1000 }}>
              {noDataHead}
            </div>
            <div style={{ display: 'flex', fontSize: 28, lineHeight: 1.35, color: white(TEXT.body), marginTop: 24, maxWidth: 900 }}>{noDataSub}</div>
          </div>
        )}

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${white(0.06)}`, paddingTop: 22, marginTop: 6 }}>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, color: white(TEXT.strong) }}>{url}</div>
          <div style={{ display: 'flex', fontSize: 19, color: white(TEXT.faint) }}>{hasData ? 'Check any company free at seenjobs.io' : 'Track an application free at seenjobs.io'}</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
      // Long CDN cache on the stable URL: one good crawl serves everyone; scores drift
      // slowly and a stale-while-revalidate refresh keeps the card current within a day.
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
    }
  )
}
