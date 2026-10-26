import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import { LegalMeta, LegalFooter, LEGAL_CONTACT, LEGAL_OPERATOR } from '@/components/legal/LegalBits'

// Privacy Policy. Reviewed against the code 2026-10-24; each item names what implements it:
//   account + profile: profiles, auth (Supabase) · résumé: profiles.resume_text, resume_skills,
//   resumes bucket · Apply on Seen: seen_applications + application-resumes bucket, read by the employer
//   (api/employer-listings.js); declined/withdrawn copies cleared after 30 days
//   (lib/server/applicationRetention.js RETENTION_DAYS) · sign-in security: login_signals (IP + user
//   agent, api/user-sync.js) · how you arrived: signup_attribution · search history: search_events ·
//   rate limiting: IP per endpoint per hour (lib/server/ratelimit.js) · anonymous reports: no name,
//   email or session id stored, held for review (api/reports.js submit) · Inbox Autopilot facts only
//   (lib/server/inbox) · emails: outcome-followups + cron-job-matches with per-list unsubscribe ·
//   deletion: api/user-sync.js delete_account (cancels billing first, deletes every user table, de-links
//   reports) · admin access: api/admin-stats.js, audited in admin_audit_log · AI: none — every résumé,
//   interview and job tool runs on Seen's own servers (owner decision 2026-10-26: no model API) ·
//   geocoding: OpenStreetMap Nominatim (lib/server/geo.js) · analytics: PostHog only when
//   NEXT_PUBLIC_POSTHOG_KEY is set (lib/analytics.ts).

export const metadata: Metadata = pageMetadata({
  title: 'Privacy Policy — What Seen Collects & How It Is Used',
  description:
    'What Seen collects, why, who can see it, the providers we use, how long we keep it, and your rights — including how to delete your account and data.',
  path: '/privacy',
  ogTitle: 'Privacy Policy | Seen',
  ogDescription: 'What Seen collects, why, who can see it, how long we keep it, and your rights.',
})

const wrap = { maxWidth: 760, margin: '0 auto', padding: '4rem 2rem', width: '100%', boxSizing: 'border-box' as const }
const h2 = { fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: '0 0 .65rem' } as const
const h3 = { fontFamily: 'var(--body)', fontSize: 'var(--fs-ui)', fontWeight: 700, color: 'var(--white)', margin: '1rem 0 .4rem' } as const
const p = { fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--sub)', lineHeight: 1.8, margin: '0 0 .9rem' } as const
const quote = { ...p, borderLeft: '2px solid var(--line2)', paddingLeft: '1rem' } as const
const li = { fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--sub)', lineHeight: 1.8, marginBottom: '.35rem' } as const
const ul = { margin: '0 0 .9rem', paddingLeft: '1.1rem' } as const
const section = { marginBottom: '2rem', scrollMarginTop: 80 } as const
const link = { color: 'var(--blue)', textDecoration: 'none' } as const
const mail = <a href={`mailto:${LEGAL_CONTACT}`} style={link}>{LEGAL_CONTACT}</a>

export default function PrivacyPage() {
  return (
    <div className="rise-in" style={{ minHeight: '100vh' }}>
      <div style={wrap}>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-h2)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', margin: '0 0 .35rem' }}>
          Privacy Policy
        </h1>
        <LegalMeta label="Privacy questions or requests:" />

        <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', color: 'var(--muted)', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.65rem 1rem', marginBottom: '2rem', lineHeight: 1.6 }}>
          The short version: we collect what we need to run Seen, we do not sell your data or use it for
          advertising, your résumé and tracker are private, and you can delete your account and data yourself
          in Settings at any time.
        </div>

        <div style={section}>
          <h2 style={h2}>1. Who we are</h2>
          <p style={p}>
            Seen is a job-search and hiring-transparency service at seenjobs.io, run by {LEGAL_OPERATOR}{' '}
            (&ldquo;Seen,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). We decide how and why your personal
            information is used. You can reach us about anything in this policy at {mail}.
          </p>
        </div>

        <div style={section} id="collect">
          <h2 style={h2}>2. What we collect</h2>

          <h3 style={h3}>Information you give us</h3>
          <ul style={ul}>
            <li style={li}><strong>Account:</strong> your email address and password or sign-in link, handled by our authentication provider.</li>
            <li style={li}><strong>Profile:</strong> name, city, experience level and any optional survey answers you choose to give.</li>
            <li style={li}><strong>Your job search:</strong> applications you track (company, role, city, dates, stage and what happened), saved jobs, and companies you recently viewed.</li>
            <li style={li}><strong>Résumé:</strong> the résumé text or file you upload or edit, and the job titles and skills we read from it to match you with listings.</li>
            <li style={li}><strong>Applying through Seen:</strong> when you apply to a listing using Seen&apos;s own application form, the name, email, phone number (optional), résumé and answers you submit.</li>
            <li style={li}><strong>Reports:</strong> hiring outcomes you report about companies, and anything you write in them.</li>
            <li style={li}><strong>Inbox Autopilot</strong> (only if you turn it on): from emails you forward to your private Seen address we keep only the facts — company, role, what happened, the sender&apos;s name and domain, and the date — never the email&apos;s text, subject or attachments.</li>
            <li style={li}><strong>Interview prep:</strong> when you build interview prep for an application, the questions, answers, introduction and emails Seen made for you from your résumé, stored so you can open them again. Deleted with your account.</li>
            <li style={li}><strong>Purchases:</strong> your plan, credit balance, Pro status and the Stripe customer and subscription references. Card details go to Stripe; Seen never sees or stores your full card number.</li>
            <li style={li}><strong>Invites and rewards:</strong> your invite code, who invited you and whom you invited, and a record of each reward.</li>
            <li style={li}><strong>Messages</strong> you send us, and if you buy an employer product, the email and company name you give at checkout.</li>
          </ul>

          <h3 style={h3}>Information collected automatically</h3>
          <ul style={ul}>
            <li style={li}><strong>Sign-in security records:</strong> your IP address and browser type when you sign in, used to keep accounts secure and to spot duplicate or fake accounts that could skew company grades.</li>
            <li style={li}><strong>How you found us:</strong> the first Seen page you landed on, the website that sent you, and any campaign tags in the link, saved with your account when you sign up.</li>
            <li style={li}><strong>Offer counts:</strong> when an interview-prep offer is shown to you or you press it, we count it (with your account if you are signed in, and the company name) to measure which offers help people.</li>
            <li style={li}><strong>Search history:</strong> the job searches you run while signed in, with how many results they returned.</li>
            <li style={li}><strong>Technical logs:</strong> standard request logs kept by our hosting provider, and IP-address counters we use to limit abuse (for example too many requests in an hour).</li>
            <li style={li}><strong>Product analytics</strong> (only where enabled): page views and feature use, collected with PostHog, never for advertising.</li>
            <li style={li}><strong>Your browser&apos;s storage:</strong> Seen keeps your sign-in session and some preferences and drafts in your browser&apos;s local storage. We do not use advertising or cross-site tracking cookies.</li>
          </ul>

          <h3 style={h3}>Reports sent without an account</h3>
          <p style={p}>
            If you report an outcome without signing in, we store the report, the company, the role and a general
            location with the time it was sent. We do not store your name, email or a session identifier with it.
            Reports sent this way are held for review before they count toward a company&apos;s grade.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>3. How we use it</h2>
          <ul style={ul}>
            <li style={li}><strong>To provide Seen:</strong> company grades and pages, job search, the tracker, résumé tools, applying through Seen, check-ins, job matches, credits and Pro features.</li>
            <li style={li}><strong>To build company statistics:</strong> reports are combined into company-level figures (response rate, ghost rate, wait time, Seen Grade). These figures never identify you, and company-level statistics are also published as <Link href="/data" style={link}>open data</Link>.</li>
            <li style={li}><strong>To email you:</strong> account and purchase emails you need; check-ins about applications you track; and, if your account has a résumé, up to two emails a day about live listings that match it. Every check-in and job-match email has a one-click unsubscribe, and each kind stops on its own.</li>
            <li style={li}><strong>To keep Seen honest and safe:</strong> detecting fake reports, fake accounts and reward abuse, moderating content, preventing fraud and securing the service.</li>
            <li style={li}><strong>To support you</strong> and answer your messages, and <strong>to improve Seen</strong> — for example, learning which pages people reach us from.</li>
            <li style={li}><strong>To process payments</strong> and keep the records the law requires, and to comply with law and valid legal process.</li>
          </ul>
          <p style={p}>
            If you are in the European Economic Area or the United Kingdom, we rely on these legal bases: performing
            our contract with you (running your account and the features you use); our legitimate interests (keeping
            grades accurate and Seen secure, improving the service, and sending check-ins and job matches you can
            switch off at any time); your consent where we ask for it (you can withdraw it at any time); and legal
            obligations (such as tax records).
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>4. Who can see your information</h2>
          <ul style={ul}>
            <li style={li}><strong>The public</strong> sees the reports you submit, without your name or email, and company statistics built from them. Your tracker, saved jobs, searches, résumé and profile are private.</li>
            <li style={li}><strong>Employers</strong> see what you send them when you apply to their listing through Seen (your name, email, optional phone, résumé and answers), and any message you send in that application&apos;s thread. If an application is declined or you withdraw it, the employer&apos;s copy is cleared 30 days later. Your résumé on your profile is never shown to employers unless you send it with an application.</li>
            <li style={li}><strong>People you invite</strong> never see your tracker or reports, and you never see theirs; invite cards show only counts.</li>
          </ul>
          <p style={p}>
            <strong>Seen&apos;s administrators.</strong> To be straightforward about it: an authorized Seen
            administrator can access account data when that is needed to run the service — to give support, moderate
            content, investigate abuse or security problems, manage subscriptions and credits, and reset access or
            delete an account at the owner&apos;s request or where required. This uses elevated access to our
            database and sign-in system.
          </p>
          <p style={quote}>
            We access account data only to run Seen, support you, keep the service secure and comply with the law.
            We never sell it and never look at it for unrelated reasons. Administrative actions are recorded in an
            internal audit log, and access is limited to authorized people.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>5. Service providers</h2>
          <p style={p}>We use a small set of providers to run Seen. They process information only to provide their service to us:</p>
          <ul style={ul}>
            <li style={li}><strong>Supabase</strong> — database, file storage and sign-in.</li>
            <li style={li}><strong>Vercel</strong> — website hosting, serverless functions and request logs.</li>
            <li style={li}><strong>Stripe</strong> — payments and subscriptions.</li>
            <li style={li}><strong>Resend</strong> — sending Seen&apos;s emails, and receiving email you forward to your Inbox Autopilot address.</li>
            <li style={li}><strong>PostHog</strong> — product analytics, only where enabled.</li>
            <li style={li}><strong>OpenStreetMap (Nominatim)</strong> — turning a city name into map coordinates for nearby-job search. Only the place name is sent.</li>
            <li style={li}><strong>Google Fonts</strong> — the typefaces on every page load from Google&apos;s servers, so your browser sends Google its IP address and browser details, as with any font host.</li>
          </ul>
          <p style={p}>
            Seen&apos;s résumé, interview-prep and job tools run on Seen&apos;s own servers. Your résumé and the job
            postings you work with are not sent to any outside AI provider.
          </p>
          <p style={p}>
            Job-listing sources we search for you (such as Adzuna, USAJOBS and employers&apos; job boards) receive
            only search words and a location — never your name, email or résumé.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>6. We do not sell or share your data for advertising</h2>
          <p style={p}>
            We do not sell personal information, rent it, or share it for cross-context behavioral advertising, and
            we have not done so in the past 12 months. We disclose information only to the providers above, to an
            employer when you apply to their listing through Seen, when the law or valid legal process requires it,
            to protect the rights, safety or property of users, the public or Seen, or as part of a sale or merger of
            the business — in which case this policy keeps applying to your information.
          </p>
        </div>

        <div style={section} id="retention">
          <h2 style={h2}>7. How long we keep it</h2>
          <ul style={ul}>
            <li style={li}><strong>Account data</strong> — profile, résumé, tracker, saved jobs, searches, credits, rewards, sign-in security records, how you found us, email preferences and email history: kept while your account is open and deleted when you delete your account.</li>
            <li style={li}><strong>Reports you submitted</strong> stay published after you delete your account, with the link to you removed, because they are part of a company&apos;s public record.</li>
            <li style={li}><strong>Applications sent through Seen:</strong> the employer&apos;s copy of a declined or withdrawn application is cleared 30 days after that decision; applications and their résumé files are deleted when you delete your account.</li>
            <li style={li}><strong>Inbox Autopilot facts</strong> are deleted when you turn the feature off.</li>
            <li style={li}><strong>Request logs</strong> are kept by our host for no more than 30 days.</li>
            <li style={li}><strong>Backups:</strong> our database provider keeps daily backups for 7 days, so deleted information can remain in a backup for up to 7 days before it is gone.</li>
            <li style={li}><strong>Payment and tax records</strong> are kept by Stripe and by us for as long as tax and accounting law requires.</li>
          </ul>
          <p style={p}>
            When you delete your account in Settings, Seen first cancels any active subscription, then deletes your
            account data as described above and removes your sign-in.
          </p>
        </div>

        <div style={section} id="rights">
          <h2 style={h2}>8. Your rights and choices</h2>
          <p style={p}>Wherever you live, you can:</p>
          <ul style={ul}>
            <li style={li}>see and edit your profile, résumé and tracker in the app, and correct anything that is wrong;</li>
            <li style={li}>delete your account and data yourself in Settings, or ask us to;</li>
            <li style={li}>ask for a copy of your data in a portable format;</li>
            <li style={li}>stop check-in or job-match emails with the unsubscribe link in any of them;</li>
            <li style={li}>block analytics with your browser&apos;s tracking protection.</li>
          </ul>
          <p style={p}>
            <strong>California residents</strong> have the right to know what personal information we collect, use
            and disclose (described in sections 2 to 6), to delete it, to correct it, and to opt out of its sale or
            sharing (we do neither), and the right not to be treated differently for using these rights.{' '}
            <strong>EEA and UK residents</strong> also have the rights to access, rectify, erase, restrict and port
            their data, to object to processing based on legitimate interests, to withdraw consent, and to complain to
            their local data protection authority.
          </p>
          <p style={p}>
            To make a request, email {mail} from the address on your account (or tell us the address, and we will
            confirm the request by emailing it). An authorized agent may make a request for you with your signed
            permission; we will still confirm it with you. We answer within 30 days, and at most 45 days where the law
            allows an extension, and we will tell you if we need it. If we decline a request, you can appeal by
            replying to our answer, and we will respond to the appeal within 45 days.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>9. Do Not Track and Global Privacy Control</h2>
          <p style={p}>
            Seen does not track you across other websites and does not show you ads, so there is nothing for a
            browser &ldquo;Do Not Track&rdquo; signal to switch off; we treat every visitor the same way whether or
            not the signal is sent. We treat a Global Privacy Control signal as a request to opt out of sale and
            sharing, which we do not do in any case.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>10. Security</h2>
          <p style={p}>
            We protect information with access controls, encrypted connections (HTTPS), per-account data rules in
            our database, private storage for résumé files, and audit logs for administrative actions. No system is
            perfectly secure; if we learn of a breach that affects your personal information, we will tell you as
            the law requires.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>11. Where your information is processed</h2>
          <p style={p}>
            Seen is run from the United States, and our providers store and process information in the United
            States and other countries where they operate. Where the law requires a transfer safeguard for
            information leaving the EEA or UK, we rely on the providers&apos; standard contractual clauses.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>12. Children</h2>
          <p style={p}>
            Seen is for adults. You must be 18 or older to create an account, and we do not knowingly collect
            information from anyone under 18. If you believe a child has given us information, email {mail} and we
            will delete it.
          </p>
        </div>

        <div style={section}>
          <h2 style={h2}>13. Changes and contact</h2>
          <p style={p}>
            We may update this policy. We change the effective date above for every update, and for a material
            change we will tell you by email or on the site before it takes effect. Questions, requests or
            complaints: {mail}. See also our <Link href="/terms" style={link}>Terms of Service</Link> and{' '}
            <Link href="/content-policy" style={link}>Content Policy</Link>.
          </p>
        </div>

        <LegalFooter />
      </div>
    </div>
  )
}
