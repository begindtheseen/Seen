export default function LegalPage() {
  const sections = [
    {
      title: 'Terms of Service',
      body: `By accessing Seen you agree to these terms. You must be 18 or older. Use is personal and non-commercial only — no scraping, no building competitive products. You are responsible for your account. Prohibited conduct includes: false reports, sharing personal information about individuals, coordinated inauthentic activity, bots, impersonation, harassment, and reverse-engineering. We reserve the right to suspend accounts that violate these terms. We may update terms with material change notice.`,
    },
    {
      title: 'Section 230 & User-Generated Content',
      body: `Seen operates as an interactive computer service under 47 U.S.C. § 230 and is not liable for user-submitted content. By submitting a report, you represent that it reflects a genuine first-hand experience, is truthful to the best of your knowledge, contains no personal identifying information about individuals, and that you have the right to share it. You grant Seen a perpetual, irrevocable, royalty-free license to use submitted content. We moderate content at our discretion. Report abuse to hello@tryseen.io — we review within 14 business days.`,
    },
    {
      title: 'Scores, Ratings & Data Disclaimer',
      body: `All scores are expressions of aggregated community opinion, not verified facts — not endorsements or definitive characterizations of any company. Ghost surge alerts are statistical signals, not accusations. Sample size limitations apply to all metrics. We provide no warranty on accuracy, completeness, or timeliness of any data. Nothing on Seen constitutes employment, legal, or financial advice. AI-generated content is clearly labeled and inherently probabilistic. All company names and trademarks belong to their respective owners.`,
    },
    {
      title: 'Privacy Policy',
      body: `Anonymous users: We store only report text, company name, location, timestamp, and a hashed session ID. Registered users: We store email, optional display name, application data, and auth tokens. Pro waitlist: Email only, for launch notification. We use aggregated/anonymized page views only. We never sell, rent, or lease personal data. No behavioral advertising, no profiling. Cookies/local storage: minimal functional only (no tracking pixels). Third-party processors: Supabase (database/auth), Anthropic (AI). Data retention: anonymous reports indefinite; registered accounts until deletion. Not directed at minors. Privacy requests: hello@tryseen.io`,
    },
    {
      title: 'CCPA & GDPR Rights',
      body: `California residents have the right to: (a) know what data we collect, (b) request deletion, (c) opt out of sale (moot — we don't sell), (d) non-discrimination for exercising rights. European residents have the right to: access, rectify, erasure, restrict processing, data portability, object to processing, and withdraw consent. Data may be transferred to the US. To exercise any right, contact hello@tryseen.io.`,
    },
    {
      title: 'Arbitration & Limitation of Liability',
      body: `Disputes are resolved through binding arbitration under AAA Consumer Rules. You waive the right to a jury trial and class action (except small claims or injunctions). The platform is provided "AS IS" with no warranty. Liability is capped at the greater of (a) amounts you paid in the prior 12 months or (b) $100 USD. You agree to indemnify Seen for violations of these terms, content you submit, infringement of third-party rights, or illegal use of the platform. Governed by California law; venue in Los Angeles County.`,
    },
    {
      title: 'Employer & Company Dispute Process',
      body: `To dispute content: provide your name/title/company, the specific content at issue, the reason it violates our guidelines (factual inaccuracy, personal info, or clear fabrication — not simply "it's negative"), and supporting evidence. We review within 14 business days. We will remove: personal identifying information, explicit threats, demonstrably fabricated content. We will NOT remove: negative experiences, ghosting reports, criticisms, misleading job postings — these are protected speech. Employers may submit an official response alongside disputed content. We comply with valid legal process and will contest demands designed to suppress user speech.`,
    },
    {
      title: 'Content Guidelines',
      body: `Reports must: describe a genuine first-hand hiring experience, focus on the company's process (not named individuals), and reflect something you personally experienced or witnessed. Reports must NOT: include personal contact info (phone/email/address), assert unknown facts as certain, contain threats/hate speech/slurs, include promotional URLs, or represent coordinated inauthentic activity. We will remove: personal identifying info, explicit threats, demonstrably fabricated or coordinated content, hate speech. We will NOT remove: accurate ghosting accounts, misleading job description reports, disrespectful hiring behavior reports, honest subjective assessments, or genuine applicant experiences.`,
    },
  ]

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '4rem 2rem', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ background: 'var(--adim)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '2rem', fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--amber)', lineHeight: 1.7 }}>
          ⚠ Important: Seen is not a law firm and nothing on this platform constitutes legal advice. Company scores and ghost surge indicators are expressions of community opinion, not verified facts. If you have a dispute with an employer, consult a licensed employment attorney.
        </div>

        <h1 style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.35rem' }}>
          Legal & Privacy
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.82rem', marginBottom: '2.5rem' }}>
          Last updated: June 2026 · Questions? <a href="mailto:hello@tryseen.io" style={{ color: 'var(--blue)', textDecoration: 'none' }}>hello@tryseen.io</a>
        </p>

        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.65rem 1rem', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          🔒 We do not sell your personal data. Ever.
        </div>

        {sections.map(section => (
          <div key={section.title} style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', marginBottom: '.65rem' }}>
              {section.title}
            </h2>
            <p style={{ fontFamily: 'var(--body)', fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.8, borderLeft: '2px solid var(--line2)', paddingLeft: '1rem', margin: 0 }}>
              {section.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
