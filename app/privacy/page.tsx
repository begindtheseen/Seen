import type { Metadata } from 'next'
import Link from 'next/link'

// Privacy Policy — DRAFT for the owner's attorney to review.
// Accuracy priority: the "account access" section is written HONESTLY. The system's admin API
// (api/admin-stats.js) authenticates admins and, using Supabase service-role access and the auth
// admin API, CAN reach and modify account data for support, moderation, security, and operations
// (e.g. delete_user, set_user_password, grant_credits, set_pro, list_subscriptions, export). Those
// actions are recorded in an audit log. So we do NOT claim "we never access accounts" (that would be
// false). Instead: we access account data only to operate the service, support users, ensure
// security, and comply with law — never sold, never accessed for unrelated purposes.

export const metadata: Metadata = {
  title: 'Privacy Policy — What Seen Collects & How Account Data Is Used | Seen',
  description:
    'What Seen collects, how account data is used, who can access it (including administrators, for support and security), the processors we rely on, and your rights. Draft — pending legal review.',
  alternates: { canonical: 'https://seenjobs.io/privacy' },
  openGraph: {
    title: 'Privacy Policy | Seen',
    description:
      'What Seen collects, how account data is used and accessed, the processors we use, and your rights.',
    url: 'https://seenjobs.io/privacy',
    type: 'website',
    siteName: 'Seen',
  },
}

const wrap = { maxWidth: 760, margin: '0 auto', padding: '4rem 2rem', width: '100%', boxSizing: 'border-box' as const }
const h2 = { fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: '0 0 .65rem' } as const
const p = { fontFamily: 'var(--body)', fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.8, margin: '0 0 .9rem' } as const
const quote = { ...p, borderLeft: '2px solid var(--line2)', paddingLeft: '1rem' } as const
const li = { fontFamily: 'var(--body)', fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.8, marginBottom: '.35rem' } as const
const section = { marginBottom: '2rem' } as const
const link = { color: 'var(--blue)', textDecoration: 'none' } as const

export default function PrivacyPage() {
  return (
    <div className="rise-in" style={{ minHeight: '100vh' }}>
      <div style={wrap}>
        {/* Draft status banner */}
        <div style={{ background: 'var(--adim)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '2rem', fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--amber)', lineHeight: 1.7 }}>
          ⚠ Draft — pending legal review. This document has not been reviewed by a licensed attorney and is
          not legal advice. It describes Seen&apos;s current data practices as implemented; do not rely on it
          as final policy until counsel has approved it. Bracketed [PLACEHOLDER] items must be completed before
          publication.
        </div>

        <h1 style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', margin: '0 0 .35rem' }}>
          Privacy Policy
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.82rem', margin: '0 0 1.5rem' }}>
          Draft prepared 2026-07-19 · Effective date: [PLACEHOLDER] · Privacy questions?{' '}
          <a href="mailto:hello@seenjobs.io" style={link}>hello@seenjobs.io</a>
        </p>

        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.65rem 1rem', marginBottom: '2rem', lineHeight: 1.6 }}>
          🔒 We do not sell your personal data, and we do not access account data for purposes unrelated to
          running the service.
        </div>

        <div style={section}>
          <h2 style={h2}>1. Who we are</h2>
          <p style={p}>
            Seen (&ldquo;Seen,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is a hiring-transparency platform
            operated by [PLACEHOLDER — legal entity name], located at [PLACEHOLDER — business address]. This
            policy explains what we collect, how we use and protect it, who can access it, and the choices you
            have.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>2. What we collect</h2>
          <p style={p}><strong>If you create an account, we collect:</strong></p>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}>your email address and authentication credentials (managed by our auth provider);</li>
            <li style={li}>optional profile details you provide — name/display name, city, industry, experience level, and onboarding survey answers;</li>
            <li style={li}>content you add — application-tracker entries, saved jobs, submitted reports, and any resume text or file you upload (used for resume tools you request);</li>
            <li style={li}>your subscription, credit balance, and entitlement status;</li>
            <li style={li}>session and authentication tokens needed to keep you signed in.</li>
          </ul>
          <p style={p}><strong>If you submit a report without an account,</strong> we store the report text, the company name, a general location, a timestamp, and a hashed session identifier — not your name or email.</p>
          <p style={p}><strong>Automatically,</strong> we collect basic technical and usage data (such as request logs and, where enabled, privacy-conscious product-analytics events) to operate, secure, and improve the service. We use minimal, functional cookies/local storage; we do not run behavioral advertising.</p>
        </div>

        <div style={section}>
          <h2 style={h2}>3. How we use it</h2>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}>to provide the service — company scores, search, the tracker, resume tools, and reports;</li>
            <li style={li}>to operate accounts, process payments and subscriptions, and manage credits;</li>
            <li style={li}>to send transactional email you have asked for or that is necessary to the service;</li>
            <li style={li}>to provide support, investigate issues, moderate content, and prevent abuse and fraud;</li>
            <li style={li}>to keep the service secure and to comply with law.</li>
          </ul>
        </div>

        {/* THE HONEST ACCESS SECTION — the centerpiece of this draft */}
        <div style={section}>
          <h2 style={h2}>4. Who can access your account data</h2>
          <p style={p}>
            We want to be straightforward about this rather than overstate it. <strong>Authorized Seen
            administrators can access account data when it is necessary to run the service.</strong> Our systems
            include an administrative interface, protected by authenticated access, that can be used to provide
            support, moderate content, investigate abuse and security issues, manage subscriptions and credits,
            and — at a user&apos;s request or where required — reset access or delete an account and its data.
            Performing these functions can involve elevated access to the underlying database and authentication
            system.
          </p>
          <p style={quote}>
            In plain terms: we access account data only to operate the service, provide support, ensure
            security, and comply with law. We do <strong>not</strong> sell it, and we do <strong>not</strong>
            {' '}access it for purposes unrelated to running Seen. Administrative actions are recorded in an
            internal audit log, and access is limited to authorized personnel.
          </p>
          <p style={p}>
            We also rely on third-party service providers (below) who process data on our behalf under their
            own security and confidentiality obligations.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>5. Third-party processors</h2>
          <p style={p}>We share data with a small set of service providers strictly to run Seen. Each processes data only as needed to provide its service:</p>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}><strong>Supabase</strong> — database and user authentication.</li>
            <li style={li}><strong>Stripe</strong> — payment and subscription processing. Seen does not store full card numbers; Stripe handles payment details.</li>
            <li style={li}><strong>Vercel</strong> — application hosting and serverless infrastructure (including request logs).</li>
            <li style={li}><strong>Resend</strong> — delivery of transactional email.</li>
            <li style={li}><strong>PostHog</strong> — privacy-conscious product analytics, where enabled.</li>
            <li style={li}><strong>Anthropic</strong> — AI processing used for features such as summarizing public discussion and resume tools; inputs are sent for processing to generate the requested output.</li>
          </ul>
          <p style={p}>[PLACEHOLDER — counsel/owner to confirm this list is complete and current, and to add any data-processing agreements or sub-processor disclosures required.]</p>
        </div>

        <div style={section}>
          <h2 style={h2}>6. We do not sell your data</h2>
          <p style={p}>
            We do not sell, rent, or lease personal data, and we do not use it for third-party behavioral
            advertising or profiling. We may share data when required by valid legal process, to protect the
            rights and safety of users or the public, or in connection with a business transfer, in which case
            we will seek to protect your information consistent with this policy.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>7. Retention</h2>
          <p style={p}>
            We keep account data for as long as your account is active and as needed to provide the service,
            then delete or anonymize it within a reasonable period, except where longer retention is required
            by law or for legitimate business or security purposes. Reports and public-discussion items may be
            retained in aggregated or de-identified form. [PLACEHOLDER — counsel to set specific retention
            periods.]
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>8. Your rights and choices</h2>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}>access, correct, or update your account data;</li>
            <li style={li}>delete your account and associated data (available in-product and on request);</li>
            <li style={li}>request a copy/export of your data;</li>
            <li style={li}>opt out of non-essential analytics;</li>
            <li style={li}>exercise rights under applicable law, which may include CCPA/CPRA (California) and GDPR (EEA/UK) rights such as access, deletion, portability, and objection.</li>
          </ul>
          <p style={p}>To exercise any right, contact <a href="mailto:hello@seenjobs.io" style={link}>hello@seenjobs.io</a>. [PLACEHOLDER — counsel to confirm required disclosures, verification steps, and any jurisdiction-specific rights and appeal processes.]</p>
        </div>

        <div style={section}>
          <h2 style={h2}>9. Security, transfers, and children</h2>
          <p style={p}>
            We use reasonable administrative and technical safeguards, including access controls and audit
            logging for administrative actions. No system is perfectly secure. Data may be processed in the
            United States and other countries where our providers operate. Seen is not directed to children,
            and we do not knowingly collect data from anyone under [PLACEHOLDER — 16/18].
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>10. Changes and contact</h2>
          <p style={p}>
            We may update this policy and will revise the effective date above; material changes will be
            communicated as required. Questions or requests:{' '}
            <a href="mailto:hello@seenjobs.io" style={link}>hello@seenjobs.io</a>. See also our{' '}
            <Link href="/terms" style={link}>Terms of Service</Link> and{' '}
            <Link href="/content-policy" style={link}>Content Policy</Link>.
          </p>
        </div>

        <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', marginTop: '2rem', lineHeight: 1.7 }}>
          Draft — pending legal review. Seen is not a law firm and nothing here is legal advice.
        </p>
      </div>
    </div>
  )
}
