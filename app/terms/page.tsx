import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import { ONE_TIME_SKUS, REPORT_REWARD_PRO_DAYS, REPORT_REWARD_MONTHLY_CAP_DAYS, REPORT_REWARD_MIN_TRACKED_DAYS, REFERRAL_REWARD_PRO_DAYS, REFERRAL_MAX_REWARDED, REFERRAL_CLAIM_WINDOW_DAYS } from '@/lib/server/creditRules.js'
import { EMPLOYER_SKUS } from '@/lib/server/employerSkus.js'
import { LegalMeta, LegalFooter, LEGAL_CONTACT, LEGAL_OPERATOR, LEGAL_OPERATOR_SHORT, LEGAL_STATE } from '@/components/legal/LegalBits'

// Terms of Service. Reviewed against the code 2026-10-24; purchases rewritten 2026-10-25 (one-time products only). Every price, trial length and credit grant
// renders from the constants the server charges and fulfils with (lib/server/creditRules.js,
// lib/server/employerSkus.js; lib/pricing.test.mjs fails on a hand-typed price). Facts behind the
// clauses: one-time products only since 2026-10-25 (api/stripe.js checkout refuses anything else); an earlier
// subscription's auto-renew and in-app cancel at period end (app/profile "Plan & billing" → cancel_subscription);
// account deletion cancels billing first (api/user-sync.js delete_account → lib/server/stripeCancel.js);
// one-time fulfilment once (lib/server/stripeFulfillment.js); earned Pro (lib/server/growthRewards.js).

export const metadata: Metadata = pageMetadata({
  title: 'Terms of Service',
  description:
    'The terms for using Seen: eligibility, acceptable use, what the data is and is not, one-time purchases, earlier subscriptions, employer products, refunds, liability, and how disputes are resolved.',
  path: '/terms',
  ogTitle: 'Terms of Service | Seen',
  ogDescription: 'Eligibility, acceptable use, informational-data disclaimer, one-time purchases, earlier subscriptions, employer products, refunds, liability and disputes.',
})

const wrap = { maxWidth: 760, margin: '0 auto', padding: '4rem 2rem', width: '100%', boxSizing: 'border-box' as const }
const h2 = { fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: '0 0 .65rem' } as const
const p = { fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--sub)', lineHeight: 1.8, margin: '0 0 .9rem' } as const
const quote = { ...p, borderLeft: '2px solid var(--line2)', paddingLeft: '1rem' } as const
const li = { fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--sub)', lineHeight: 1.8, marginBottom: '.35rem' } as const
const ul = { margin: '0 0 .9rem', paddingLeft: '1.1rem' } as const
const section = { marginBottom: '2rem', scrollMarginTop: 80 } as const
const link = { color: 'var(--blue)', textDecoration: 'none' } as const
const mail = <a href={`mailto:${LEGAL_CONTACT}`} style={link}>{LEGAL_CONTACT}</a>

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

export default function TermsPage() {
  const prep = ONE_TIME_SKUS.interview
  const pass = ONE_TIME_SKUS.pass30
  const pack = ONE_TIME_SKUS.credits20
  const featured = EMPLOYER_SKUS.featured30
  const verified = EMPLOYER_SKUS.verified90
  const sponsor = EMPLOYER_SKUS.sponsor30

  return (
    <div className="rise-in" style={{ minHeight: '100vh' }}>
      <div style={wrap}>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-h2)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', margin: '0 0 .35rem' }}>
          Terms of Service
        </h1>
        <LegalMeta />

        <div style={section}>
          <h2 style={h2}>1. Agreement</h2>
          <p style={p}>
            These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between you and {LEGAL_OPERATOR}{' '}
            (&ldquo;{LEGAL_OPERATOR_SHORT},&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), which runs the website and
            services at seenjobs.io. By creating an account, buying something, or otherwise using Seen, you agree
            to these Terms, our <Link href="/privacy" style={link}>Privacy Policy</Link> and our{' '}
            <Link href="/content-policy" style={link}>Content Policy</Link>. If you do not agree, do not use Seen.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>2. Eligibility and accounts</h2>
          <p style={p}>
            You must be at least 18 years old to use Seen. You are responsible for what happens under your account
            and for keeping your password and sign-in links private. Give accurate information and keep it current.
            One person may hold one account; accounts created to inflate reports, reviews or rewards may be closed.
            You can delete your account at any time in Settings; section 10 explains what that does to anything you
            paid for.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>3. What the information on Seen is — and is not</h2>
          <p style={p}>
            Seen gathers two kinds of content — reports applicants send us about their own hiring experiences, and
            first-hand accounts people posted publicly elsewhere — and computes company statistics from them. As our{' '}
            <Link href="/content-policy" style={link}>Content Policy</Link> explains:
          </p>
          <ul style={ul}>
            <li style={li}>each report or quoted account is the view and experience of the person who wrote it, not a statement of fact by Seen;</li>
            <li style={li}>company figures (response rate, ghost rate, wait time, Seen Grade) summarize self-reported outcomes; they are not findings about what a company did; and</li>
            <li style={li}>Seen does not independently verify the events people describe.</li>
          </ul>
          <p style={p}>
            Job listings come from employers&apos; own job boards, public job feeds and employers who post on Seen.
            We do not guarantee that a listing is still open, accurate, or that applying will lead to a response.
          </p>
          <p style={quote}>
            Seen and all of its content are provided for general information only, &ldquo;as is&rdquo; and
            &ldquo;as available.&rdquo; We do not promise that any content, score, listing or AI output is accurate,
            complete, current or suited to your situation. Nothing on Seen is legal, employment, financial or career
            advice. Use your own judgment before you apply, accept or decline a job.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>4. AI features</h2>
          <p style={p}>
            Some tools (résumé analysis and tailoring, job insights, summaries) use automated and AI processing.
            Their output can be wrong or incomplete. Review anything before you send it to an employer: you are
            responsible for what you submit, and you must not add experience, credentials or facts that are not
            true. Free and paid AI use is measured in credits as described on our <Link href="/pricing" style={link}>pricing page</Link>.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>5. Acceptable use</h2>
          <p style={p}>You agree not to:</p>
          <ul style={ul}>
            <li style={li}>submit false, exaggerated, fabricated or coordinated reports, or reports about an application you did not make;</li>
            <li style={li}>post personal information about, or content that targets, a private individual (for example a named recruiter or hiring manager);</li>
            <li style={li}>harass, threaten, impersonate anyone, or post hateful or unlawful content;</li>
            <li style={li}>scrape, harvest or bulk-download content, or use bots or automated access, except the published open dataset under its own license (see <Link href="/data" style={link}>Open data</Link>);</li>
            <li style={li}>probe, disrupt, overload, reverse-engineer or try to get unauthorized access to Seen or another user&apos;s account;</li>
            <li style={li}>create fake accounts or applications, refer yourself, or otherwise game credits, rewards, reports or rankings;</li>
            <li style={li}>resell access to Seen or use it to build a competing database, or for any unlawful purpose.</li>
          </ul>
          <p style={p}>
            We may remove content, withhold or reverse credits and rewards obtained in breach of these Terms, and
            suspend or close accounts that break these Terms or our Content Policy.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>6. Your content and the license you give us</h2>
          <p style={p}>
            You keep ownership of what you submit. When you submit a report or other public content, you promise
            that it describes your own genuine experience, is true to the best of your knowledge, does not identify
            private individuals, and is yours to share. You give Seen a worldwide, non-exclusive, royalty-free,
            transferable license to host, store, display, reproduce, adapt (for example to remove personal
            information or summarize), and distribute that content in order to run, improve and promote Seen. The
            license lasts while the content is on Seen; for content that has become part of de-identified company
            statistics, including the published open dataset, it continues after you delete the content or your
            account. Private content — your tracker, saved jobs and résumé — is not published and is covered by
            our Privacy Policy.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>7. Disputes about content and copyright notices</h2>
          <p style={p}>
            Companies and individuals can dispute specific content through the process in our{' '}
            <Link href="/content-policy" style={link}>Content Policy</Link>. We act on personal information,
            threats, fabrication and unlawful content, and we consider corrections and official company
            responses, but we do not remove content only because it is negative.
          </p>
          <p style={p}>
            If you believe content on Seen infringes your copyright, email {mail} with: the work you say is
            infringed; the exact page or content on Seen; your name, address, phone number and email; a statement
            that you believe in good faith the use is not authorized by the owner, its agent or the law; a statement,
            under penalty of perjury, that your notice is accurate and that you are the owner or authorized to act
            for the owner; and your physical or electronic signature. We remove or disable content that we
            reasonably believe infringes, and we close the accounts of repeat infringers.
          </p>
        </div>

        <div style={section} id="employer">
          <h2 style={h2}>8. Employer and company terms</h2>
          <p style={p}>
            Employers and their representatives may claim a company page (an administrator approves the claim
            before any company-only data is shown), reply to applicants, post listings, receive applications sent
            through Seen, and buy the products below. By using employer features you confirm you are authorized to
            act for the company, and you agree to use applicant information only to consider those applicants for
            the role and as the law allows. Employer purchases are one-time payments processed by Stripe and need
            no Seen account; the receipt and follow-up go to the email given at checkout.
          </p>
          <ul style={ul}>
            <li style={li}><strong>{featured.name}</strong> ({usd(featured.amount_cents)}, {featured.days} days) — priority placement for every live role the named company has on Seen, applied automatically when payment clears.</li>
            <li style={li}><strong>{verified.name}</strong> ({usd(verified.amount_cents)}, {verified.days} days) — an enrollment that Seen reviews against real applicant outcomes before granting the badge. Paying does not by itself grant it.</li>
            <li style={li}><strong>{sponsor.name}</strong> ({usd(sponsor.amount_cents)}, {sponsor.days} days) — one exclusive, labeled advertising slot on the Staffing Agency Ghost Index, set up by Seen after payment so it is never oversold.</li>
          </ul>
          <p style={p}>
            <strong>Employer refunds.</strong> If we cannot deliver an employer product you paid for — the
            company has no live roles for a Featured placement, the Verified review ends without the badge being
            granted, or we cannot run the Sponsor slot within 7 days of payment — we refund it in full to the
            original payment method. Once a product has started running, it is not refundable for the time already
            used. We do not promise any particular number of views, clicks or applicants.
          </p>
          <p style={quote}>
            No employer purchase buys the removal, change or hiding of genuine, policy-compliant applicant
            content, or any change to a score, grade, ghost rate or ranking. Official company responses are shown
            as the company&apos;s statement.
          </p>
        </div>

        <div style={section} id="billing">
          <h2 style={h2}>9. Seen Pro subscriptions started before October 25, 2026</h2>
          <p style={p}>
            Seen no longer starts subscriptions or free trials; what Seen sells now is described in section 10.
            Until October 25, 2026, Seen Pro was a monthly or yearly subscription billed through Stripe that
            started with a free trial that needs no payment card. If you have one, it keeps its terms below until
            it ends.
          </p>
          <p style={quote}>
            <strong>Automatic renewal:</strong> if you add a payment method, your subscription renews
            automatically at the price shown when you subscribed, every month or every year depending on the plan
            you chose, and your payment method is charged at the start of each period until you cancel. If you do
            not add a payment method, nothing is charged and Pro simply ends when the trial does. You can cancel at
            any time, online, in Settings → Plan &amp; billing; cancellation stops future renewals and you keep Pro
            until the end of the period you already paid for. If we change the price, we will tell you by email
            before it applies to your next renewal, and you can cancel before then.
          </p>
          <p style={p}>
            Stripe may show the amount in your local currency, and taxes may apply where required. Because you can
            cancel at any time and keep access through the paid period, we do not refund partial periods. We will
            refund a charge that was made in error (for example a duplicate charge, or a renewal after you
            cancelled), and anything else the law requires — email {mail} within 30 days of the charge.
          </p>
        </div>

        <div style={section} id="one-time">
          <h2 style={h2}>10. One-time purchases, credits and account deletion</h2>
          <p style={p}>
            Seen sells two products. Each is bought once; neither is a subscription and neither renews.{' '}
            <strong>{prep.name}</strong> ({usd(prep.amount_cents)}) is for one interview and gives you{' '}
            {prep.pro_days} days of full Pro access, which includes building interview prep for any application on
            your tracker that has reached an interview: likely questions for the role, answers built from your
            résumé, an introduction and email templates. The <strong>{pass.name}</strong>{' '}
            ({usd(pass.amount_cents)}) gives you {pass.pro_days} days of full Pro access, including that interview
            prep for every interview in those days; bought while you still have Pro time, its days are added after
            the time you have. The questions are prepared by Seen for the role; they are not a record of what any
            employer asks, and Seen does not promise any interview or hiring result. Each purchase is delivered
            once Stripe confirms the payment (on your return from checkout or by Stripe&apos;s notice to us,
            whichever arrives first — never twice). The {pack.name} ({pack.credits} AI credits) is no longer sold;
            credits bought before October 25, 2026 stay on your account.
          </p>
          <ul style={ul}>
            <li style={li}>purchased credits do not expire and are not reset by the daily free-credit reset; they are used after your free daily credit;</li>
            <li style={li}>a purchased Pro period ends on its last day with no renewal and no charge;</li>
            <li style={li}>credits and Pro time have no cash value and cannot be transferred;</li>
            <li style={li}>one-time purchases are refunded only for a charge made in error or where the law requires;</li>
            <li style={li}>deleting your account removes any remaining credits and unused Pro time without a refund, and cancels an active Seen Pro subscription immediately — no further charges and no refund for the rest of the current period.</li>
          </ul>
        </div>

        <div style={section} id="earned-pro">
          <h2 style={h2}>11. Earned Pro time</h2>
          <p style={p}>
            You can earn Seen Pro time without paying. Reporting the outcome of an application you tracked on Seen
            earns {REPORT_REWARD_PRO_DAYS} days of Pro, once per application, when the application was on your
            tracker for at least {REPORT_REWARD_MIN_TRACKED_DAYS} days before the report, up to{' '}
            {REPORT_REWARD_MONTHLY_CAP_DAYS} days per calendar month (Pacific time). The reward is the same
            whatever the outcome. When a new account signs up with your invite link and tracks its first
            application, both accounts earn {REFERRAL_REWARD_PRO_DAYS} days of Pro; an account is rewarded as a
            referrer for at most {REFERRAL_MAX_REWARDED} invitees, and a link counts only for an account created
            after the link and within {REFERRAL_CLAIM_WINDOW_DAYS} days of signing up.
          </p>
          <ul style={ul}>
            <li style={li}>earned Pro time is added after any Pro time you already have, ends on its last day, never renews and is never charged;</li>
            <li style={li}>rewards never change how a report is weighted or any score, grade or ranking;</li>
            <li style={li}>reports must describe what really happened, and invites must go to real people; we may withhold or remove time earned through fake applications, fake accounts, self-referral or other abuse, and every grant is logged so it can be reviewed;</li>
            <li style={li}>earned Pro time has no cash value and is removed if you delete your account.</li>
          </ul>
        </div>

        <div style={section}>
          <h2 style={h2}>12. Emails from Seen</h2>
          <p style={p}>
            We send account and purchase emails you need (sign-in links, receipts). If you track applications we may
            send check-in emails asking what happened, and if your account has a résumé we may send up to two emails a
            day about live listings that match it. Each check-in and job-match email has a one-click unsubscribe,
            and each kind stops on its own.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>13. Seen&apos;s property</h2>
          <p style={p}>
            The Seen name, logo, software, design, scores and original text belong to Seen or its licensors and are
            protected by law. We give you a personal, non-transferable, revocable permission to use Seen under these
            Terms; nothing else is licensed to you. Company names, logos and trademarks belong to their owners and are
            used only to identify the companies that reports concern; their use does not mean any affiliation or
            endorsement. Company-level statistics published on <Link href="/data" style={link}>Open data</Link> are
            available under the license stated there.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>14. Availability, changes to the service, and ending your use</h2>
          <p style={p}>
            We work to keep Seen running but do not guarantee it will be available, uninterrupted or error-free, and
            we may change, add or remove features. You may stop using Seen and delete your account at any time. We may
            suspend or close an account that breaks these Terms or puts users or Seen at risk; if we close a paid
            account for a reason other than a breach of these Terms, we refund the unused part of any prepaid period.
            Sections 3, 6, 13 and 15 through 19 continue to apply after your use ends.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>15. Disclaimer of warranties</h2>
          <p style={p}>
            To the fullest extent the law allows, Seen is provided without warranties of any kind, express or implied,
            including warranties of merchantability, fitness for a particular purpose, title and non-infringement, and
            any warranty that content, scores, listings or AI output are accurate or reliable.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>16. Limitation of liability</h2>
          <p style={quote}>
            To the fullest extent the law allows, Seen and its founder will not be liable for any indirect,
            incidental, special, consequential, exemplary or punitive damages, or for lost profits, lost wages, lost
            job opportunities, lost data or goodwill, arising from or related to Seen or these Terms, even if told
            they were possible. Seen&apos;s total liability for all claims relating to Seen or these Terms is limited
            to the greater of (a) the amount you paid Seen in the 12 months before the event giving rise to the claim
            and (b) one hundred U.S. dollars (US$100).
          </p>
          <p style={p}>
            Some places do not allow some of these limits; where that is so, they apply only as far as the law
            allows. Nothing in these Terms limits liability for fraud, gross negligence, willful misconduct, or any
            liability that cannot be limited by law.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>17. Indemnity</h2>
          <p style={p}>
            To the extent the law allows, you agree to defend and hold harmless Seen and its founder from claims,
            losses and reasonable costs (including reasonable attorneys&apos; fees) brought by a third party that
            arise from content you submit, your misuse of Seen, or your breach of these Terms or of someone
            else&apos;s rights.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>18. Governing law and resolving disputes</h2>
          <p style={p}>
            These Terms and any dispute about Seen are governed by the laws of the State of {LEGAL_STATE} and
            applicable U.S. federal law, without regard to conflict-of-laws rules. Before filing any claim, please
            email {mail} with a description of the problem and what you want; we will try to resolve it within 30
            days. If we cannot, either of us may bring the claim in the state or federal courts located in{' '}
            {LEGAL_STATE}, and both of us consent to those courts&apos; jurisdiction. Either of us may instead bring an
            individual claim in small-claims court where it qualifies. If you live outside the United States, you
            keep any protections the law of your country gives you that cannot be waived by agreement.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>19. General</h2>
          <ul style={ul}>
            <li style={li}><strong>Whole agreement.</strong> These Terms, the Privacy Policy and the Content Policy are the entire agreement between you and Seen about Seen.</li>
            <li style={li}><strong>Severability.</strong> If a court finds part of these Terms unenforceable, the rest stays in effect and that part is enforced as far as the law allows.</li>
            <li style={li}><strong>No waiver.</strong> If we do not enforce a term, we have not given up the right to enforce it later.</li>
            <li style={li}><strong>Assignment.</strong> You may not transfer your account or these Terms. We may transfer them as part of a sale, merger or reorganization of the business, and these Terms continue to bind the new owner.</li>
            <li style={li}><strong>Events outside our control.</strong> We are not responsible for delays or failures caused by events beyond our reasonable control, such as outages at our providers.</li>
            <li style={li}><strong>Notices.</strong> We send notices to the email on your account; you send notices to {mail}.</li>
          </ul>
        </div>

        <div style={section}>
          <h2 style={h2}>20. Changes to these Terms</h2>
          <p style={p}>
            We may update these Terms. We change the effective date above for every update, and for a change that
            materially affects your rights we will tell you by email or on the site at least 14 days before it takes
            effect. If you keep using Seen after a change takes effect, you accept the updated Terms; if you do not
            agree, stop using Seen and delete your account. Changes never apply to a dispute that arose before them.
          </p>
        </div>

        <LegalFooter />
      </div>
    </div>
  )
}
