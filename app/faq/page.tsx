export default function FAQPage() {
  const sections = [
    {
      heading: 'About Seen',
      items: [
        {
          q: 'What is Seen?',
          a: 'Seen is a hiring transparency platform that scores companies by how they actually treat applicants. We aggregate real applicant reports to calculate a 0–100 transparency score, ghost rate, and response speed — for 47,000+ companies. We also surface ghost surge alerts: when a company\'s ghosting spikes in a given week, you see it before you apply.',
        },
        {
          q: 'Is Seen free for job seekers?',
          a: 'Yes. Seen is completely free for job seekers and always will be. The core tools — company scores, ghost rates, community feed, job search, and basic tracker — are free forever. Pro is an optional upgrade for real-time ghost surge email alerts and advanced features.',
        },
        {
          q: 'How is Seen different from Glassdoor or Indeed?',
          a: 'Indeed is paid by employers — which is why ghost jobs exist and never get removed. Glassdoor covers general company culture. Seen focuses exclusively on the hiring process: do they respond, how long does it take, which stage do they ghost at. We also detect week-over-week ghost surges and alert you before you apply — something neither platform does.',
        },
        {
          q: 'Who built Seen?',
          a: 'Seen was built by someone who lived this problem — months of applying to ghost jobs, completing unpaid assessments with no response, and watching good candidates lose months to companies that were never actually hiring. We got frustrated enough to fix it.',
        },
      ],
    },
    {
      heading: 'How scores work',
      items: [
        {
          q: 'How are transparency scores calculated?',
          a: 'Scores use a public formula: response rate (×40), ghost rate (×−30), average wait time (×−15), and a log-scale report volume boost. The formula is published on our homepage — no hidden weights. 70+ is Safe, 40–69 is Caution, below 40 is Danger. All scores are expressions of aggregated community opinion, not verified facts.',
        },
        {
          q: 'What are ghost surge alerts?',
          a: 'A ghost surge is detected when a company receives 3 or more "ghosted" reports within a 7-day rolling window — meaningfully more than its recent baseline. Surge alerts appear on company pages, the community feed, job cards, and the landing page. They flag deteriorating hiring behavior so you can factor it in before applying. Note: a surge can reflect seasonal patterns or a small number of reports — treat it as a signal, not a verdict.',
        },
        {
          q: 'What is the Waste Probability score?',
          a: 'Waste Probability calculates the % chance a specific job application will waste your time — based on ghost rate, number of rounds, unpaid work history, and listing age. A 70%+ waste risk means 7 in 10 people reported it wasted their time. This metric exists nowhere else.',
        },
        {
          q: 'Why does the same company have different scores in different cities?',
          a: 'Because they are effectively different employers. A franchise in Irvine, CA is owned and operated differently from one in Chicago, IL. Their hiring practices can differ dramatically. Seen scores each location independently when sufficient data exists for that location.',
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
          a: 'Yes. We do not collect your name, email, or any identifying information with anonymous reports. We store only the report content, timestamp, and a hashed session ID for spam prevention. Nothing that identifies you personally. We will never share report data with employers.',
        },
        {
          q: 'What makes a good report?',
          a: 'Describe what actually happened during your application: how long you waited, which stage you reached, whether you were ghosted, and any relevant details about the job description versus reality. Avoid naming specific individual employees — focus on the company\'s process. Positive reports are just as valuable as negative ones.',
        },
        {
          q: 'Why does submitting reports matter?',
          a: 'Every report updates the company\'s score, ghost rate, and process data — in real time. A report you submit today helps someone searching for that company tonight decide whether to apply. The more reports a company has, the more statistically reliable its score becomes. It takes 60 seconds and helps thousands.',
        },
        {
          q: 'Can I edit or delete my report?',
          a: 'Because reports are fully anonymous, we cannot verify ownership. If you believe a report you submitted contains an error or personal information that should be removed, email hello@tryseen.io and we will review it manually.',
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
          a: 'Email hello@tryseen.io with the specific content, the reason it violates our guidelines (factual inaccuracy, personal information, or clear fabrication), and supporting evidence. We review within 14 business days. We do not remove reports simply because they are negative — negative experiences are protected speech and the core data this platform is built on.',
        },
        {
          q: 'Does Seen accept paid placements?',
          a: 'No. We do not accept money to improve a company\'s transparency score or placement. Verified badges appear in search but do not override scores. The data is never for sale.',
        },
      ],
    },
  ]

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '4rem 2rem' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--blue)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 22, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
          Help center
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.35rem' }}>
          Frequently asked questions
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.85rem', marginBottom: '3rem' }}>
          Can&apos;t find what you need? Email <a href="mailto:hello@tryseen.io" style={{ color: 'var(--blue)', textDecoration: 'none' }}>hello@tryseen.io</a>
        </p>

        {sections.map(section => (
          <div key={section.heading} style={{ marginBottom: '2.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--blue)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
              {section.heading}
            </div>
            {section.items.map(item => (
              <details key={item.q} style={{ marginBottom: '.65rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10 }}>
                <summary style={{ padding: '1rem 1.25rem', fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {item.q}
                  <span style={{ color: 'var(--dim)', fontWeight: 400, fontSize: '.7rem', flexShrink: 0, marginLeft: '.5rem' }}>+</span>
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
