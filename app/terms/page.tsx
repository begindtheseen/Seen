import type { Metadata } from 'next'
import Link from 'next/link'

// Terms of Service — DRAFT for the owner's attorney to review.
// Standard aggregator terms: eligibility/accounts, acceptable use, that content is informational and
// user- and third-party-sourced with no warranty of accuracy, the dispute process (see Content Policy),
// employer/portal terms, subscriptions/billing (Stripe), IP, liability limits, indemnity, and changes.
// Governing law / venue / arbitration are left as [PLACEHOLDER] — do not invent a jurisdiction.

export const metadata: Metadata = {
  title: 'Terms of Service | Seen',
  description:
    'The terms for using Seen: eligibility, acceptable use, that data is informational and user- and third-party-sourced, no warranty of accuracy, disputes, employer terms, subscriptions, and liability limits. Draft — pending legal review.',
  alternates: { canonical: 'https://seenjobs.io/terms' },
  openGraph: {
    title: 'Terms of Service | Seen',
    description:
      'Eligibility, acceptable use, informational-data disclaimer, disputes, employer terms, subscriptions, and liability limits.',
    url: 'https://seenjobs.io/terms',
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

export default function TermsPage() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={wrap}>
        {/* Draft status banner */}
        <div style={{ background: 'var(--adim)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '2rem', fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--amber)', lineHeight: 1.7 }}>
          ⚠ Draft — pending legal review. This document has not been reviewed by a licensed attorney and is not
          legal advice. Do not rely on it as a binding agreement until counsel has approved it. Bracketed
          [PLACEHOLDER] items — including the governing-law and dispute-resolution terms — must be completed
          before publication.
        </div>

        <h1 style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', margin: '0 0 .35rem' }}>
          Terms of Service
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.82rem', margin: '0 0 2.5rem' }}>
          Draft prepared 2026-07-19 · Effective date: [PLACEHOLDER] · Questions?{' '}
          <a href="mailto:hello@seenjobs.io" style={link}>hello@seenjobs.io</a>
        </p>

        <div style={section}>
          <h2 style={h2}>1. Acceptance</h2>
          <p style={p}>
            These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between you and [PLACEHOLDER — legal
            entity name] (&ldquo;Seen,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), which operates the Seen
            platform at seenjobs.io. By accessing or using Seen, you agree to these Terms, our{' '}
            <Link href="/privacy" style={link}>Privacy Policy</Link>, and our{' '}
            <Link href="/content-policy" style={link}>Content Policy</Link>. If you do not agree, do not use Seen.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>2. Eligibility and accounts</h2>
          <p style={p}>
            You must be at least 18 years old to use Seen. You are responsible for the activity under your
            account and for keeping your credentials secure. Provide accurate information and keep it current.
            You may close your account at any time.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>3. The service is informational — no warranty of accuracy</h2>
          <p style={p}>
            Seen aggregates content from two sources — reports submitted by applicants about their own
            experiences, and publicly available third-party discussion — and presents aggregate statistics
            derived from that content. As explained in our{' '}
            <Link href="/content-policy" style={link}>Content Policy</Link>:
          </p>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}>individual reports and discussion reflect the views and experiences of the people who wrote them, not Seen&apos;s own assertions of fact;</li>
            <li style={li}>company metrics (ghost rate, response rate, wait time, Seen Grade) are summaries of self-reported outcomes, not adjudicated facts about any company; and</li>
            <li style={li}>Seen does not independently verify the underlying events.</li>
          </ul>
          <p style={quote}>
            The service and all content are provided for general informational purposes only, on an
            &ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; basis. We make no warranty as to the accuracy,
            completeness, reliability, or timeliness of any content or metric. Nothing on Seen is legal,
            employment, financial, or professional advice, and you should not treat it as a hiring or business
            decision on its own.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>4. Acceptable use</h2>
          <p style={p}>You agree not to:</p>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}>submit false, fabricated, or coordinated inauthentic content;</li>
            <li style={li}>post personal information about, or content that targets, a private individual;</li>
            <li style={li}>harass, threaten, impersonate, or post hate speech or unlawful content;</li>
            <li style={li}>scrape, harvest, or bulk-extract data, or use bots or automated access except as we expressly permit;</li>
            <li style={li}>reverse-engineer, disrupt, or attempt to gain unauthorized access to the service;</li>
            <li style={li}>use Seen to build a competing product or for unlawful purposes.</li>
          </ul>
          <p style={p}>We may moderate, remove content, or suspend or terminate accounts that violate these Terms or our Content Policy.</p>
        </div>

        <div style={section}>
          <h2 style={h2}>5. Your content and license</h2>
          <p style={p}>
            You retain ownership of the content you submit. By submitting a report or other content, you
            represent that it describes a genuine first-hand experience, is truthful to the best of your
            knowledge, does not identify or include personal information about individuals, and that you have the
            right to share it. You grant Seen a worldwide, non-exclusive, royalty-free license to host, display,
            reproduce, and use that content to operate and promote the service, including in aggregated or
            de-identified form. [PLACEHOLDER — counsel to confirm license scope and duration.]
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>6. Disputes about content</h2>
          <p style={p}>
            Companies and individuals may dispute specific content through the process described in our{' '}
            <Link href="/content-policy" style={link}>Content Policy</Link>. In summary, we will act on personal
            information, threats, fabrication, and unlawful content, and we will consider corrections and
            official company responses — but we do not remove content merely because it is negative or
            unflattering.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>7. Employer and company terms</h2>
          <p style={p}>
            Employers and their representatives may access company-facing features (for example, claiming a
            company presence, submitting an official response, or purchasing employer products and reports).
            Employer purchases are processed through our payment provider and are subject to these Terms. By
            using employer features you represent that you are authorized to act for the company.
          </p>
          <p style={quote}>
            Employer features do not let a company buy the removal, alteration, or suppression of genuine,
            policy-compliant applicant content, or the manipulation of any metric. Official responses are
            attributed as the company&apos;s statement. [PLACEHOLDER — counsel/owner to confirm employer product
            terms, refunds, and any service-level commitments.]
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>8. Subscriptions and billing</h2>
          <p style={p}>
            Some features are offered as a paid subscription billed through our payment processor (Stripe).
            Paid plans renew automatically until cancelled; you can cancel at any time from your billing
            settings, and cancellation stops future renewals while access continues through the end of the
            paid period. Current pricing and plan details are shown at checkout and on our{' '}
            <Link href="/pricing" style={link}>pricing page</Link>. Charges are generally non-refundable except
            where required by law. [PLACEHOLDER — counsel to confirm auto-renewal disclosures, refund terms, and
            any jurisdiction-specific cancellation requirements.]
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>9. Intellectual property</h2>
          <p style={p}>
            The Seen name, software, design, and original content are owned by Seen or its licensors. Company
            names, logos, and trademarks belong to their respective owners and are used to identify the
            companies that reports and discussion concern; their use does not imply affiliation or endorsement.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>10. Disclaimers and limitation of liability</h2>
          <p style={p}>
            To the fullest extent permitted by law, Seen and its operators disclaim all warranties, express or
            implied, including merchantability, fitness for a particular purpose, and non-infringement. Seen
            will not be liable for indirect, incidental, special, consequential, or punitive damages, or for any
            loss arising from your reliance on content or metrics.
          </p>
          <p style={quote}>
            Our total liability for any claim relating to the service is limited to the greater of the amount
            you paid us in the [PLACEHOLDER — e.g., 12] months before the claim or [PLACEHOLDER — e.g., US$100].
            Some jurisdictions do not allow certain limitations, so parts of this section may not apply to you.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>11. Indemnification</h2>
          <p style={p}>
            You agree to indemnify and hold harmless Seen and its operators from claims arising out of content
            you submit, your use of the service, your violation of these Terms, or your infringement of any
            third-party right, to the extent permitted by law.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>12. Governing law and dispute resolution</h2>
          <p style={p}>
            These Terms are governed by the laws of [PLACEHOLDER — governing law / jurisdiction], without regard
            to conflict-of-laws rules. Any dispute will be resolved in [PLACEHOLDER — venue and/or arbitration
            terms, including any class-action waiver and any consumer carve-outs]. These provisions are left
            blank intentionally and must be set by counsel.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>13. Changes and contact</h2>
          <p style={p}>
            We may update these Terms and will revise the effective date above; material changes will be
            communicated as required, and your continued use after the effective date constitutes acceptance.
            Questions: <a href="mailto:hello@seenjobs.io" style={link}>hello@seenjobs.io</a>.
          </p>
        </div>

        <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', marginTop: '2rem', lineHeight: 1.7 }}>
          Draft — pending legal review. Seen is not a law firm and nothing here is legal advice.
        </p>
      </div>
    </div>
  )
}
