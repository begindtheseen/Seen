import type { Metadata } from 'next'
import Link from 'next/link'
import { DraftNote, Placeholder, LegalFooter, LEGAL_CONTACT } from '@/components/legal/LegalBits'

// Content Policy — how Seen sources, attributes, and stands behind the content it hosts.
// DRAFT for the owner's attorney to review. This page describes the platform's neutral-aggregator
// posture accurately, grounded in how the system actually works (api/reports.js Reddit ingest +
// PUBLIC_DISCUSSION_LABEL, user-submitted reports as first-hand claims, aggregate statistics).
// It states well-known principles (third-party content, opinion, truth) WITHOUT asserting legal
// conclusions — a licensed attorney must confirm the posture before anyone relies on it.

export const metadata: Metadata = {
  title: 'Content Policy — How Seen Sources & Stands Behind Its Content',
  description:
    'How Seen aggregates third-party public discussion and user-submitted reports, attributes them, computes aggregate statistics, and handles disputes and corrections.',
  alternates: { canonical: 'https://seenjobs.io/content-policy' },
  openGraph: {
    title: 'Content Policy | Seen',
    description:
      'How Seen sources, attributes, and stands behind its content — third-party discussion, first-hand reports, and aggregate statistics.',
    url: 'https://seenjobs.io/content-policy',
    type: 'website',
    siteName: 'Seen',
    images: ['/opengraph-image'],
  },
}

const wrap = { maxWidth: 760, margin: '0 auto', padding: '4rem 2rem', width: '100%', boxSizing: 'border-box' as const }
const h2 = { fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: '0 0 .65rem' } as const
const p = { fontFamily: 'var(--body)', fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.8, margin: '0 0 .9rem' } as const
const quote = { ...p, borderLeft: '2px solid var(--line2)', paddingLeft: '1rem' } as const
const li = { fontFamily: 'var(--body)', fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.8, marginBottom: '.35rem' } as const
const section = { marginBottom: '2rem' } as const
const link = { color: 'var(--blue)', textDecoration: 'none' } as const

export default function ContentPolicyPage() {
  return (
    <div className="rise-in" style={{ minHeight: '100vh' }}>
      <div style={wrap}>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', margin: '0 0 .35rem' }}>
          Content Policy
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.82rem', margin: '0 0 .6rem' }}>
          Draft prepared 2026-07-19 · Effective date: <Placeholder>effective date</Placeholder> · Questions?{' '}
          <a href={`mailto:${LEGAL_CONTACT}`} style={link}>{LEGAL_CONTACT}</a>
        </p>
        <DraftNote />

        <div style={section}>
          <h2 style={h2}>1. What Seen is — a neutral aggregator</h2>
          <p style={p}>
            Seen (&ldquo;Seen,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), operated by <Placeholder>legal entity name</Placeholder>,
            is a hiring-transparency platform that <strong>aggregates and organizes
            content created by other people</strong>. The material shown on Seen comes from two sources:
            (a) publicly available third-party discussion, and (b) reports submitted by applicants about
            their own hiring experiences. Seen also computes aggregate statistics from those reports.
          </p>
          <p style={p}>
            Seen does not independently investigate, verify, or adjudicate the underlying events. The
            individual reports and discussion reflect the <strong>views, opinions, and personal
            experiences of the people who wrote or submitted them</strong> — not Seen&apos;s own
            assertions of fact about any company or person. We present that content with attribution to
            its nature and source.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>2. Third-party public discussion</h2>
          <p style={p}>
            Some content is drawn from <strong>publicly available discussion on third-party platforms</strong>
            {' '}(for example, public threads on Reddit). Where content originates from such public discussion,
            Seen labels it <em>&ldquo;Sourced from public discussion&rdquo;</em> on every surface where the
            individual item appears, so readers can see it was imported from a public third-party thread rather
            than submitted directly to Seen.
          </p>
          <p style={p}>
            Some content is a <strong>first-hand account that its author posted publicly on a third-party
            review site or forum</strong>, found through web search. Seen summarizes such an account, labels it
            {' '}<em>&ldquo;Sourced from a public review site&rdquo;</em> together with the site&apos;s name, and
            links to the original public post where its address is available, so readers can see it was not
            submitted directly to Seen and can check the source themselves.
          </p>
          <p style={quote}>
            This content reflects statements made publicly by third parties in their own venues. Seen is
            surfacing and organizing pre-existing public speech, with attribution to its public-discussion
            origin. Imported public-discussion and review-site items are also weighted lower than first-hand
            reports submitted to Seen in any aggregate statistics.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>3. User-submitted reports are claims, not verified facts</h2>
          <p style={p}>
            Applicants may submit reports describing their own hiring experiences (for example, whether they
            heard back, how long a response took, or at what stage an application stalled). These reports are
            <strong> first-hand claims that reflect the submitter&apos;s own account and perspective</strong>.
            They are presented as what an applicant reported — not as facts that Seen has confirmed.
          </p>
          <p style={p}>
            When a submitter provides a report, they represent that it describes a genuine first-hand
            experience, is truthful to the best of their knowledge, does not identify individual people, and
            is something they have the right to share. Seen may moderate, decline, or remove submissions at
            its discretion, but the substance of a report remains the submitter&apos;s statement, not
            Seen&apos;s.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>4. Aggregate statistics are reported outcomes, not adjudicated facts</h2>
          <p style={p}>
            Seen derives company-level metrics — such as a ghost rate, a response rate, an average wait time,
            and a 0–100 Seen Grade — by aggregating the reports and public-discussion items described above.
            These metrics are <strong>summaries of self-reported outcomes</strong>, not findings that any
            company did or did not do something.
          </p>
          <p style={p}>
            Wherever a rate is shown, the honest reading is <em>&ldquo;X% of N self-reported outcomes,&rdquo;</em>
            {' '}a statistical signal based on a limited and self-selected sample. Aggregate figures:
          </p>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}>are expressions of aggregated community experience, not verdicts or accusations;</li>
            <li style={li}>depend on sample size and may change as new reports arrive (scores update on a rolling basis);</li>
            <li style={li}>weight first-hand reports above imported public-discussion items; and</li>
            <li style={li}>carry no warranty of accuracy, completeness, or timeliness.</li>
          </ul>
          <p style={p}>
            A ghost-surge or similar alert is a statistical observation about a change in reported outcomes —
            not a statement that a company acted wrongly.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>5. Our posture on third-party content, opinion, and truth</h2>
          <p style={p}>
            Seen is designed to operate as a platform that <strong>hosts and organizes content created by
            others</strong>. In the United States, providers of interactive computer services are generally
            treated differently, for much third-party content, from the original speakers — the framework
            commonly associated with <strong>Section 230 of the Communications Decency Act (47 U.S.C. § 230)</strong>.
            Much of what Seen presents is also <strong>opinion and subjective personal experience</strong>, and
            aggregate figures are presented as <strong>reported outcomes with their basis disclosed</strong>.
          </p>
          <p style={quote}>
            These are general principles, described here to explain the platform&apos;s design and intent. They
            are <strong>not legal conclusions</strong>, and nothing here is a promise about how any specific law
            applies to any specific content or dispute. A licensed attorney must review this posture before
            anyone relies on it. <Placeholder>counsel to confirm governing framework and jurisdiction</Placeholder>
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>6. What we remove — and what we don&apos;t</h2>
          <p style={p}>We will remove content that:</p>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}>identifies or targets a private individual, or includes personal contact information;</li>
            <li style={li}>contains threats, harassment, hate speech, or slurs;</li>
            <li style={li}>is demonstrably fabricated, or is the product of coordinated inauthentic activity;</li>
            <li style={li}>infringes third-party rights or violates applicable law.</li>
          </ul>
          <p style={p}>We generally will <strong>not</strong> remove content solely because it is unflattering, including:</p>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}>honest accounts of not hearing back or being ghosted;</li>
            <li style={li}>genuine negative experiences with a hiring process;</li>
            <li style={li}>subjective assessments and criticism of a company&apos;s process.</li>
          </ul>
          <p style={p}>
            &ldquo;It reflects poorly on us&rdquo; is not, by itself, a basis for removal. Factual inaccuracy,
            personal information, or clear fabrication is.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>7. Disputes and corrections</h2>
          <p style={p}>
            Companies and individuals may dispute specific content. To open a dispute, contact{' '}
            <a href={`mailto:${LEGAL_CONTACT}`} style={link}>{LEGAL_CONTACT}</a> with: the specific content at
            issue; who you are and your relationship to the company; the basis for the dispute (factual
            inaccuracy, personal information, or fabrication — not simply that the content is negative); and any
            supporting information. We review disputes within 14 business days (the same window stated on our{' '}
            <Link href="/contact" style={link}>contact page</Link> and FAQ).
          </p>
          <p style={p}>
            Where appropriate, we will correct or remove content, add context, or attach an official response
            from the company alongside the disputed material. We may decline requests whose purpose is to
            suppress genuine, protected applicant speech, and we respond to valid legal process as required by
            law.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>8. Trademarks and company names</h2>
          <p style={p}>
            Company names, logos, and trademarks are the property of their respective owners. Seen references
            them to identify the companies that reports and discussion concern (nominative use). Their
            appearance does not imply any affiliation with, sponsorship by, or endorsement from those companies.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>9. Related policies</h2>
          <p style={p}>
            This Content Policy works alongside our <Link href="/terms" style={link}>Terms of Service</Link> and{' '}
            <Link href="/privacy" style={link}>Privacy Policy</Link>. To submit or dispute a report, see{' '}
            <Link href="/report" style={link}>Report an outcome</Link> or the{' '}
            <Link href="/faq" style={link}>FAQ</Link>.
          </p>
        </div>

        <LegalFooter />
      </div>
    </div>
  )
}
