import { ImageResponse } from 'next/og'
import { getScore, titleCase, displayCompanyName, grade, riskColor, riskLabel, pct, firstPartyReportCount } from '@/lib/growth'

// Dynamic OG share image for company pages — the biggest virality lever. Renders the company's
// REAL Seen Grade + ghost%/response% in an on-brand card. 1200×630. When no data exists we still
// render an honest, branded card inviting the first report (never a broken/blank share preview).
//
// Satori (next/og) rule: every <div> with more than one child node MUST set display:flex. We set
// display:flex on all multi-child / interpolated divs below to satisfy that.
// ROUTE HANDLER, not the opengraph-image file convention — deliberately. The convention
// auto-attaches og:image with a per-deploy build-hash query AND takes priority over explicit
// metadata images, so the crawler-facing URL rotated every deploy (cold render every time —
// Reddit's ~4s budget → permanently cached blank unfurls). This URL (/company/<slug>/og) is
// STABLE across deploys; app/company/[slug]/layout.tsx points og:image + twitter:image here.
export const runtime = 'nodejs'

const size = { width: 1200, height: 630 }

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const s = await getScore(slug)
  // Prefer the STORED canonical name — a slug can't carry punctuation, so titleCase(slug)
  // rendered "Lowe S" on the public unfurl where the company is actually "Lowe's".
  const name = s?.company_name ? displayCompanyName(s.company_name) : titleCase(slug)

  const score = s?.overall_score ?? null
  const accent = riskColor(s?.risk_level)
  const ghostPct = pct(s?.ghost_rate)
  const respPct = pct(s?.response_rate)
  const wait = s?.avg_wait_days != null ? Math.round(s.avg_wait_days) : null
  const letter = score != null ? grade(score) : null
  const hasData = score != null

  const stats: { label: string; value: string; color: string }[] = []
  if (ghostPct != null) stats.push({ label: 'Ghost rate', value: `${ghostPct}%`, color: '#ef4444' })
  if (respPct != null) stats.push({ label: 'Response rate', value: `${respPct}%`, color: '#10b981' })
  if (wait != null) stats.push({ label: 'Avg wait', value: `${wait}d`, color: '#f59e0b' })

  // Only FIRST-PARTY rows may be published as "applicant reports" — the fused count once put
  // the LLM's claimed web-mention number (e.g. "12,775 applicant reports") on every share unfurl.
  const fpOg = firstPartyReportCount(s)
  const footRight = fpOg > 0
    ? `${fpOg.toLocaleString()} applicant report${fpOg === 1 ? '' : 's'}`
    : 'Real applicant outcomes'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: '#05070f',
          backgroundImage:
            'radial-gradient(ellipse at 25% 0%, rgba(99,102,241,0.18) 0%, transparent 55%), radial-gradient(ellipse at 90% 100%, rgba(124,58,237,0.14) 0%, transparent 55%)',
          padding: '64px 72px', fontFamily: 'sans-serif',
        }}
      >
        {/* brand row */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', width: 16, height: 16, borderRadius: 999, background: '#3b82f6' }} />
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: '#f9fafb', marginLeft: 14 }}>Seen</div>
          <div style={{ display: 'flex', fontSize: 22, color: '#6b7280', marginLeft: 16 }}>hiring transparency</div>
        </div>

        {/* main */}
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', marginTop: 8 }}>
          {/* score ring */}
          <div
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              width: 300, height: 300, borderRadius: 999, border: `10px solid ${accent}`,
              background: 'rgba(255,255,255,0.03)', boxShadow: `0 0 80px ${accent}40`, flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', fontSize: hasData ? 150 : 110, fontWeight: 800, color: hasData ? accent : '#6b7280', lineHeight: 1 }}>
              {hasData ? letter : '?'}
            </div>
            {hasData && (
              <div style={{ display: 'flex', fontSize: 30, color: '#9ca3af', marginTop: 6 }}>{`${score}/100`}</div>
            )}
          </div>

          {/* text */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: 56 }}>
            <div style={{ display: 'flex', fontSize: 72, fontWeight: 800, color: '#f9fafb', lineHeight: 1.02 }}>{name}</div>

            {hasData ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginTop: 18 }}>
                  <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: accent, background: `${accent}1f`, border: `1px solid ${accent}55`, borderRadius: 8, padding: '8px 16px' }}>
                    {riskLabel(s?.risk_level)}
                  </div>
                  <div style={{ display: 'flex', fontSize: 24, color: '#9ca3af', marginLeft: 12 }}>Seen Grade</div>
                </div>
                <div style={{ display: 'flex', marginTop: 34 }}>
                  {stats.map((st) => (
                    <div key={st.label} style={{ display: 'flex', flexDirection: 'column', marginRight: 40 }}>
                      <div style={{ display: 'flex', fontSize: 52, fontWeight: 800, color: st.color }}>{st.value}</div>
                      <div style={{ display: 'flex', fontSize: 22, color: '#6b7280', marginTop: 4 }}>{st.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', fontSize: 30, color: '#9ca3af', marginTop: 20, maxWidth: 620, lineHeight: 1.4 }}>
                {`No applicant reports yet. Be the first to report how ${name} treats applicants.`}
              </div>
            )}
          </div>
        </div>

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 24 }}>
          <div style={{ display: 'flex', fontSize: 24, color: '#6b7280' }}>{`seenjobs.io/company/${slug}`}</div>
          <div style={{ display: 'flex', fontSize: 24, color: '#9ca3af' }}>{footRight}</div>
        </div>
      </div>
    ),
    {
      ...size,
      // Long CDN cache on the stable URL: one good crawl serves everyone; scores drift
      // slowly and a stale-while-revalidate refresh keeps the card current within a day.
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
    }
  )
}
