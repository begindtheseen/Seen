import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import { ONE_TIME_SKUS } from '@/lib/server/creditRules.js'
import { offerLine } from '@/lib/pricing'
import { LEGAL_CONTACT, LEGAL_EFFECTIVE } from '@/components/legal/LegalBits'

// /legal is a HUB, not a fourth legal document. Until 2026-10-24 this page was a second, older set of
// terms that contradicted /terms, /privacy and /content-policy ("your first charge occurs at checkout"
// against the $0 no-card trial; "binding arbitration under AAA" against the terms' open venue item; a
// "Pro waitlist"; a "Billing & Subscription portal" button that does not exist). Everything legal now
// lives in the three documents; this page links them and repeats only facts the code implements,
// rendered from the same constants the server charges with (lib/pricing.test.mjs fails on a hand-typed
// price). Since 2026-10-25 Seen sells one-time products only: Interview Prep and the Job Search Pass.

export const metadata: Metadata = pageMetadata({
  title: 'Legal',
  description:
    'Seen’s Terms of Service, Privacy Policy and Content Policy in one place, with the plain facts about what is free, what the one-time purchases are, and your data.',
  path: '/legal',
  ogTitle: 'Legal | Seen',
  ogDescription: 'Terms of Service, Privacy Policy and Content Policy — and the plain facts about prices, one-time purchases and your data.',
})

const DOCS = [
  { href: '/terms', title: 'Terms of Service', body: 'Eligibility, acceptable use, what the data is (and is not), one-time purchases, earlier subscriptions, employer products, liability.' },
  { href: '/privacy', title: 'Privacy Policy', body: 'What Seen collects, how it is used, who can access it, the processors we rely on, and your rights.' },
  { href: '/content-policy', title: 'Content Policy', body: 'How Seen sources and labels content, what the aggregate numbers mean, what we remove, and how to dispute something.' },
] as const

export default function LegalPage() {
  const prep = ONE_TIME_SKUS.interview
  const pass = ONE_TIME_SKUS.pass30
  // Plain facts, each one implemented in code and stated in the documents above:
  //   products + prices → lib/server/creditRules.js ONE_TIME_SKUS / SELLABLE_SKUS (the inline Stripe
  //     price uses the same cents); fulfilled once by lib/server/stripeFulfillment.js;
  //   no new subscription or trial → api/stripe.js checkout refuses a request without a sellable sku;
  //   an earlier subscription → api/stripe.js cancel_subscription, Settings → Plan & billing;
  //   résumé → profiles.resume_text via save_resume / delete via delete_resume + delete_account.
  const facts = [
    'Company grades, the tracker and its check-ins, job search and résumé match are free, with no card.',
    `${offerLine()} ${prep.name} also opens ${prep.pro_days} days of Pro, and the ${pass.name} is ${pass.pro_days} days of Pro; when the time ends, access simply ends and nothing is charged again.`,
    'Seen no longer starts subscriptions or free trials. A Seen Pro subscription started before October 25, 2026 keeps its price and renewal date until you cancel it in Settings → Plan & billing; access continues to the end of the period you paid for.',
    'Your résumé is stored on your profile until you replace it or delete your account, and is used for your own tools (job matching, fit scores, rewrites). It is never sold, and an employer sees it only if you send it with an application through Seen.',
    'We do not sell personal data. Company scores and reports are aggregated applicant claims and public discussion, not verified facts, and nothing on Seen is legal, employment or financial advice.',
  ]

  return (
    <div className="rise-in" style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '4rem 2rem', width: '100%', boxSizing: 'border-box' }}>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-h2)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.35rem' }}>
          Legal
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-sm)', lineHeight: 1.7, marginBottom: '2rem' }}>
          Three documents govern Seen, all effective {LEGAL_EFFECTIVE}. They are the only place our terms
          live — this page just points to them. Questions:{' '}
          <a href={`mailto:${LEGAL_CONTACT}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>{LEGAL_CONTACT}</a>
        </p>

        <div style={{ display: 'grid', gap: '.75rem', marginBottom: '2.5rem' }}>
          {DOCS.map(d => (
            <Link key={d.href} href={d.href} style={{ display: 'block', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1rem 1.2rem', textDecoration: 'none' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 800, color: 'var(--white)', marginBottom: '.25rem' }}>{d.title} →</div>
              <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--sub)', lineHeight: 1.6 }}>{d.body}</div>
            </Link>
          ))}
        </div>

        <h2 style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', marginBottom: '.65rem' }}>
          The plain facts
        </h2>
        <p style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)', lineHeight: 1.7, margin: '0 0 .9rem' }}>
          Each line below is what the product does today and is stated in the documents above
          (<Link href="/terms#one-time" style={{ color: 'var(--sub)' }}>Terms §9–10</Link>,{' '}
          <Link href="/privacy" style={{ color: 'var(--sub)' }}>Privacy §2–7</Link>).
        </p>
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {facts.map(f => (
            <li key={f} style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--sub)', lineHeight: 1.8, marginBottom: '.5rem' }}>{f}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
