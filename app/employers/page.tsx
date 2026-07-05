import { EmployerCheckout, EmployerPurchaseConfirm } from '@/components/EmployerCheckout'

export default function EmployersPage() {
  const tiers = [
    {
      name: 'Basic listing',
      price: 'Free',
      period: 'forever',
      highlight: false,
      features: [
        'Post up to 2 listings',
        'Public transparency score',
        'Location-level reports',
        'Standard placement',
      ],
      cta: 'Post for free',
      ctaHref: '/login?signup=1',
    },
    {
      name: 'Verified employer',
      price: '$149',
      period: '/month per location',
      highlight: true,
      badge: 'Most popular',
      features: [
        'Verified badge at your location',
        'Priority placement in your city',
        'Location transparency dashboard',
        'Process funnel analytics',
        'Applicant insight reports',
        'Waste score improvement tools',
      ],
      cta: 'Get verified →',
      ctaHref: 'mailto:hello@seenjobs.io?subject=Verified Employer',
    },
    {
      name: 'Multi-location',
      price: '$799',
      period: '/month all locations',
      highlight: false,
      badge: 'Enterprise',
      features: [
        'All locations verified',
        'Franchise-wide analytics',
        'Location comparison dashboard',
        'Dedicated account manager',
        'ATS integration',
      ],
      cta: 'Contact sales',
      ctaHref: 'mailto:hello@seenjobs.io?subject=Enterprise',
    },
  ]

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '4rem 2rem', width: '100%', boxSizing: 'border-box' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--blue)', marginBottom: '.6rem' }}>
            For employers
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '2.2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '1rem', maxWidth: 680, margin: '0 auto .75rem' }}>
            The companies that respond win everything.
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.9rem', lineHeight: 1.75, maxWidth: 580, margin: '0 auto 2rem' }}>
            Job seekers check Seen before they apply — and they check by location. A verified badge at your specific branch tells them your process is real, transparent, and worth their time before they ever hit apply.
          </p>
          <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {['👻 Ghost rate visible per location', '📍 City-level trust scores', '⚡ Surge alerts affect applications'].map(b => (
              <span key={b} className="vibe v-b" style={{ padding: '.35rem .85rem' }}>{b}</span>
            ))}
          </div>
        </div>

        {/* Post-checkout confirmation (renders only on the Stripe return) */}
        <EmployerPurchaseConfirm />

        {/* One-time products — real checkout, no account needed */}
        <div style={{ marginBottom: '1rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--dim)', marginBottom: '.4rem' }}>Start now · one-time · no account needed</div>
        </div>
        <EmployerCheckout />
        <div style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', marginBottom: '3rem', lineHeight: 1.6 }}>
          Payments never change a company&apos;s transparency score. Featured buys reach; Transparency Verified is a commitment we review against real applicant outcomes.
        </div>

        <div style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--dim)', marginBottom: '1.5rem' }}>Or go bigger — recurring plans</div>

        {/* Pricing tiers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1.25rem', marginBottom: '3rem' }}>
          {tiers.map(tier => (
            <div
              key={tier.name}
              style={{
                background: tier.highlight ? 'linear-gradient(135deg,rgba(59,130,246,0.08) 0%,rgba(124,58,237,0.08) 100%)' : 'var(--card)',
                border: `1.5px solid ${tier.highlight ? 'var(--blue)' : 'var(--line)'}`,
                borderRadius: 16, padding: '2rem', position: 'relative',
              }}
            >
              {tier.badge && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: tier.highlight ? 'var(--blue)' : 'var(--raised)', color: tier.highlight ? '#fff' : 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.58rem', fontWeight: 700, padding: '.2rem .75rem', borderRadius: 100, whiteSpace: 'nowrap', border: `1px solid ${tier.highlight ? 'var(--blue)' : 'var(--line)'}` }}>
                  {tier.badge}
                </div>
              )}
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: tier.highlight ? 'var(--blue)' : 'var(--dim)', marginBottom: '.5rem' }}>{tier.name}</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.15rem' }}>{tier.price}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>{tier.period}</div>
              <div style={{ marginBottom: '1.5rem' }}>
                {tier.features.map(f => (
                  <div key={f} style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)' }}>
                    <span style={{ color: tier.highlight ? 'var(--blue)' : 'var(--green)', flexShrink: 0 }}>✓</span> {f}
                  </div>
                ))}
              </div>
              <a
                href={tier.ctaHref}
                style={{
                  display: 'block', textAlign: 'center',
                  background: tier.highlight ? 'linear-gradient(135deg,#1d4ed8 0%,#7c3aed 100%)' : 'none',
                  border: tier.highlight ? 'none' : '1px solid var(--line2)',
                  borderRadius: 8, padding: '.75rem',
                  fontFamily: 'var(--display)', fontWeight: tier.highlight ? 800 : 600, fontSize: '.85rem',
                  color: tier.highlight ? '#fff' : 'var(--sub)',
                  textDecoration: 'none',
                  boxShadow: tier.highlight ? '0 0 24px rgba(29,78,216,0.3)' : 'none',
                }}
              >
                {tier.cta}
              </a>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div style={{ textAlign: 'center', padding: '2rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.5rem' }}>
            First 50 locations get 3 months free.
          </div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--sub)', marginBottom: '1rem' }}>
            Get in early. Be the employer job seekers already trust when they arrive.
          </p>
          <a
            href="mailto:hello@seenjobs.io?subject=Early Access Employer"
            style={{ display: 'inline-block', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', border: 'none', borderRadius: 8, padding: '.75rem 2rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', color: '#fff', textDecoration: 'none', boxShadow: '0 0 20px rgba(59,130,246,0.3)' }}
          >
            Get early access →
          </a>
        </div>
      </div>
    </div>
  )
}
