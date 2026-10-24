import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import { PRO_TRIAL_DAYS, ONE_TIME_SKUS } from '@/lib/server/creditRules.js'
import { proPriceLine } from '@/lib/pricing'
import { LEGAL_CONTACT } from '@/components/legal/LegalBits'

// /legal is a HUB, not a fourth legal document. Until 2026-10-24 this page was a second, older set of
// terms that contradicted /terms, /privacy and /content-policy ("your first charge occurs at checkout"
// against the $0 no-card trial; "binding arbitration under AAA" against the terms' open venue item; a
// "Pro waitlist"; a "Billing & Subscription portal" button that does not exist). Everything legal now
// lives in the three documents; this page links them and repeats only facts the code implements,
// rendered from the same constants the server charges with (lib/pricing.test.mjs fails on a hand-typed
// price).

export const metadata: Metadata = pageMetadata({
  title: 'Legal',
  description:
    'Seen’s Terms of Service, Privacy Policy and Content Policy in one place, with the plain facts about the free trial, prices, one-time purchases and your data.',
  path: '/legal',
  ogTitle: 'Legal | Seen',
  ogDescription: 'Terms of Service, Privacy Policy and Content Policy — and the plain facts about the trial, prices and your data.',
})

const DOCS = [
  { href: '/terms', title: 'Terms of Service', body: 'Eligibility, acceptable use, what the data is (and is not), subscriptions, one-time purchases, employer products, liability.' },
  { href: '/privacy', title: 'Privacy Policy', body: 'What Seen collects, how it is used, who can access it, the processors we rely on, and your rights.' },
  { href: '/content-policy', title: 'Content Policy', body: 'How Seen sources and labels content, what the aggregate numbers mean, what we remove, and how to dispute something.' },
] as const

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

export default function LegalPage() {
  const sprint = ONE_TIME_SKUS.sprint
  const pack = ONE_TIME_SKUS.credits20
  // Plain facts, each one implemented in code and stated in the documents above:
  //   trial → api/stripe.js checkout (trial_period_days, payment_method_collection 'if_required');
  //   prices → lib/server/creditRules.js PRO_PRICING (the inline Stripe price uses the same cents);
  //   cancel → api/stripe.js cancel_subscription, Settings → Plan & billing;
  //   one-time SKUs → ONE_TIME_SKUS, fulfilled by lib/server/stripeFulfillment.js;
  //   résumé → profiles.resume_text via save_resume / delete via delete_resume + delete_account.
  const facts = [
    `Seen Pro starts with a ${PRO_TRIAL_DAYS}-day free trial and asks for no card. Nothing is charged unless you add a payment method; without one, access simply ends.`,
    `Seen Pro is ${proPriceLine()}. It renews until you cancel, and you cancel in Settings → Plan & billing — access continues to the end of the period you paid for.`,
    `One-time purchases never renew: the ${sprint.name} (${usd(sprint.amount_cents)}) adds ${sprint.credits} AI credits and ${sprint.pro_days} days of Pro; the ${pack.name} (${usd(pack.amount_cents)}) adds ${pack.credits} AI credits. Purchased credits do not expire or reset.`,
    'Your résumé is stored on your profile until you replace it or delete your account, and is used only for your own tools (job matching, fit scores, rewrites). It is never shown to employers or sold.',
    'We do not sell personal data. Company scores and reports are aggregated applicant claims and public discussion, not verified facts, and nothing on Seen is legal, employment or financial advice.',
  ]

  return (
    <div className="rise-in" style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '4rem 2rem', width: '100%', boxSizing: 'border-box' }}>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.35rem' }}>
          Legal
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.82rem', lineHeight: 1.7, marginBottom: '2rem' }}>
          Three documents govern Seen. They are drafts awaiting attorney review, and they are the only
          place our terms live — this page just points to them. Questions:{' '}
          <a href={`mailto:${LEGAL_CONTACT}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>{LEGAL_CONTACT}</a>
        </p>

        <div style={{ display: 'grid', gap: '.75rem', marginBottom: '2.5rem' }}>
          {DOCS.map(d => (
            <Link key={d.href} href={d.href} style={{ display: 'block', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1rem 1.2rem', textDecoration: 'none' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.25rem' }}>{d.title} →</div>
              <div style={{ fontFamily: 'var(--body)', fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.6 }}>{d.body}</div>
            </Link>
          ))}
        </div>

        <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', marginBottom: '.65rem' }}>
          The plain facts
        </h2>
        <p style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', lineHeight: 1.7, margin: '0 0 .9rem' }}>
          Each line below is what the product does today and is stated in the documents above
          (<Link href="/terms#billing" style={{ color: 'var(--sub)' }}>Terms §8–9</Link>,{' '}
          <Link href="/privacy" style={{ color: 'var(--sub)' }}>Privacy §2, §6</Link>).
        </p>
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {facts.map(f => (
            <li key={f} style={{ fontFamily: 'var(--body)', fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.8, marginBottom: '.5rem' }}>{f}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
