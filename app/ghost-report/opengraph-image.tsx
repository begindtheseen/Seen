import { ImageResponse } from 'next/og'
import { getLeaderboard, getScoresByNames, riskColor } from '@/lib/growth'
import { STAFFING_AGENCIES } from '@/lib/agencies'
import { assembleGhostReport, weekProvenance } from '@/lib/server/ghostReport'

// Share card for the Weekly Ghost Report — the virality lever. Renders the REAL snapshot (top
// reported ghosters + headline stats) in an on-brand 1200×630 card so pasting the /ghost-report
// link anywhere unfurls with live data. Reads cached scores directly from Supabase (never a
// self-fetch of the live API — see lib/growth.ts). When there's no reported data yet we render an
// honest "index is filling" card, never a fabricated number or a blank preview.
//
// Satori (next/og) rule: every <div> with more than one child MUST set display:flex.

export const runtime = 'nodejs'
export const revalidate = 3600
export const alt = 'The Weekly Ghost Report on Seen'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  const agencyAliases = STAFFING_AGENCIES.flatMap((a) => a.aliases)
  const [leaderboard, agencyMap] = await Promise.all([getLeaderboard(), getScoresByNames(agencyAliases)])
  const byName = new Map<string, (typeof leaderboard)[number]>()
  for (const r of leaderboard) if (r?.name) byName.set(r.name.toLowerCase(), r)
  for (const [name, r] of agencyMap) if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), r)
  const { weekLabel, weekNumber } = weekProvenance(new Date())
  const report = assembleGhostReport([...byName.values()], { agencyNames: agencyAliases.map((a) => a.toLowerCase()), topN: 3, weekLabel, weekNumber })

  const h = report.headline
  const top = report.worstOffenders.slice(0, 3)
  const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: '#05070f',
          backgroundImage:
            'radial-gradient(ellipse at 25% 0%, rgba(239,68,68,0.16) 0%, transparent 55%), radial-gradient(ellipse at 90% 100%, rgba(124,58,237,0.14) 0%, transparent 55%)',
          padding: '58px 68px', fontFamily: 'sans-serif',
        }}
      >
        {/* brand + week */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', width: 16, height: 16, borderRadius: 999, background: '#3b82f6' }} />
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: '#f9fafb', marginLeft: 14 }}>Seen</div>
            <div style={{ display: 'flex', fontSize: 22, color: '#6b7280', marginLeft: 16 }}>Weekly Ghost Report</div>
          </div>
          {report.weekLabel && <div style={{ display: 'flex', fontSize: 20, color: '#6b7280' }}>{report.weekLabel}</div>}
        </div>

        {report.hasReported ? (
          <div style={{ display: 'flex', flex: 1, marginTop: 30 }}>
            {/* headline stats */}
            <div style={{ display: 'flex', flexDirection: 'column', width: 360, flexShrink: 0, justifyContent: 'center' }}>
              <div style={{ display: 'flex', fontSize: 132, fontWeight: 800, color: '#ef4444', lineHeight: 1 }}>{h.avgGhostRatePct != null ? `${h.avgGhostRatePct}%` : `${h.reportsTotal}`}</div>
              <div style={{ display: 'flex', fontSize: 26, color: '#9ca3af', marginTop: 10, maxWidth: 340, lineHeight: 1.3 }}>
                {h.avgGhostRatePct != null ? 'average reported ghost rate' : 'applicant reports and counting'}
              </div>
              <div style={{ display: 'flex', fontSize: 22, color: '#6b7280', marginTop: 24 }}>
                {h.reportsTotal.toLocaleString()} reports · {h.companiesTracked} companies
              </div>
            </div>

            {/* top reported ghosters */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: 44, justifyContent: 'center' }}>
              <div style={{ display: 'flex', fontSize: 22, color: '#9ca3af', marginBottom: 18, textTransform: 'uppercase', letterSpacing: 2 }}>Most-reported ghosters</div>
              {top.map((r, i) => (
                <div key={r.name} style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ display: 'flex', fontSize: 26, color: '#4b5563', width: 34 }}>{i + 1}</div>
                  <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: '#f9fafb', flex: 1 }}>{cap(r.name)}</div>
                  <div style={{ display: 'flex', fontSize: 34, fontWeight: 800, color: riskColor(r.riskLevel), marginLeft: 12 }}>{r.ghostPct}%</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
            <div style={{ display: 'flex', fontSize: 42, color: '#e5e7eb', lineHeight: 1.35, maxWidth: 900 }}>
              A public ghost-rate index, built from real applicant reports. It&apos;s filling now — no fabricated numbers, ever. Add yours.
            </div>
          </div>
        )}

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 22 }}>
          <div style={{ display: 'flex', fontSize: 24, color: '#6b7280' }}>seenjobs.io/ghost-report</div>
          <div style={{ display: 'flex', fontSize: 24, color: '#9ca3af' }}>Real applicant outcomes</div>
        </div>
      </div>
    ),
    size,
  )
}
