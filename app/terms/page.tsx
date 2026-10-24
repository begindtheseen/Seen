import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import { PRO_TRIAL_DAYS, ONE_TIME_SKUS, REPORT_REWARD_PRO_DAYS, REPORT_REWARD_MONTHLY_CAP_DAYS, REPORT_REWARD_MIN_TRACKED_DAYS, REFERRAL_REWARD_PRO_DAYS, REFERRAL_MAX_REWARDED, REFERRAL_CLAIM_WINDOW_DAYS } from '@/lib/server/creditRules.js'
import { EMPLOYER_SKUS } from '@/lib/server/employerSkus.js'
import { proPriceLine } from '@/lib/pricing'
import { DraftNote, Placeholder, LegalFooter, LEGAL_CONTACT } from '@/components/legal/LegalBits'

// Terms of Service — DRAFT for the owner's attorney to review.
// Standard aggregator terms: eligibility/accounts, acceptable use, that content is informational and
// user- and third-party-sourced with no warranty of accuracy, the dispute process (see Content Policy),
// employer/portal terms, subscriptions/billing (Stripe), one-time purchases, IP, liability limits,
// indemnity, and changes. Governing law / venue / arbitration are left as <Placeholder> — do not
// invent a jurisdiction. Every price, trial length and credit grant renders from the constants the
// server charges and fulfils with (lib/server/creditRules.js, lib/server/employerSkus.js).

export const metadata: Metadata = pageMetadata({
  title: 'Terms of Service',
  description:
    'The terms for using Seen: eligibility, acceptable use, that data is informational and user- and third-party-sourced, no warranty of accuracy, disputes, employer products, subscriptions, one-time purchases, and liability limits.',
  path: '/terms',
  ogTitle: 'Terms of Service | Seen',
  ogDescription: 'Eligibility, acceptable use, informational-data disclaimer, disputes, employer products, subscriptions, one-time purchases, and liability limits.',
})

const wrap = { maxWidth: 760, margin: '0 auto', padding: '4rem 2rem', width: '100%', boxSizing: 'border-box' as const }
const h2 = { fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: '0 0 .65rem' } as const
const p = { fontFamily: 'var(--body)', fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.8, margin: '0 0 .9rem' } as const
const quote = { ...p, borderLeft: '2px solid var(--line2)', paddingLeft: '1rem' } as const
const li = { fontFamily: 'var(--body)', fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.8, marginBottom: '.35rem' } as const
const section = { marginBottom: '2rem', scrollMarginTop: 80 } as const
const link = { color: 'var(--blue)', textDecoration: 'none' } as const

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

export default function TermsPage() {
  const sprint = ONE_TIME_SKUS.sprint
  const pack = ONE_TIME_SKUS.credits20
  const featured = EMPLOYER_SKUS.featured30
  const verified = EMPLOYER_SKUS.verified90
  const sponsor = EMPLOYER_SKUS.sponsor30

  return (
    <div className="rise-in" style={{ minHeight: '100vh' }}>
      <div style={wrap}>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', margin: '0 0 .35rem' }}>
          Terms of Service
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.82rem', margin: '0 0 .6rem' }}>
          Draft prepared 2026-07-19 · Effective date: <Placeholder>effective date</Placeholder> · Questions?{' '}
          <a href={`mailto:${LEGAL_CONTACT}`} style={link}>{LEGAL_CONTACT}</a>
        </p>
        <DraftNote />

        <div style={section}>
          <h2 style={h2}>1. Acceptance</h2>
          <p style={p}>
            These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between you and{' '}
            <Placeholder>legal entity name</Placeholder> (&ldquo;Seen,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), which
            operates the Seen platform at seenjobs.io. By accessing or using Seen, you agree to these Terms, our{' '}
            <Link href="/privacy" style={link}>Privacy Policy</Link>, and our{' '}
            <Link href="/content-policy" style={link}>Content Policy</Link>. If you do not agree, do not use Seen.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>2. Eligibility and accounts</h2>
          <p style={p}>
            You must be at least 18 years old to use Seen. You are responsible for the activity under your
            account and for keeping your credentials secure. Provide accurate information and keep it current.
            You may close your account at any time from Settings; see section 9 for what deletion does to paid
            items.
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
            de-identified form. <Placeholder>counsel to confirm license scope and duration</Placeholder>
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

        <div style={section} id="employer">
          <h2 style={h2}>7. Employer and company terms</h2>
          <p style={p}>
            Employers and their representatives may access company-facing features (claiming a company, which
            an administrator approves before any company-scoped data is shown; replying to applicants; posting
            listings; and buying the employer products below). By using employer features you represent that
            you are authorized to act for the company. Employer purchases are one-time payments processed by
            Stripe and need no Seen account; the receipt and all follow-up go to the email you give at checkout.
          </p>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}><strong>{featured.name}</strong> ({usd(featured.amount_cents)}, {featured.days} days) — priority placement for every live role the named company has on Seen, applied automatically when payment clears.</li>
            <li style={li}><strong>{verified.name}</strong> ({usd(verified.amount_cents)}, {verified.days} days) — an enrollment reviewed by Seen against real applicant outcomes before the badge is granted; payment alone does not grant it.</li>
            <li style={li}><strong>{sponsor.name}</strong> ({usd(sponsor.amount_cents)}, {sponsor.days} days) — one exclusive, labeled advertising slot on the Staffing Agency Ghost Index, set up by Seen after payment so it is never oversold.</li>
          </ul>
          <p style={quote}>
            Employer features do not let a company buy the removal, alteration, or suppression of genuine,
            policy-compliant applicant content, or the manipulation of any metric: no purchase changes a
            transparency score, grade, ghost rate or ranking. Official responses are attributed as the
            company&apos;s statement. <Placeholder>counsel/owner to confirm employer refund terms and any service-level commitments</Placeholder>
          </p>
        </div>

        <div style={section} id="billing">
          <h2 style={h2}>8. Subscriptions and billing</h2>
          <p style={p}>
            Seen Pro is a paid subscription billed through our payment processor (Stripe) at {proPriceLine()}.
            It begins with a {PRO_TRIAL_DAYS}-day free trial that requires no payment card. If you add a payment
            method before the trial ends, the plan you chose renews automatically at that price until you
            cancel; if you do not, nothing is charged and Pro access simply ends when the trial does.
          </p>
          <p style={p}>
            You can cancel at any time in Settings → Plan &amp; billing. Cancellation stops future renewals and
            your Pro access continues through the end of the period you have already paid for. Current pricing
            and plan details are shown at checkout and on our{' '}
            <Link href="/pricing" style={link}>pricing page</Link>; Stripe may display the amount in your local
            currency at checkout. Charges are generally non-refundable except where required by law.{' '}
            <Placeholder>counsel to confirm auto-renewal disclosures, refund terms, and any jurisdiction-specific cancellation requirements</Placeholder>
          </p>
        </div>

        <div style={section} id="one-time">
          <h2 style={h2}>9. One-time purchases</h2>
          <p style={p}>
            Two products are bought once and never renew. The <strong>{sprint.name}</strong> ({usd(sprint.amount_cents)})
            adds {sprint.credits} AI credits to your account and {sprint.pro_days} days of full Pro access; the{' '}
            <strong>{pack.name}</strong> ({usd(pack.amount_cents)}) adds {pack.credits} AI credits. Credits are
            added when Stripe confirms the payment (on your return from checkout, or by Stripe&apos;s
            notification to us — whichever arrives first; never twice).
          </p>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}>purchased credits do not expire and are not reset by the daily free-credit reset; they are spent after your free daily credit;</li>
            <li style={li}>a purchased Pro period ends on its last day with no renewal and no charge;</li>
            <li style={li}>deleting your account removes any remaining purchased credits and unused Pro time, and those are not refunded; it also cancels an active Seen Pro subscription immediately, with no refund for the rest of the current period and no further charges;</li>
            <li style={li}>one-time charges are generally non-refundable except where required by law.</li>
          </ul>
        </div>

        <div style={section} id="earned-pro">
          <h2 style={h2}>9a. Earned Pro time</h2>
          <p style={p}>
            You can earn Seen Pro time without paying. Reporting the outcome of an application you tracked on
            Seen earns {REPORT_REWARD_PRO_DAYS} days of Pro, once per application, when the application was
            on your tracker for at least {REPORT_REWARD_MIN_TRACKED_DAYS} days before the report, up to{' '}
            {REPORT_REWARD_MONTHLY_CAP_DAYS} days per calendar month (Pacific time). The reward is the same
            whatever the outcome. When a new account signs up with your invite link and tracks its first
            application, both accounts earn {REFERRAL_REWARD_PRO_DAYS} days of Pro; an account is rewarded
            as a referrer for at most {REFERRAL_MAX_REWARDED} invitees, and a link counts only for an account
            created after the link and within {REFERRAL_CLAIM_WINDOW_DAYS} days of signing up.
          </p>
          <ul style={{ margin: '0 0 .9rem', paddingLeft: '1.1rem' }}>
            <li style={li}>earned Pro time is added after any Pro time you already have, ends on its last day, never renews and is never charged;</li>
            <li style={li}>rewards never affect how a report is weighted or any score, grade or ranking;</li>
            <li style={li}>reports must describe what really happened, and invites must be real people; we may withhold or remove earned time gained through fake applications, fake accounts, self-referral or other abuse, and every grant is logged so it can be reviewed;</li>
            <li style={li}>earned Pro time has no cash value and is removed if you delete your account.</li>
          </ul>
        </div>

        <div style={section}>
          <h2 style={h2}>10. Intellectual property</h2>
          <p style={p}>
            The Seen name, software, design, and original content are owned by Seen or its licensors. Company
            names, logos, and trademarks belong to their respective owners and are used to identify the
            companies that reports and discussion concern; their use does not imply affiliation or endorsement.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>11. Disclaimers and limitation of liability</h2>
          <p style={p}>
            To the fullest extent permitted by law, Seen and its operators disclaim all warranties, express or
            implied, including merchantability, fitness for a particular purpose, and non-infringement. Seen
            will not be liable for indirect, incidental, special, consequential, or punitive damages, or for any
            loss arising from your reliance on content or metrics.
          </p>
          <p style={quote}>
            Our total liability for any claim relating to the service is limited to the greater of the amount
            you paid us in the <Placeholder>number of months</Placeholder> months before the claim or{' '}
            <Placeholder>fixed amount</Placeholder>. Some jurisdictions do not allow certain limitations, so
            parts of this section may not apply to you.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>12. Indemnification</h2>
          <p style={p}>
            You agree to indemnify and hold harmless Seen and its operators from claims arising out of content
            you submit, your use of the service, your violation of these Terms, or your infringement of any
            third-party right, to the extent permitted by law.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>13. Governing law and dispute resolution</h2>
          <p style={p}>
            These Terms are governed by the laws of <Placeholder>governing law / jurisdiction</Placeholder>,
            without regard to conflict-of-laws rules. Any dispute will be resolved in{' '}
            <Placeholder>venue and/or arbitration terms, including any class-action waiver and any consumer carve-outs</Placeholder>.
            These provisions are left open intentionally and must be set by counsel.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>14. Changes and contact</h2>
          <p style={p}>
            We may update these Terms and will revise the effective date above; material changes will be
            communicated as required, and your continued use after the effective date constitutes acceptance.
            Questions: <a href={`mailto:${LEGAL_CONTACT}`} style={link}>{LEGAL_CONTACT}</a>.
          </p>
        </div>

        <LegalFooter />
      </div>
    </div>
  )
}
