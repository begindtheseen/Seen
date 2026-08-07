import type { Metadata } from 'next'
import Link from 'next/link'
import { EmployerNav, EmployerFooter } from '@/components/employer/EmployerNav'
import { shapeVerifiedDirectory } from '@/lib/server/verifiedDirectory'

// Public "companies that respond" directory (Wave 3). Lists currently Transparency-Verified employers
// next to their real public grade/response-rate. Doubles as SEO acquisition and the reason the badge
// is worth buying. Reads live perks server-side with the service key (employer_perks is service-key
// only), exactly like the other server reads. Integrity: money never bought these numbers — Verified
// is a reviewed commitment; this page only displays it beside the unmodified transparency score.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Companies That Respond — Transparency Verified employers | Seen',
  description:
    'Employers who publicly committed to responding to applicants, verified against real outcome data. See their ghost rate, response rate, and Seen grade before you apply.',
  alternates: { canonical: 'https://seenjobs.io/employers/verified' },
  openGraph: {
    title: 'Companies That Respond — Transparency Verified on Seen',
    description: 'Employers who commit to responding to applicants — verified against real outcomes, never bought.',
    url: 'https://seenjobs.io/employers/verified', type: 'website', siteName: 'Seen',
  },
}

type Row = { company: string; slug: string; grade: string | null; score: number | null; responseRate: number | null; ghostRate: number | null; reportCount: number }

async function fetchDirectory(): Promise<Row[]> {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) return []
  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  const nowISO = new Date().toISOString()
  try {
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/employer_perks?verified_until=gt.${encodeURIComponent(nowISO)}&select=company,verified_until&limit=500`, { headers: h, cache: 'no-store' })
    const perks = pRes.ok ? await pRes.json() : []
    if (!Array.isArray(perks) || !perks.length) return []
    const names = [...new Set(perks.map((p: { company?: string }) => String(p.company || '').toLowerCase()).filter(Boolean))]
    let scores: unknown[] = []
    if (names.length) {
      const inList = names.map(n => `"${n.replace(/"/g, '')}"`).join(',')
      const sRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=in.(${encodeURIComponent(inList)})&select=company_name,overall_score,ghost_rate,response_rate,report_count&limit=500`, { headers: h, cache: 'no-store' })
      scores = sRes.ok ? await sRes.json() : []
    }
    return shapeVerifiedDirectory(perks, scores as Parameters<typeof shapeVerifiedDirectory>[1], Date.now())
  } catch {
    return []
  }
}

const wrap = { maxWidth: 900, margin: '0 auto', padding: '0 1.5rem', width: '100%', boxSizing: 'border-box' as const }
const gradeColor = (g: string | null) => (g === 'A' || g === 'B' ? 'var(--green)' : g === 'C' ? 'var(--amber)' : g == null ? 'var(--muted)' : 'var(--red)')

export default async function VerifiedDirectoryPage() {
  const companies = await fetchDirectory()

  return (
    <div className="rise-in" style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 15% -5%,rgba(29,78,216,0.12) 0%,transparent 55%),radial-gradient(ellipse at 100% 5%,rgba(124,58,237,0.09) 0%,transparent 45%)' }}>
      <EmployerNav />

      <div style={{ ...wrap, padding: '3.5rem 1.5rem 5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--green)', marginBottom: '.7rem' }}>Transparency Verified</div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.9rem,6vw,2.7rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.05, margin: '0 auto .9rem', maxWidth: 640 }}>
            Companies that actually respond.
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.95rem', lineHeight: 1.75, maxWidth: 560, margin: '0 auto' }}>
            These employers publicly committed to responding to applicants — a commitment we review against real outcome data. The grade and rates are their true public reputation, never bought.
          </p>
        </div>

        {companies.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '2.4rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.8rem', marginBottom: '.5rem' }}>✓</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.4rem' }}>No verified employers yet</div>
            <p style={{ color: 'var(--sub)', fontSize: '.82rem', lineHeight: 1.65, maxWidth: 440, margin: '0 auto 1.4rem' }}>
              The first employers to commit to responding will be listed here. If you hire, be one of them.
            </p>
            <Link href="/employers#promote" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 9, padding: '.7rem 1.6rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', color: '#fff', textDecoration: 'none' }}>Get Transparency Verified →</Link>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: '1rem' }}>
              {companies.map(c => (
                <Link key={c.slug} href={`/company/${c.slug}`} style={{ display: 'block', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.3rem', textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem', marginBottom: '.9rem' }}>
                    <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--raised)', border: '1px solid var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.2rem', color: 'var(--white)', flexShrink: 0, textTransform: 'uppercase' }}>{c.company[0] || '?'}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: '.15rem' }}>✓ Verified</div>
                    </div>
                    <div style={{ fontFamily: 'var(--display)', fontSize: '1.6rem', fontWeight: 800, color: gradeColor(c.grade), lineHeight: 1, flexShrink: 0 }}>{c.grade ?? '—'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '1.2rem' }}>
                    <div><div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 800, color: 'var(--green)' }}>{c.responseRate == null ? '—' : `${c.responseRate}%`}</div><div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>response</div></div>
                    <div><div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 800, color: 'var(--red)' }}>{c.ghostRate == null ? '—' : `${c.ghostRate}%`}</div><div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>ghost</div></div>
                    <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}><div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--muted)' }}>{c.reportCount || 0} report{c.reportCount === 1 ? '' : 's'}</div></div>
                  </div>
                </Link>
              ))}
            </div>

            <div style={{ textAlign: 'center', marginTop: '3rem', padding: '2rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16 }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.5rem' }}>Hire people who show up?</div>
              <p style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', marginBottom: '1rem', lineHeight: 1.6 }}>Commit to responding to applicants and earn the Transparency Verified badge — reviewed against your real outcomes.</p>
              <Link href="/employers#promote" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 9, padding: '.7rem 1.8rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', color: '#fff', textDecoration: 'none' }}>Get Verified →</Link>
            </div>
          </>
        )}
      </div>
      <EmployerFooter />
    </div>
  )
}
