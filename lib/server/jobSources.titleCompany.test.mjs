// A job TITLE in the company field must never reach the jobs table.
//
// Arbeitnow publishes some listings with a title as `company_name` (its own URL slug is built from
// it: …/jobs/companies/senior-software-engineer-typescript-backend-aiml/…). On 2026-10-17 prod had
// 23 such rows under 3 fake "companies". Every name below is a real value from prod or the live
// Arbeitnow feed that day; the negatives are real employers a looser rule would have dropped.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { isTitleLikeCompany, buildJob, fetchSecondarySources } = await import('./jobSources.js');

const TITLE_LIKE = [
  'Senior Software Engineer (Typescript / Backend) - AI/ML',
  'Signal Processing Engineer (RF Processing & Analytics)',
  'Junior Data Scientist - Downstream Demand Forecast - Value Chain ...',
  'Stage Data Analyst - Paris (H/F/X)',
  'Werkstudent Marketing (m/w/d)',
  'Product Manager - EV Charging (all genders)',
];

const REAL_EMPLOYERS = [
  'ILF Consulting Engineers Germany GmbH', // role word, but a legal entity
  'Invictus Lead Generation GmbH',
  'Junior AI',                             // seniority word, no role noun
  'The Blue Collar Recruiter - Ambler, PA', // role noun + dash, but led by "The"
  'Samsung SDS Europe Ltd. German Branch (Logistics Division)',
  'SIDES (SimplyDelivery GmbH)',
  'Nitrado (marbis GmbH)',
  'Tala (We are Tala Ltd)',
  'Good Hood GmbH / nebenan.de',
  'Mirakl - Labs',
  'Wolt - English',
  'The Part-Time Finance People',
  'SÜSS Beratende Ingenieure',
  'WUP INGENIEURE',
  'ubitricity - Gesellschaft für verteilte Energiesysteme mbH',
  'Software Engineering Daily',
  'Amazon',
  '',
  null,
];

test('isTitleLikeCompany flags titles stored as company names', () => {
  for (const n of TITLE_LIKE) assert.equal(isTitleLikeCompany(n), true, n);
});

test('isTitleLikeCompany leaves real employers alone', () => {
  for (const n of REAL_EMPLOYERS) assert.equal(isTitleLikeCompany(n), false, String(n));
});

const listing = (company) => ({
  title: 'Machine Learning Engineer',
  company,
  location: 'Berlin',
  description: 'We build things. '.repeat(10),
  apply_url: 'https://www.arbeitnow.com/jobs/companies/x/machine-learning-engineer-berlin-1',
  source: 'Arbeitnow',
  type: 'Full-time',
});

test('buildJob rejects a row whose company is a job title', () => {
  assert.equal(buildJob(listing('Senior Software Engineer (Typescript / Backend) - AI/ML')), null);
  const ok = buildJob(listing('ILF Consulting Engineers Germany GmbH'));
  assert.equal(ok?.company, 'ILF Consulting Engineers Germany GmbH');
});

// The whole ingest seam: raw Arbeitnow payload → fetchSecondarySources() → rows the cron upserts.
test('Arbeitnow rows with a title as company_name never leave the source fetch', async () => {
  const realFetch = global.fetch;
  const desc = '<p>About Us Harmattan AI is a next-generation defense prime building autonomous systems.</p>';
  global.fetch = async (url) => {
    const u = String(url);
    if (!u.startsWith('https://www.arbeitnow.com/api/job-board-api')) {
      return { ok: false, status: 503, async json() { return null; } };
    }
    return {
      ok: true, status: 200,
      async json() {
        return { data: [
          { company_name: 'Signal Processing Engineer (RF Processing & Analytics)', title: 'Computer Vision Engineer',
            description: desc, url: 'https://www.arbeitnow.fr/jobs/companies/signal-processing-engineer-rf-processing-analytics/cv-1',
            remote: false, location: 'Paris', job_types: [] },
          { company_name: 'ADBAKER', title: 'Werkstudent Creator Management (TikTok Shop) - all genders',
            description: desc, url: 'https://www.arbeitnow.com/jobs/companies/adbaker/werkstudent-1',
            remote: false, location: 'Cologne', job_types: ['Praktikum'] },
        ] };
      },
    };
  };
  try {
    const { jobs, bySource } = await fetchSecondarySources();
    assert.deepEqual(jobs.map((j) => j.company), ['ADBAKER']);
    assert.equal(bySource.Arbeitnow, 1);
  } finally {
    global.fetch = realFetch;
  }
});
