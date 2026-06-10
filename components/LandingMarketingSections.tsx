export default function LandingMarketingSections() {
  return (
    <>
      {/* SECTION 1: The problem */}
      <div style={{ position: 'relative', zIndex: 2, borderTop: '1px solid rgba(255,255,255,.06)', background: 'linear-gradient(to bottom,rgba(2,4,10,.6),rgba(2,4,10,.92))', padding: '5rem 2.5rem 4.5rem' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(239,68,68,.7)', marginBottom: '1.2rem' }}>The problem</div>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(2rem,6vw,3.8rem)', fontWeight: 800, lineHeight: 1.06, letterSpacing: '-.04em', color: 'var(--white)', margin: '0 0 1.5rem' }}>
            You spend 4 hours<br />on an application.<br />
            <span style={{ background: 'linear-gradient(135deg,#ef4444,#f97316)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              They spend 0 seconds<br />on a reply.
            </span>
          </h2>
          <p style={{ fontSize: '1rem', color: 'var(--sub)', fontWeight: 300, maxWidth: 540, margin: '0 auto 2.5rem', lineHeight: 1.7 }}>
            47% of companies ghost applicants entirely. Before Seen, you had no way to know which ones. Now you do.
          </p>
          <div className="lp-3stat">
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 14, padding: '1.5rem 1rem', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '1.8rem', fontWeight: 600, color: 'var(--red)', lineHeight: 1, marginBottom: '.4rem' }}>47%</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Never respond</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 14, padding: '1.5rem 1rem', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '1.8rem', fontWeight: 600, color: 'var(--white)', lineHeight: 1, marginBottom: '.4rem' }}>4.2h</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Per application</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 14, padding: '1.5rem 1rem', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '1.8rem', fontWeight: 600, color: 'var(--green)', lineHeight: 1, marginBottom: '.4rem' }}>124K+</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Reports verified</div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: How it works */}
      <div style={{ position: 'relative', zIndex: 2, background: 'rgba(2,4,10,.88)', padding: '5rem 2.5rem' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(99,102,241,.8)', marginBottom: '.8rem' }}>How it works</div>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.6rem,4vw,2.8rem)', fontWeight: 800, letterSpacing: '-.04em', color: 'var(--white)', margin: 0 }}>Three steps to stop getting blindsided</h2>
          </div>
          <div className="lp-3col">
            <div>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: '.8rem', fontWeight: 600, color: 'var(--indigo)', marginBottom: '1.1rem' }}>01</div>
              <h3 style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .55rem', letterSpacing: '-.02em' }}>Search any company</h3>
              <p style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.65, margin: 0 }}>Type the company name before you apply. Instantly see their transparency score, ghost rate, and average response time — built from real applicant reports.</p>
            </div>
            <div>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: '.8rem', fontWeight: 600, color: 'var(--green)', marginBottom: '1.1rem' }}>02</div>
              <h3 style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .55rem', letterSpacing: '-.02em' }}>Read real outcomes</h3>
              <p style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.65, margin: 0 }}>Every report is tagged by hiring outcome — offer, rejection, or ghosted. No anonymous rumors. Real data from people who actually went through the process.</p>
            </div>
            <div>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: '.8rem', fontWeight: 600, color: 'var(--red)', marginBottom: '1.1rem' }}>03</div>
              <h3 style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .55rem', letterSpacing: '-.02em' }}>Apply with leverage</h3>
              <p style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.65, margin: 0 }}>Track every application in your dashboard. Get alerted when a company hits a ghost surge. Know exactly when to follow up — and when to move on.</p>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: Features */}
      <div style={{ position: 'relative', zIndex: 2, background: 'linear-gradient(to bottom,rgba(2,4,10,.88),rgba(4,8,20,.96))', padding: '5rem 2.5rem', borderTop: '1px solid rgba(255,255,255,.05)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(16,185,129,.8)', marginBottom: '.8rem' }}>What you get — free</div>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.6rem,4vw,2.6rem)', fontWeight: 800, letterSpacing: '-.04em', color: 'var(--white)', margin: '0 0 .6rem' }}>Everything you need.<br />Nothing behind a paywall.</h2>
            <p style={{ fontSize: '.85rem', color: 'var(--sub)', margin: 0 }}>Until you want real-time ghost surge alerts — that&apos;s Pro.</p>
          </div>
          <div className="lp-2col">
            {[
              { icon: '🏢', title: 'Company scores', desc: 'Ghost rate, response speed, process rating for 47K+ companies', pro: false },
              { icon: '📋', title: 'Community reports', desc: '124K+ verified hiring experiences, filterable by outcome', pro: false },
              { icon: '🎯', title: 'Job search', desc: 'Search 50K+ jobs filtered by company score and ghost rate', pro: false },
              { icon: '📊', title: 'Application tracker', desc: 'Track every application, status, and follow-up in one place', pro: false },
              { icon: '👻', title: 'Ghost surge alerts', desc: 'Get notified when a company spikes in ghost reports — before you apply', pro: true },
              { icon: '⚡', title: 'Response speed index', desc: 'Predictive follow-up timing based on company-specific response patterns', pro: true },
            ].map(f => (
              <div key={f.title} style={{ background: f.pro ? 'rgba(99,102,241,.06)' : 'rgba(255,255,255,.025)', border: `1px solid ${f.pro ? 'rgba(99,102,241,.2)' : 'rgba(16,185,129,.15)'}`, borderRadius: 12, padding: '1.1rem 1.2rem', display: 'flex', alignItems: 'flex-start', gap: '.85rem' }}>
                <div style={{ fontSize: '1.2rem', flexShrink: 0, marginTop: '.05rem' }}>{f.icon}</div>
                <div>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.2rem' }}>
                    {f.title}
                    {f.pro && <span style={{ fontSize: '.65rem', background: 'rgba(99,102,241,.2)', border: '1px solid rgba(99,102,241,.3)', color: 'rgba(165,180,252,.8)', padding: '.1rem .45rem', borderRadius: 100, fontFamily: 'var(--mono)', verticalAlign: 'middle', marginLeft: '.4rem' }}>Pro</span>}
                  </div>
                  <div style={{ fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.55 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 4: Social proof + CTA */}
      <div style={{ position: 'relative', zIndex: 2, background: 'rgba(4,8,20,.96)', padding: '4.5rem 2.5rem', borderTop: '1px solid rgba(255,255,255,.05)' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.18em', color: 'rgba(255,255,255,.35)', marginBottom: '2rem' }}>From the community</div>
          <div className="lp-3col" style={{ textAlign: 'left', marginBottom: '3.5rem' }}>
            {[
              { quote: '"Checked the score before applying to a FAANG offer. 72% ghost rate. Decided to negotiate harder — they ghosted after the final round exactly like the reports said."', by: '— Software Engineer, San Francisco' },
              { quote: '"I used to apply to 15 companies hoping one would reply. Now I apply to 5 and 3 respond. The ghost rate filter changes everything."', by: '— Marketing Manager, Austin' },
              { quote: '"Found my current job through Seen. Searched my offer company first — A grade, 11% ghost rate, fast responder. Accepted immediately."', by: '— Product Designer, NYC' },
            ].map((t, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 14, padding: '1.4rem' }}>
                <div style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.7, marginBottom: '1rem', fontStyle: 'italic' }}>{t.quote}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)' }}>{t.by}</div>
              </div>
            ))}
          </div>

          {/* Final CTA */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,.07)', paddingTop: '3rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.8rem,4vw,3rem)', fontWeight: 800, letterSpacing: '-.04em', color: 'var(--white)', margin: '0 0 .8rem' }}>Stop applying blind.</h2>
            <p style={{ fontSize: '.9rem', color: 'var(--sub)', margin: '0 0 2rem', fontWeight: 300 }}>Join 80,000+ job seekers who check the score before they apply.</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <a href="/login" className="btn btn-green btn-lg" style={{ fontSize: '.9rem', padding: '.85rem 2.2rem', textDecoration: 'none' }}>Get started free →</a>
              <a href="/companies" style={{ background: 'none', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'rgba(255,255,255,.5)', cursor: 'pointer', padding: '.75rem 1.5rem', textDecoration: 'none' }}>Browse scores →</a>
            </div>
            <div style={{ marginTop: '1.2rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'rgba(255,255,255,.2)' }}>Free forever · No credit card · 30 seconds to start</div>
          </div>
        </div>
      </div>
    </>
  )
}
