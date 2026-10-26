import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/shell/PageHeader'
import { pageMetadata } from '@/lib/seo'
import { MIN_REPORTS_FOR_RATES } from '@/lib/companyPageSummary'
import {
  BASE_FORMULA, VERDICT_THRESHOLDS, SUBMIT_HOLDS, TENURE_POINTS_MAX, TRUST, PRIOR_STRENGTH, POPULATION_PRIOR, POPULATION_PRIOR_STRENGTH, MIN_TENURE_SAMPLE,
  FULL_TENURE_SAMPLE, EMPLOYEE_REVIEW_POINTS_MAX, MIN_EMPLOYEE_REVIEWS, FULL_EMPLOYEE_REVIEWS,
  STALE_LISTING_POINTS, STALE_LISTING_PENALTY_MAX, MIN_REPORTS_FOR_GRADE, MIN_REAL_REPORTS_FOR_GRADE,
  MENTION_WEIGHT, GRADE_BANDS, weightLabel,
} from '@/lib/methodsFacts.js'
import styles from './methods.module.css'

// How a Seen Grade is computed, in plain words, for applicants, employers and search engines. Every
// number on this page is read from the scoring code through lib/methodsFacts.js (tested against the
// real functions in lib/methodsFacts.test.mjs), so the page cannot say one thing while the math does
// another. Describe ONLY what the code does.

export const metadata: Metadata = pageMetadata({
  title: 'How Seen grades companies',
  description: `How a Seen Grade is computed from applicant accounts: what counts as a report, how each source is weighted, the ${MIN_REPORTS_FOR_GRADE} applicant accounts a grade needs, and how an employer can respond. Money never changes a score.`,
  path: '/methods',
  ogTitle: 'How Seen grades companies',
})

const pct = (r: number) => `${Math.round(r * 100)}%`
const half = MENTION_WEIGHT === 0.5 ? 'half' : weightLabel(MENTION_WEIGHT)

const SOURCES: Array<{ label: string; note: string; weight: number }> = [
  // classifyPlatform (api/_utils/companyIntel.js) reads trust_reason, so a Seen report that names the job
  // board the person applied on (LinkedIn, Indeed…) keeps the full weight.
  { label: 'Reports from Seen users', note: 'Sent with the report form or the application tracker. Naming the job board you applied on (LinkedIn, Indeed…) does not change the weight.', weight: TRUST.direct },
  { label: 'Seen applicant surveys', note: 'Answers applicants give in Seen’s own short surveys.', weight: TRUST.seen_intel },
  { label: 'Imported hiring accounts', note: 'First hand hiring accounts imported from job review sites.', weight: TRUST.ingest },
  { label: 'Reddit', note: 'Shown as public discussion, never as a Seen user’s report.', weight: TRUST.reddit },
  { label: 'Public review sites', note: 'First hand accounts found on public review sites and forums, labelled with the site they came from.', weight: TRUST.public_web },
  { label: 'Online mentions', note: 'Quoted accounts of what people say online. Only ones that state an outcome move the rates.', weight: TRUST.mentions },
]

export default function MethodsPage() {
  const f = BASE_FORMULA
  return (
    <div className="page-full">
      <div className={styles.wrap}>
        <PageHeader
          eyebrow="Methods"
          title="How Seen grades companies"
          crumbLabel="How grades work"
          sub="A Seen Grade is a score from 0 to 100 for how a company treats the people who apply. It is built from what applicants report, and it is a summary of claims, not a verified fact."
        />

        <section className={styles.card} aria-labelledby="m-scale">
          <h2 id="m-scale" className={styles.h2}>The letter</h2>
          <p className={styles.p}>The score maps to one letter, the same on the company page, share cards and every list:</p>
          <ul className={styles.bands}>
            {GRADE_BANDS.map((b, i) => (
              <li key={b.letter} className={styles.band}>
                <span className={styles.letter}>{b.letter}</span>
                <span className={styles.range}>{b.min > 0 ? `${b.min} to ${i === 0 ? 100 : GRADE_BANDS[i - 1].min - 1}` : `under ${GRADE_BANDS[i - 1].min}`}</span>
              </li>
            ))}
          </ul>
          <p className={styles.p}>
            Next to the grade, a short line says what the reports add up to: at {pct(VERDICT_THRESHOLDS.most)} or more hearing back it reads
            &ldquo;Most applicants hear back&rdquo;, from {pct(VERDICT_THRESHOLDS.half)} it reads that about half hear back, and below that,
            that most never hear back.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="m-report">
          <h2 id="m-report" className={styles.h2}>What counts as a report</h2>
          <p className={styles.p}>A report is one applicant&rsquo;s account of one application and how it ended:</p>
          <ul className={styles.list}>
            <li><b>Heard back.</b> Any answer from the company: a screen, an assessment, an interview, an offer, a hire, or a rejection. A rejection is still an answer.</li>
            <li><b>Ghosted.</b> The applicant never heard anything back.</li>
            <li><b>Automated rejection.</b> Counts as a finished application, but neither as a human answer nor as ghosting.</li>
          </ul>
          <p className={styles.p}>
            Applications that are still open, or that the applicant withdrew, are not counted: they say nothing yet about whether the company answers.
            Employee reviews (what it is like to work somewhere) are shown on the page but are never counted as hiring outcomes.
          </p>
          <p className={styles.p}>
            The response rate is the share of finished applications that heard back; the ghost rate is the share that never did. Both are
            weighted by where each report came from (below).
          </p>
        </section>

        <section className={styles.card} aria-labelledby="m-sources">
          <h2 id="m-sources" className={styles.h2}>Where reports come from, and how much each counts</h2>
          <p className={styles.p}>A report sent to Seen by an applicant counts fully. Accounts gathered from public sources count less, because nobody at Seen can ask the writer a follow up question.</p>
          <ul className={styles.sources}>
            {SOURCES.map(s => (
              <li key={s.label} className={styles.source}>
                <div className={styles.sourceTop}>
                  <span className={styles.sourceName}>{s.label}</span>
                  <span className={styles.weight}>counts {weightLabel(s.weight)}</span>
                </div>
                <p className={styles.note}>{s.note}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.card} aria-labelledby="m-min">
          <h2 id="m-min" className={styles.h2}>When a company gets a grade</h2>
          <p className={styles.p}>
            A grade needs at least {MIN_REAL_REPORTS_FOR_GRADE} real applicant account and {MIN_REPORTS_FOR_GRADE} in total, where
            each report counts 1 and each online mention counts {half}. Mentions alone never grade a company. Below that bar the page shows no letter,
            no score and no rates, only what Seen holds so far, as &ldquo;Not graded yet (2 of {MIN_REPORTS_FOR_GRADE} applicant accounts)&rdquo;.
          </p>
          <p className={styles.p}>
            Response and ghost percentages need {MIN_REPORTS_FOR_RATES} applicant accounts of their own. A company graded with fewer shows its grade
            and says there are too few reports for a rate yet.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="m-math">
          <h2 id="m-math" className={styles.h2}>The math</h2>
          <p className={styles.p}>The score starts at {f.start} and moves with what the reports say:</p>
          <ul className={styles.list}>
            <li>plus up to {f.responsePoints} for the response rate ({f.responsePoints} &times; the rate);</li>
            <li>minus up to {f.ghostPoints} for the ghost rate ({f.ghostPoints} &times; the rate);</li>
            <li>minus up to {f.waitPoints} for a long average wait ({f.waitPoints} &times; days waited &divide; {f.waitCapDays}, counted up to {f.waitCapDays} days);</li>
            <li>plus up to {f.volumeMax} for how much evidence there is ({f.volumePerLn} &times; the natural log of the weighted report count plus 1), so a large sample nudges the score but can never outweigh the outcomes.</li>
          </ul>
          <p className={styles.p}>Three small, capped adjustments can follow:</p>
          <ul className={styles.list}>
            <li><b>Time people stay.</b> Up to {TENURE_POINTS_MAX} points either way from how long people stay at the company, read from r&eacute;sum&eacute;s. Only with at least {MIN_TENURE_SAMPLE} r&eacute;sum&eacute;s; full strength at {FULL_TENURE_SAMPLE}.</li>
            <li><b>Employee review grades.</b> Up to {EMPLOYEE_REVIEW_POINTS_MAX} points either way from the letter grades in employee reviews, where an average C changes nothing. Only with at least {MIN_EMPLOYEE_REVIEWS} reviews; full strength at {FULL_EMPLOYEE_REVIEWS}.</li>
            <li><b>Dead listings.</b> Minus {STALE_LISTING_POINTS} for each job listing that applicants reported and Seen confirmed was no longer open, up to minus {STALE_LISTING_PENALTY_MAX}.</li>
          </ul>
          <p className={styles.p}>
            A few reports should not make a company look perfect or terrible. So until a company has enough evidence, its rates lean toward a
            typical company on Seen ({pct(POPULATION_PRIOR.response_rate)} hear back, {pct(POPULATION_PRIOR.ghost_rate)} never do): the typical
            company counts as {POPULATION_PRIOR_STRENGTH} weighted reports, so two public posts barely move a score, two reports from Seen users
            move it half-way, and thirty Seen reports are almost entirely the company&rsquo;s own.
          </p>
          <p className={styles.p}>
            The result is kept between 0 and 100. Some older scores started from a research estimate made before any reports existed; reports are blended
            with it instead, count equally with it at {PRIOR_STRENGTH} weighted reports, and outweigh it beyond that.
          </p>
          <p className={styles.p}>A company&rsquo;s score is recomputed whenever a new report about it is saved, and the page shows the date of the last recompute.</p>
        </section>

        <section className={styles.card} aria-labelledby="m-claims">
          <h2 id="m-claims" className={styles.h2}>Reports are claims</h2>
          <p className={styles.p}>
            Seen does not check each account with the company, so every number is worded as what applicant accounts say, never as a fact about the
            employer. To keep one person from moving a grade, a report is held for review and does not count until someone at Seen approves it when it
            is sent without signing in, when the same person already reported the same company in the last {SUBMIT_HOLDS.dupDays} days, or when one
            account sends {SUBMIT_HOLDS.dailyCap} or more in a day. Reports an admin rejects, and second copies of a report Seen already holds, are kept
            on record but never counted.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="m-money">
          <h2 id="m-money" className={styles.h2}>Money never changes a score</h2>
          <p className={styles.p}>
            Employers can pay for a featured listing or a Transparency Verified badge. Both change where a company appears or what badge it shows.
            Neither one is an input to the grade, and no one can pay to raise or remove one.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="m-employers">
          <h2 id="m-employers" className={styles.h2}>If you are the employer</h2>
          <p className={styles.p}>
            You can claim your company&rsquo;s page from the <Link href="/employers">employer portal</Link> and reply to reports about it. Replies are
            reviewed before they appear, are labelled as the employer&rsquo;s, and never change the score. If a report is inaccurate, contains personal
            information or looks made up, send it to us through the <Link href="/contact">contact page</Link> with what supports your case; disputes are
            reviewed under the <Link href="/content-policy">content policy</Link>. A negative experience on its own is never removed.
          </p>
        </section>

        <p className={styles.foot}>
          Questions about a number on a company page? <Link href="/contact">Ask us</Link>, or <Link href="/report">report your own outcome</Link> so the next applicant knows more.
        </p>
      </div>
    </div>
  )
}
