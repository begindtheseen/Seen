import LandingHero from '@/components/LandingHero'
import LandingMarketingSections from '@/components/LandingMarketingSections'
import ScrollIndicator from '@/components/ScrollIndicator'

const TICKER_DATA = [
  { name: 'AMAZON',    loc: 'Seattle',        score: 24, risk: 'danger' },
  { name: 'META',      loc: 'Menlo Park',     score: 38, risk: 'danger' },
  { name: 'STRIPE',    loc: 'Remote',         score: 88, risk: 'safe'   },
  { name: 'LINEAR',    loc: 'Remote',         score: 91, risk: 'safe'   },
  { name: 'SHOPIFY',   loc: 'Remote',         score: 82, risk: 'safe'   },
  { name: 'ACCENTURE', loc: 'Chicago',        score: 29, risk: 'danger' },
  { name: 'NOTION',    loc: 'Remote',         score: 71, risk: 'safe'   },
  { name: 'DELOITTE',  loc: 'New York',       score: 33, risk: 'danger' },
  { name: 'INDEED',    loc: 'Austin',         score: 31, risk: 'danger' },
  { name: 'APPLE',     loc: 'Cupertino',      score: 72, risk: 'safe'   },
  { name: 'GOOGLE',    loc: 'Mountain View',  score: 67, risk: 'safe'   },
  { name: 'MICROSOFT', loc: 'Redmond',        score: 76, risk: 'safe'   },
  { name: 'NETFLIX',   loc: 'Los Gatos',      score: 74, risk: 'safe'   },
  { name: 'UBER',      loc: 'San Francisco',  score: 51, risk: 'warn'   },
  { name: 'AIRBNB',    loc: 'San Francisco',  score: 80, risk: 'safe'   },
  { name: 'X (TWITTER)', loc: 'San Francisco', score: 27, risk: 'danger' },
  { name: 'SALESFORCE', loc: 'San Francisco', score: 57, risk: 'warn'   },
  { name: 'ORACLE',    loc: 'Austin',         score: 39, risk: 'danger' },
  { name: 'IBM',       loc: 'Armonk',         score: 33, risk: 'danger' },
  { name: 'TESLA',     loc: 'Austin',         score: 44, risk: 'warn'   },
  { name: 'MCKINSEY',  loc: 'New York',       score: 84, risk: 'safe'   },
  { name: 'PWC',       loc: 'New York',       score: 53, risk: 'warn'   },
  { name: 'WALMART',   loc: 'Bentonville',    score: 35, risk: 'danger' },
  { name: 'TARGET',    loc: 'Minneapolis',    score: 62, risk: 'safe'   },
  { name: 'LYFT',      loc: 'San Francisco',  score: 48, risk: 'warn'   },
  { name: 'COINBASE',  loc: 'Remote',         score: 61, risk: 'safe'   },
  { name: 'FIGMA',     loc: 'San Francisco',  score: 85, risk: 'safe'   },
  { name: 'VERCEL',    loc: 'Remote',         score: 89, risk: 'safe'   },
]

function TickerItems() {
  return (
    <>
      {TICKER_DATA.map((item, i) => (
        <span key={i}>
          <span className="tick">
            <span className="tco">{item.name}</span>
            <span className="tloc">{item.loc}</span>
            <span className={`ts ${item.risk}`}>{item.score}</span>
          </span>
          <span className="tdiv">·</span>
        </span>
      ))}
    </>
  )
}

export default function LandingPage() {
  return (
    <div className="page-full active" style={{ position: 'relative' }}>

      {/* Cosmos background — matches origin/main landing exactly */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at 18% 65%, rgba(29,78,216,0.55) 0%, transparent 52%), radial-gradient(ellipse at 82% 28%, rgba(124,58,237,0.48) 0%, transparent 48%), radial-gradient(ellipse at 55% 92%, rgba(8,145,178,0.22) 0%, transparent 42%), radial-gradient(ellipse at 8% 12%, rgba(99,102,241,0.32) 0%, transparent 38%), radial-gradient(ellipse at 72% 78%, rgba(139,92,246,0.2) 0%, transparent 40%), #02040a' }}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(to bottom, rgba(2,4,10,0.05) 0%, transparent 30%, transparent 55%, rgba(2,4,10,0.82) 88%, #02040a 100%)' }} />
      </div>

      {/* TICKER */}
      <div className="ticker-wrap" style={{ position: 'relative', zIndex: 2, flexShrink: 0 }}>
        <div className="ticker-track">
          <TickerItems />
          <TickerItems />
        </div>
      </div>

      {/* MAIN CONTENT — interactive client component */}
      <LandingHero />

      {/* SCROLL INDICATOR */}
      <ScrollIndicator />

      {/* DISCLAIMER */}
      <div style={{ position: 'relative', zIndex: 2, padding: '.7rem 2.5rem', fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', gap: '1.2rem', flexWrap: 'wrap' }}>
        <span>Free for job seekers</span>
        <span style={{ color: 'rgba(255,255,255,.12)' }}>·</span>
        <span>No account required to search</span>
        <span style={{ color: 'rgba(255,255,255,.12)' }}>·</span>
        <a href="/legal" style={{ color: 'rgba(255,255,255,.22)', textDecoration: 'underline' }}>Legal</a>
        <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.15)' }}>© 2025 Seen. All rights reserved.</span>
      </div>

      {/* BELOW FOLD SECTIONS */}
      <div id="lpBelowFold">
        <LandingMarketingSections />
      </div>

      {/* LANDING FOOTER */}
      <div style={{ position: 'relative', zIndex: 2, padding: '.9rem 2.5rem', background: 'rgba(2,4,10,.98)', borderTop: '1px solid rgba(255,255,255,.05)', fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', gap: '1.2rem', flexWrap: 'wrap' }}>
        <span>Free for job seekers</span>
        <span style={{ color: 'rgba(255,255,255,.12)' }}>·</span>
        <span>No account required to search</span>
        <span style={{ color: 'rgba(255,255,255,.12)' }}>·</span>
        <a href="/legal" style={{ color: 'rgba(255,255,255,.22)', textDecoration: 'underline' }}>Legal</a>
        <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.15)' }}>© 2025 Seen. All rights reserved.</span>
      </div>

    </div>
  )
}
