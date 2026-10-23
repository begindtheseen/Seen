import type { ReactNode } from 'react'
import Link from 'next/link'
import PageHeader from '@/components/shell/PageHeader'

const EMAIL = 'hello@seenjobs.io'
const Mail = () => <a href={`mailto:${EMAIL}`}>{EMAIL}</a>

export default function FAQPage() {
  const sections: Array<{ heading: string; items: Array<{ q: string; a: ReactNode }> }> = [
    {
      heading: 'About Seen',
      items: [
        {
          q: 'What is Seen?',
          a: 'Seen is a hiring transparency platform that scores companies by how they actually treat applicants. We aggregate applicant reports — submitted to Seen, plus public review-site and discussion accounts (labeled and down-weighted) — into a 0–100 transparency score, ghost rate, and response rate for any company you look up. Hundreds of companies carry a grade today; any company can be looked up and self-fills from public sources. Ghost-surge signals (3+ ghosted reports in 7 days) show on your dashboard for the companies you are waiting on.',
        },
        {
          q: 'Is Seen free for job seekers?',
          a: 'Yes. Seen is completely free for job seekers and always will be. The core tools — company scores, ghost rates, community feed, job search, and basic tracker — are free forever. Pro is an optional upgrade for unlimited AI credits and deeper company analysis.',
        },
        {
          q: 'How is Seen different from Glassdoor or Indeed?',
          a: 'Indeed is paid by employers — which is why ghost jobs exist and never get removed. Glassdoor covers general company culture. Seen focuses exclusively on the hiring process: do they respond, how long does it take, which stage do they ghost at. We also flag ghost surges on your dashboard for the companies you are waiting on — something neither platform does.',
        },
        {
          q: 'Who built Seen?',
          a: <>Brandon, Seen&apos;s founder, in California. He built it after months of applying to jobs that were never really open, finishing unpaid assessments nobody answered, and watching good candidates lose a season to companies that had stopped hiring. Seen is independent and bootstrapped: no employer pays for placement, and no score has ever changed for money. He reads every message sent to <Mail />.</>,
        },
        {
          q: 'How do I contact Seen?',
          a: <>Email <Mail /> — or use the <Link href="/contact">contact page</Link>, which says what to include. A person answers within two business days.</>,
        },
      ],
    },
    {
      heading: 'How scores work',
      items: [
        {
          q: 'How are transparency scores calculated?',
          a: 'Scores start at a neutral 50, then add response rate (×40), subtract ghost rate (×30) and average wait (up to −15), and add a small log-scale bonus for the trust-weighted volume of evidence (capped at +10). Reports submitted to Seen count fully; public review-site and discussion accounts count at reduced weight; admin-confirmed dead listings apply a bounded penalty. No company is graded until it has at least one report submitted to Seen and five pieces of evidence in total (an online mention counts as half). 70+ is Safe, 40–69 is Caution, below 40 is Danger. All scores are expressions of aggregated applicant claims, not verified facts.',
        },
        {
          q: 'What are ghost surge alerts?',
          a: 'A ghost surge is detected when a company receives 3 or more "ghosted" reports within a 7-day rolling window — meaningfully more than its recent baseline. Surges appear on your dashboard for the companies you have open applications with. They flag deteriorating hiring behavior so you can factor it into your follow-ups. Note: a surge can reflect seasonal patterns or a small number of reports — treat it as a signal, not a verdict.',
        },
        {
          q: 'What is the Waste Probability score?',
          a: 'Waste risk estimates how likely an application is to go nowhere. For a company it is modeled from the reported ghost rate, interview rounds and unpaid-work rate; for a listing it is modeled from signals in the posting itself (staffing-intermediary language, unpaid or commission-only terms, missing pay, which ATS it runs on). It is a model, not a tally of people saying it wasted their time.',
        },
        {
          q: 'Why does the same company have different scores in different cities?',
          a: 'Because they are effectively different employers. A franchise in Irvine, CA is owned and operated differently from one in Chicago, IL. Their hiring practices can differ dramatically. Today Seen scores the company as a whole and shows the per-city breakdown of reported outcomes on the company page\'s Locations tab; separate per-location scores are not computed yet.',
        },
        {
          q: 'Can scores change?',
          a: 'Yes. Every new report triggers a recalculation. If a company improves their hiring practices and applicants report better experiences, their score rises. Scores are not permanent — they reflect current behavior.',
        },
      ],
    },
    {
      heading: 'Submitting reports',
      items: [
        {
          q: 'Are reports anonymous?',
          a: 'Yes. We do not collect your name, email, or any identifying information with anonymous reports. If you are signed in, the report is linked to your account so we can prevent duplicate submissions and let you see your own outcomes; it is never shown with your name or email. Anonymous (signed-out) reports carry no account link and are held for review before they count. We will never share who reported what with employers.',
        },
        {
          q: 'What makes a good report?',
          a: 'Describe what actually happened during your application: how long you waited, which stage you reached, whether you were ghosted, and any relevant details about the job description versus reality. Avoid naming specific individual employees — focus on the company\'s process. Positive reports are just as valuable as negative ones.',
        },
        {
          q: 'Why does submitting reports matter?',
          a: 'Every report that passes the anti-gaming checks updates the company\'s score, ghost rate and response rate as soon as it is saved. A report you submit today helps the next person who checks that company decide whether to apply. The more reports a company has, the more reliable its score becomes. It takes 60 seconds.',
        },
        {
          q: 'Can I edit or delete my report?',
          a: <>Because reports are fully anonymous, we cannot verify ownership. If you believe a report you submitted contains an error or personal information that should be removed, email <Mail /> and we will review it manually.</>,
        },
      ],
    },
    {
      heading: 'For employers',
      items: [
        {
          q: 'My company has a low score. What can I do?',
          a: 'The most effective thing is to improve your hiring practices — respond to applicants, close listings when roles are filled, and be honest about your process. Scores update in real time as new reports come in. You can also get Verified, which shows job seekers you\'re committed to transparency.',
        },
        {
          q: 'Can I dispute a report?',
          a: <>Email <Mail /> with the specific content, the reason it violates our guidelines (factual inaccuracy, personal information, or clear fabrication), and supporting evidence. We review within 14 business days. We do not remove reports simply because they are negative — negative experiences are protected speech and the core data this platform is built on.</>,
        },
        {
          q: 'Does Seen accept paid placements?',
          a: 'No. We do not accept money to improve a company\'s transparency score or placement. Verified badges appear in search but do not override scores. The data is never for sale.',
        },
      ],
    },
  ]

  return (
    <div className="page-full">
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '4rem 2rem', width: '100%', boxSizing: 'border-box' }}>
        <PageHeader
          eyebrow="Help center"
          title="Frequently asked questions"
          crumbLabel="FAQ"
          sub={<>Can&apos;t find what you need? Email <Mail /> or visit the <Link href="/contact">contact page</Link>.</>}
        />
        <div style={{ height: '1.4rem' }} />

        {sections.map(section => (
          <div key={section.heading} style={{ marginBottom: '2.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--blue)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
              {section.heading}
            </div>
            {section.items.map(item => (
              <details key={item.q} style={{ marginBottom: '.65rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10 }}>
                <summary style={{ padding: '1rem 1.25rem', fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {item.q}
                  <span className="dt-chev" style={{ color: 'var(--dim)', fontWeight: 400, fontSize: '.7rem', flexShrink: 0, marginLeft: '.5rem' }}>▾</span>
                </summary>
                <div style={{ padding: '0 1.25rem 1rem', fontFamily: 'var(--body)', fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.75 }}>
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
