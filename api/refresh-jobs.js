import { getQueryExpansion } from '../lib/server/expand.js';
import { mergeCompanies } from '../lib/server/merge.js';
import { logError } from '../lib/server/errlog.js';
// Source fetchers, company create, and job upsert live in the shared keyless engine so
// this cron and the on-demand search top-up (api/jobs.js) can never drift.
import {
  fetchAdzuna,
  fetchSecondarySources,
  getOrCreateCompanyId,
  upsertJobs,
  mapLimit,
} from '../lib/server/jobSources.js';

// 240 searches across 12 batches of 20. 6 cron runs/day → all 12 batches covered in 2 days.
// Adzuna free tier: 250 calls/day — 120/day (20×6) stays well within limit.
// Each Adzuna call returns up to 50 jobs → ~6,000 new listings refreshed every 2 days.

const ALL_SEARCHES = [
  // ── Healthcare mid/senior ─────────────────────────────────────────────────
  { what: 'Registered Nurse', where: 'Los Angeles, CA' },
  { what: 'Registered Nurse', where: 'New York, NY' },
  { what: 'Registered Nurse', where: 'Chicago, IL' },
  { what: 'Registered Nurse', where: 'Houston, TX' },
  { what: 'Registered Nurse', where: 'Phoenix, AZ' },
  { what: 'Registered Nurse', where: 'Atlanta, GA' },
  { what: 'Physical Therapist', where: 'Los Angeles, CA' },
  { what: 'Physical Therapist', where: 'Chicago, IL' },
  { what: 'Physical Therapist', where: 'Dallas, TX' },
  { what: 'Occupational Therapist', where: 'New York, NY' },
  { what: 'Occupational Therapist', where: 'Los Angeles, CA' },
  { what: 'Speech Language Pathologist', where: 'New York, NY' },
  { what: 'Dental Hygienist', where: 'Los Angeles, CA' },
  { what: 'Dental Hygienist', where: 'Phoenix, AZ' },
  { what: 'LVN', where: 'Los Angeles, CA' },
  { what: 'LVN', where: 'Houston, TX' },
  { what: 'Nurse Practitioner', where: 'New York, NY' },
  { what: 'Nurse Practitioner', where: 'Dallas, TX' },
  { what: 'Social Worker', where: 'New York, NY' },
  { what: 'Social Worker', where: 'Chicago, IL' },
  // ── Healthcare entry level ────────────────────────────────────────────────
  { what: 'CNA', where: 'New York, NY' },
  { what: 'CNA', where: 'Atlanta, GA' },
  { what: 'CNA', where: 'Los Angeles, CA' },
  { what: 'CNA', where: 'Chicago, IL' },
  { what: 'CNA', where: 'Houston, TX' },
  { what: 'Medical Assistant', where: 'Los Angeles, CA' },
  { what: 'Medical Assistant', where: 'Dallas, TX' },
  { what: 'Medical Assistant', where: 'Phoenix, AZ' },
  { what: 'Medical Assistant', where: 'Atlanta, GA' },
  { what: 'Home Health Aide', where: 'New York, NY' },
  { what: 'Home Health Aide', where: 'Chicago, IL' },
  { what: 'Home Health Aide', where: 'Houston, TX' },
  { what: 'Patient Care Technician', where: 'Houston, TX' },
  { what: 'Patient Care Technician', where: 'Atlanta, GA' },
  { what: 'Pharmacy Technician', where: 'Los Angeles, CA' },
  { what: 'Pharmacy Technician', where: 'Chicago, IL' },
  { what: 'Phlebotomist', where: 'Los Angeles, CA' },
  { what: 'Phlebotomist', where: 'Dallas, TX' },
  { what: 'Dental Assistant', where: 'Los Angeles, CA' },
  { what: 'Dental Assistant', where: 'Phoenix, AZ' },
  // ── Healthcare specialist ─────────────────────────────────────────────────
  { what: 'Radiologic Technologist', where: 'New York, NY' },
  { what: 'Radiologic Technologist', where: 'Houston, TX' },
  { what: 'Ultrasound Technician', where: 'Los Angeles, CA' },
  { what: 'EMT', where: 'New York, NY' },
  { what: 'EMT', where: 'Chicago, IL' },
  { what: 'Paramedic', where: 'Houston, TX' },
  { what: 'Paramedic', where: 'Phoenix, AZ' },
  { what: 'Medical Biller', where: 'Remote' },
  { what: 'Medical Coder', where: 'Remote' },
  { what: 'Healthcare Administrator', where: 'New York, NY' },
  { what: 'Mental Health Counselor', where: 'New York, NY' },
  { what: 'Mental Health Counselor', where: 'Los Angeles, CA' },
  { what: 'Veterinary Technician', where: 'Los Angeles, CA' },
  { what: 'Veterinary Technician', where: 'Denver, CO' },
  { what: 'Clinical Research Coordinator', where: 'Boston, MA' },
  { what: 'Medical Receptionist', where: 'Los Angeles, CA' },
  { what: 'Sterile Processing Technician', where: 'Chicago, IL' },
  { what: 'Surgical Tech', where: 'Dallas, TX' },
  { what: 'Dialysis Technician', where: 'Houston, TX' },
  { what: 'Health Information Technician', where: 'Remote' },
  // ── Tech senior ───────────────────────────────────────────────────────────
  { what: 'Software Engineer', where: 'San Francisco, CA' },
  { what: 'Software Engineer', where: 'Seattle, WA' },
  { what: 'Software Engineer', where: 'Austin, TX' },
  { what: 'Software Engineer', where: 'New York, NY' },
  { what: 'Software Engineer', where: 'Remote' },
  { what: 'Senior Software Engineer', where: 'San Francisco, CA' },
  { what: 'Senior Software Engineer', where: 'Remote' },
  { what: 'Product Manager', where: 'San Francisco, CA' },
  { what: 'Product Manager', where: 'New York, NY' },
  { what: 'Product Manager', where: 'Remote' },
  { what: 'DevOps Engineer', where: 'Remote' },
  { what: 'DevOps Engineer', where: 'Seattle, WA' },
  { what: 'Data Scientist', where: 'San Francisco, CA' },
  { what: 'Data Scientist', where: 'New York, NY' },
  { what: 'Data Scientist', where: 'Remote' },
  { what: 'Cloud Engineer', where: 'Remote' },
  { what: 'Cybersecurity Analyst', where: 'Washington, DC' },
  { what: 'Cybersecurity Analyst', where: 'Remote' },
  { what: 'Machine Learning Engineer', where: 'Remote' },
  { what: 'Backend Developer', where: 'Remote' },
  // ── Tech entry/mid ────────────────────────────────────────────────────────
  { what: 'Frontend Developer', where: 'New York, NY' },
  { what: 'Frontend Developer', where: 'Remote' },
  { what: 'Full Stack Developer', where: 'Austin, TX' },
  { what: 'Full Stack Developer', where: 'Remote' },
  { what: 'Web Developer', where: 'Remote' },
  { what: 'Data Analyst', where: 'New York, NY' },
  { what: 'Data Analyst', where: 'Chicago, IL' },
  { what: 'Data Analyst', where: 'Remote' },
  { what: 'QA Engineer', where: 'Remote' },
  { what: 'IT Support Specialist', where: 'New York, NY' },
  { what: 'IT Support Specialist', where: 'Los Angeles, CA' },
  { what: 'Network Administrator', where: 'Dallas, TX' },
  { what: 'UX Designer', where: 'Remote' },
  { what: 'UX Designer', where: 'New York, NY' },
  { what: 'Junior Software Engineer', where: 'Remote' },
  { what: 'Junior Software Engineer', where: 'New York, NY' },
  { what: 'React Developer', where: 'Remote' },
  { what: 'Python Developer', where: 'Remote' },
  { what: 'Database Administrator', where: 'Remote' },
  { what: 'IT Project Manager', where: 'Remote' },
  // ── Finance / Business ────────────────────────────────────────────────────
  { what: 'Financial Analyst', where: 'New York, NY' },
  { what: 'Financial Analyst', where: 'Chicago, IL' },
  { what: 'Financial Analyst', where: 'Dallas, TX' },
  { what: 'Accountant', where: 'New York, NY' },
  { what: 'Accountant', where: 'Chicago, IL' },
  { what: 'Accountant', where: 'Los Angeles, CA' },
  { what: 'Bookkeeper', where: 'Remote' },
  { what: 'Bookkeeper', where: 'New York, NY' },
  { what: 'Tax Accountant', where: 'New York, NY' },
  { what: 'Tax Accountant', where: 'Remote' },
  { what: 'Financial Advisor', where: 'New York, NY' },
  { what: 'Financial Advisor', where: 'Dallas, TX' },
  { what: 'Loan Officer', where: 'New York, NY' },
  { what: 'Loan Officer', where: 'Los Angeles, CA' },
  { what: 'Bank Teller', where: 'New York, NY' },
  { what: 'Bank Teller', where: 'Houston, TX' },
  { what: 'Business Analyst', where: 'New York, NY' },
  { what: 'Business Analyst', where: 'Chicago, IL' },
  { what: 'Business Analyst', where: 'Remote' },
  { what: 'Insurance Agent', where: 'Dallas, TX' },
  // ── Office / Admin ────────────────────────────────────────────────────────
  { what: 'Customer Service Representative', where: 'Remote' },
  { what: 'Customer Service Representative', where: 'New York, NY' },
  { what: 'Customer Service Representative', where: 'Dallas, TX' },
  { what: 'Administrative Assistant', where: 'New York, NY' },
  { what: 'Administrative Assistant', where: 'Los Angeles, CA' },
  { what: 'Administrative Assistant', where: 'Chicago, IL' },
  { what: 'Receptionist', where: 'New York, NY' },
  { what: 'Receptionist', where: 'Los Angeles, CA' },
  { what: 'Office Manager', where: 'New York, NY' },
  { what: 'Office Manager', where: 'Chicago, IL' },
  { what: 'Executive Assistant', where: 'New York, NY' },
  { what: 'Executive Assistant', where: 'Remote' },
  { what: 'Data Entry Clerk', where: 'Remote' },
  { what: 'Paralegal', where: 'New York, NY' },
  { what: 'Paralegal', where: 'Los Angeles, CA' },
  { what: 'Legal Assistant', where: 'New York, NY' },
  { what: 'Operations Manager', where: 'New York, NY' },
  { what: 'Operations Manager', where: 'Chicago, IL' },
  { what: 'Project Manager', where: 'Remote' },
  { what: 'Project Manager', where: 'New York, NY' },
  // ── HR / Recruiting / Marketing ───────────────────────────────────────────
  { what: 'Human Resources Manager', where: 'New York, NY' },
  { what: 'Human Resources Manager', where: 'Chicago, IL' },
  { what: 'HR Coordinator', where: 'Atlanta, GA' },
  { what: 'HR Coordinator', where: 'Remote' },
  { what: 'Recruiter', where: 'New York, NY' },
  { what: 'Recruiter', where: 'Remote' },
  { what: 'Talent Acquisition Specialist', where: 'Remote' },
  { what: 'Marketing Manager', where: 'New York, NY' },
  { what: 'Marketing Manager', where: 'Los Angeles, CA' },
  { what: 'Marketing Coordinator', where: 'New York, NY' },
  { what: 'Marketing Coordinator', where: 'Remote' },
  { what: 'Social Media Manager', where: 'Remote' },
  { what: 'Content Writer', where: 'Remote' },
  { what: 'Copywriter', where: 'Remote' },
  { what: 'Graphic Designer', where: 'Remote' },
  { what: 'Graphic Designer', where: 'New York, NY' },
  { what: 'SEO Specialist', where: 'Remote' },
  { what: 'Email Marketing Specialist', where: 'Remote' },
  { what: 'Brand Manager', where: 'New York, NY' },
  { what: 'Digital Marketing Specialist', where: 'Remote' },
  // ── Sales ─────────────────────────────────────────────────────────────────
  { what: 'Sales Representative', where: 'New York, NY' },
  { what: 'Sales Representative', where: 'Dallas, TX' },
  { what: 'Sales Representative', where: 'Chicago, IL' },
  { what: 'Account Manager', where: 'New York, NY' },
  { what: 'Account Manager', where: 'Remote' },
  { what: 'Account Manager', where: 'Chicago, IL' },
  { what: 'Account Executive', where: 'San Francisco, CA' },
  { what: 'Account Executive', where: 'Remote' },
  { what: 'Inside Sales Representative', where: 'Remote' },
  { what: 'Inside Sales Representative', where: 'Dallas, TX' },
  { what: 'Sales Manager', where: 'New York, NY' },
  { what: 'Sales Manager', where: 'Chicago, IL' },
  { what: 'Business Development Representative', where: 'Remote' },
  { what: 'Customer Success Manager', where: 'Remote' },
  { what: 'Real Estate Agent', where: 'Los Angeles, CA' },
  { what: 'Real Estate Agent', where: 'Dallas, TX' },
  { what: 'Leasing Consultant', where: 'Los Angeles, CA' },
  { what: 'Property Manager', where: 'Dallas, TX' },
  { what: 'Property Manager', where: 'Atlanta, GA' },
  { what: 'Mortgage Loan Originator', where: 'New York, NY' },
  // ── Warehouse / Logistics ─────────────────────────────────────────────────
  { what: 'Warehouse Associate', where: 'Los Angeles, CA' },
  { what: 'Warehouse Associate', where: 'Chicago, IL' },
  { what: 'Warehouse Associate', where: 'Dallas, TX' },
  { what: 'Warehouse Associate', where: 'Houston, TX' },
  { what: 'Amazon Warehouse', where: 'Los Angeles, CA' },
  { what: 'Amazon Warehouse', where: 'New York, NY' },
  { what: 'Amazon Warehouse', where: 'Dallas, TX' },
  { what: 'Amazon Warehouse', where: 'Chicago, IL' },
  { what: 'Amazon Warehouse', where: 'Phoenix, AZ' },
  { what: 'Delivery Driver', where: 'Los Angeles, CA' },
  { what: 'Delivery Driver', where: 'New York, NY' },
  { what: 'Delivery Driver', where: 'Chicago, IL' },
  { what: 'Forklift Operator', where: 'Chicago, IL' },
  { what: 'Forklift Operator', where: 'Dallas, TX' },
  { what: 'Forklift Operator', where: 'Los Angeles, CA' },
  { what: 'CDL Truck Driver', where: 'Dallas, TX' },
  { what: 'CDL Truck Driver', where: 'Chicago, IL' },
  { what: 'CDL Truck Driver', where: 'Houston, TX' },
  { what: 'Logistics Coordinator', where: 'Los Angeles, CA' },
  { what: 'Package Handler', where: 'Los Angeles, CA' },
  // ── Retail / Food service ─────────────────────────────────────────────────
  { what: 'Sales Associate', where: 'Los Angeles, CA' },
  { what: 'Sales Associate', where: 'New York, NY' },
  { what: 'Sales Associate', where: 'Chicago, IL' },
  { what: 'Sales Associate', where: 'Houston, TX' },
  { what: 'Cashier', where: 'Los Angeles, CA' },
  { what: 'Cashier', where: 'New York, NY' },
  { what: 'Cashier', where: 'Dallas, TX' },
  { what: 'Barista', where: 'Seattle, WA' },
  { what: 'Barista', where: 'New York, NY' },
  { what: 'Barista', where: 'Los Angeles, CA' },
  { what: 'Cook', where: 'New York, NY' },
  { what: 'Cook', where: 'Los Angeles, CA' },
  { what: 'Server', where: 'New York, NY' },
  { what: 'Server', where: 'Las Vegas, NV' },
  { what: 'Bartender', where: 'New York, NY' },
  { what: 'Bartender', where: 'Miami, FL' },
  { what: 'Restaurant Manager', where: 'New York, NY' },
  { what: 'Restaurant Manager', where: 'Miami, FL' },
  { what: 'Shift Supervisor', where: 'Chicago, IL' },
  { what: 'Retail Manager', where: 'Dallas, TX' },
  // ── Trades ────────────────────────────────────────────────────────────────
  { what: 'Electrician', where: 'Phoenix, AZ' },
  { what: 'Electrician', where: 'Houston, TX' },
  { what: 'Electrician', where: 'Dallas, TX' },
  { what: 'Plumber', where: 'Los Angeles, CA' },
  { what: 'Plumber', where: 'Houston, TX' },
  { what: 'Plumber', where: 'Atlanta, GA' },
  { what: 'HVAC Technician', where: 'Phoenix, AZ' },
  { what: 'HVAC Technician', where: 'Atlanta, GA' },
  { what: 'HVAC Technician', where: 'Houston, TX' },
  { what: 'Welder', where: 'Houston, TX' },
  { what: 'Welder', where: 'Dallas, TX' },
  { what: 'Carpenter', where: 'New York, NY' },
  { what: 'Carpenter', where: 'Los Angeles, CA' },
  { what: 'Automotive Technician', where: 'Los Angeles, CA' },
  { what: 'Automotive Technician', where: 'Dallas, TX' },
  { what: 'Diesel Mechanic', where: 'Dallas, TX' },
  { what: 'Maintenance Technician', where: 'Los Angeles, CA' },
  { what: 'Maintenance Technician', where: 'Chicago, IL' },
  { what: 'Construction Worker', where: 'Houston, TX' },
  { what: 'Construction Worker', where: 'Phoenix, AZ' },
  // ── Education / Services ──────────────────────────────────────────────────
  { what: 'Teacher', where: 'Los Angeles, CA' },
  { what: 'Teacher', where: 'Chicago, IL' },
  { what: 'Teacher', where: 'New York, NY' },
  { what: 'Teacher', where: 'Houston, TX' },
  { what: 'Teaching Assistant', where: 'New York, NY' },
  { what: 'Teaching Assistant', where: 'Los Angeles, CA' },
  { what: 'Special Education Teacher', where: 'New York, NY' },
  { what: 'School Counselor', where: 'Los Angeles, CA' },
  { what: 'Childcare Worker', where: 'New York, NY' },
  { what: 'Childcare Worker', where: 'Chicago, IL' },
  { what: 'Security Guard', where: 'Los Angeles, CA' },
  { what: 'Security Guard', where: 'New York, NY' },
  { what: 'Security Guard', where: 'Chicago, IL' },
  { what: 'Landscaper', where: 'Phoenix, AZ' },
  { what: 'Landscaper', where: 'Dallas, TX' },
  { what: 'Personal Trainer', where: 'New York, NY' },
  { what: 'Personal Trainer', where: 'Los Angeles, CA' },
  { what: 'Cosmetologist', where: 'Los Angeles, CA' },
  { what: 'Tutor', where: 'Remote' },
  { what: 'Dispatcher', where: 'Dallas, TX' },
];

// 30 Adzuna searches/run × 6 runs/day = 180 calls/day — safely under the 250/day
// free-tier cap while re-confirming more existing listings each run (cuts the stale
// count). All 30 run in parallel, each ≤8s, so wall-clock stays well within the 60s
// maxDuration. The full ALL_SEARCHES list is covered every ~36 hours.
const BATCH_SIZE = 30;

// Progressive rotation — cycles through ALL batches over time rather than
// repeating the same 6 forever. Uses day-of-year so each cron run advances
// through the full search list over ~2 days, then wraps around.
function getCurrentBatch() {
  const BATCH_HOURS = [2, 6, 10, 14, 18, 22];
  const now = new Date();
  const hour = now.getUTCHours();
  const runsPerDay = BATCH_HOURS.length;
  const totalBatches = Math.ceil(ALL_SEARCHES.length / BATCH_SIZE);
  const runOfDay = BATCH_HOURS.reduce((best, h, i) => {
    return Math.abs(h - hour) < Math.abs(BATCH_HOURS[best] - hour) ? i : best;
  }, 0);
  const dayOfYear = Math.floor((now - new Date(now.getUTCFullYear(), 0, 0)) / 86400000);
  return (dayOfYear * runsPerDay + runOfDay) % totalBatches;
}

// Exact row count of the jobs table (via PostgREST count=exact Content-Range header).
// Used to split a merge-duplicates upsert into NEW inserts vs updates of existing rows.
async function jobCount(supabaseUrl, serviceKey) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/jobs?select=id`, {
      method: 'HEAD',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'count=exact', Range: '0-0' },
    });
    const cr = r.headers.get('content-range'); // e.g. "0-0/5194"
    const total = cr && cr.includes('/') ? parseInt(cr.split('/')[1], 10) : NaN;
    return Number.isFinite(total) ? total : null;
  } catch (_e) { return null; }
}

// Count of ACTIVE listings only — drives the autonomous auto-heal trigger below.
async function activeJobCount(supabaseUrl, serviceKey) {
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/jobs?select=id&availability_status=eq.active`, {
      method: 'HEAD',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'count=exact', Range: '0-0' },
    });
    const cr = r.headers.get('content-range');
    const total = cr && cr.includes('/') ? parseInt(cr.split('/')[1], 10) : NaN;
    return Number.isFinite(total) ? total : null;
  } catch (_e) { return null; }
}

// Crisis floor — keep in sync with admin-stats.js JOB_HEALTH_MIN_ACTIVE.
const AUTO_HEAL_MIN_ACTIVE = 500;

async function deleteExpired(supabaseUrl, serviceKey) {
  await fetch(`${supabaseUrl}/rest/v1/jobs?expires_at=lt.${new Date().toISOString()}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=minimal',
    },
  });
}

async function markStaleJobs(supabaseUrl, serviceKey) {
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  const staleISO = new Date(Date.now() - 7 * 86400000).toISOString();
  const expiredISO = new Date(Date.now() - 14 * 86400000).toISOString();
  await Promise.all([
    // active jobs not seen in 7+ days → stale
    fetch(`${supabaseUrl}/rest/v1/jobs?availability_status=eq.active&last_seen_at=lt.${staleISO}`, {
      method: 'PATCH', headers: h, body: JSON.stringify({ availability_status: 'stale' }),
    }),
    // stale/active jobs not seen in 14+ days → expired
    fetch(`${supabaseUrl}/rest/v1/jobs?availability_status=in.(active,stale)&last_seen_at=lt.${expiredISO}`, {
      method: 'PATCH', headers: h, body: JSON.stringify({ availability_status: 'expired' }),
    }),
  ]).catch(e => console.error('markStaleJobs error (non-fatal):', e.message));
}

// Scan every active listing and immediately remove any that fail quality standards.
// Runs every cron hit — cheap (only fetches id + description + apply_url).
async function deleteJunk(supabaseUrl, serviceKey) {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/jobs?select=id,description,apply_url&expires_at=gt.${new Date().toISOString()}&limit=2000`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!res.ok) return { removed: 0 };
    const rows = await res.json();

    const badIds = (rows || []).filter(r =>
      !r.description ||
      r.description.trim().length < 80 ||
      !r.apply_url
    ).map(r => r.id);

    if (!badIds.length) return { removed: 0 };

    // Delete in chunks of 100 to stay inside URL length limits
    for (let i = 0; i < badIds.length; i += 100) {
      const chunk = badIds.slice(i, i + 100);
      await fetch(`${supabaseUrl}/rest/v1/jobs?id=in.(${chunk.join(',')})`, {
        method: 'DELETE',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'return=minimal',
        },
      });
    }

    console.log(`deleteJunk: removed ${badIds.length} junk listings`);
    return { removed: badIds.length };
  } catch(e) {
    console.error('deleteJunk error:', e.message);
    return { removed: 0 };
  }
}

export default async function handler(req, res) {
  const headers = { 'Content-Type': 'application/json' };

  const cronSecret = process.env.CRON_SECRET;
  const adminToken = req.headers['x-admin-token'] || '';
  const isCron     = req.headers['x-vercel-cron'] === '1';
  // Fail CLOSED: every non-cron caller must present a valid cron secret OR a valid
  // admin session token. Authorization must NOT be contingent on CRON_SECRET being
  // set — if that env var is blank/unset, the cron-secret path is simply
  // unavailable and callers fall through to 401. Never let a missing secret turn
  // this expensive + destructive (deleteExpired/deleteJunk/markStaleJobs) endpoint
  // into an open, unauthenticated trigger.
  if (!isCron) {
    const authHeader  = req.headers['authorization'] || '';
    const querySecret = new URL(req.url, 'https://x').searchParams.get('secret') || '';
    const cronOk = !!cronSecret && (authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret);
    let adminOk = false;
    if (!cronOk && adminToken) {
      // Validate admin session token
      const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;
      if (SB && SK) {
        const sr = await fetch(`${SB}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`, { headers: { apikey: SK, Authorization: `Bearer ${SK}` } });
        const sess = sr.ok ? (await sr.json())?.[0] : null;
        adminOk = !!sess && new Date(sess.expires_at) >= new Date();
      }
    }
    if (!cronOk && !adminOk) return res.status(401).json({ error: 'Unauthorized' });
  }

  const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
  const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    return res.status(500).json({ error: 'Missing ADZUNA_APP_ID or ADZUNA_APP_KEY' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' });
  }

  try {
    const [, junkResult] = await Promise.all([
      deleteExpired(SUPABASE_URL, SUPABASE_SERVICE_KEY),
      deleteJunk(SUPABASE_URL, SUPABASE_SERVICE_KEY),
      markStaleJobs(SUPABASE_URL, SUPABASE_SERVICE_KEY),
    ]);

    // ?all=1 (or ?mode=full): "backfill everything now" emergency mode — runs ALL
    // Adzuna searches AND every keyless source in one invocation. Capped so it stays
    // within the 60s maxDuration. Triggered by an admin "emergency refresh" button.
    const reqUrl = new URL(req.url, 'https://x');
    let fullMode = reqUrl.searchParams.get('all') === '1' || reqUrl.searchParams.get('mode') === 'full';

    // AUTO-HEAL (fully autonomous): if the live-listing pool has fallen into crisis — the SAME
    // threshold the admin dashboard flags — automatically escalate THIS cron run to a full,
    // all-sources backfill. No human click, no waiting: a crisis self-corrects on the very next
    // scheduled run (≤4h away). The full path is already capped for the 60s maxDuration.
    let autoHealed = false;
    if (!fullMode) {
      const activeNow = await activeJobCount(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      if (activeNow != null && activeNow < AUTO_HEAL_MIN_ACTIVE) {
        fullMode = true;
        autoHealed = true;
        console.warn(`AUTO-HEAL: job crisis detected (${activeNow} active < ${AUTO_HEAL_MIN_ACTIVE}) → full all-sources backfill`);
      }
    }

    // Pick which batch to run based on current UTC hour.
    // Pass ?batch=N to override (useful for manually triggering a specific batch).
    const batchParam = reqUrl.searchParams.get('batch');
    const batchIndex = batchParam !== null ? parseInt(batchParam) : getCurrentBatch();
    // Full/auto-heal mode: a heavy multi-source backfill capped at 72 Adzuna searches so it
    // reliably completes inside the 60s function limit at 8-concurrent (240 was too many and
    // threw "fetch failed"). Combined with all 5 secondary sources this adds ~600+ listings
    // per run — plenty to clear the crisis floor; the next scheduled runs top up the rest.
    const searches = fullMode
      ? ALL_SEARCHES.slice(0, 72)
      : ALL_SEARCHES.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);

    const dbHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Resolve canonical form for each search term (DB cache → LLM gateway, runs once per term).
    // Bounded to 10 concurrent — in full/auto-heal mode this can be 72 terms, and firing them
    // all at once contributed to the same socket exhaustion ("fetch failed") the mapLimit fix targets.
    const canonicalMap = Object.fromEntries(
      await mapLimit(searches, 10, async s => {
        const qNorm = s.what.toLowerCase().trim();
        const { canonical } = await getQueryExpansion(qNorm, SUPABASE_URL, dbHeaders);
        return [s.what, canonical];
      })
    );

    // Run Adzuna searches (bounded to 8 concurrent) AND the keyless secondary sources.
    // fetchAdzuna already isolates its own failures (returns []), so no listing can break
    // the run; bounding concurrency prevents "fetch failed" from socket exhaustion.
    const [adzunaArrays, secondary] = await Promise.all([
      mapLimit(searches, 8, async s => {
        const jobs = await fetchAdzuna(s.what, s.where, ADZUNA_APP_ID, ADZUNA_APP_KEY);
        const canonical = canonicalMap[s.what] || s.what.toLowerCase().trim();
        return jobs.map(j => ({ ...j, search_query: canonical }));
      }),
      // Secondary sources self-tag their own search_query and isolate their own failures.
      fetchSecondarySources().catch(e => {
        console.warn('secondary sources error (non-fatal):', e.message);
        return { jobs: [], bySource: {} };
      }),
    ]);
    const adzunaJobs = adzunaArrays.flat();
    const allJobs = [...adzunaJobs, ...secondary.jobs];
    const sourceCounts = { Adzuna: adzunaJobs.length, ...secondary.bySource };

    // Pre-warm the company-ID cache (bounded to 12 concurrent so a large full-mode batch
    // can't open thousands of DB connections at once → "fetch failed").
    const uniqueCompanies = [...new Set(allJobs.map(j => j.company).filter(Boolean))];
    await mapLimit(uniqueCompanies, 12, name => getOrCreateCompanyId(name, SUPABASE_URL, SUPABASE_SERVICE_KEY));

    // Upsert in batches of 100, 3 batches at a time — 4× fewer round trips than 25-per-batch serial
    const UPSERT_BATCH = 100;
    const upsertBatches = Array.from({ length: Math.ceil(allJobs.length / UPSERT_BATCH) }, (_, i) =>
      allJobs.slice(i * UPSERT_BATCH, (i + 1) * UPSERT_BATCH)
    );
    // Count before/after the upserts so we can report NEW listings vs updates of
    // existing ones (a merge-duplicates upsert can't tell them apart on its own).
    const countBefore = await jobCount(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const upsertResults = [];
    for (let i = 0; i < upsertBatches.length; i += 3) {
      const chunk = await Promise.all(upsertBatches.slice(i, i + 3).map(b => upsertJobs(b, SUPABASE_URL, SUPABASE_SERVICE_KEY)));
      upsertResults.push(...chunk);
    }
    const countAfter = await jobCount(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const upsertedTotal = upsertResults.reduce((sum, r) => sum + (r.upserted || 0), 0);
    const inserted = (countBefore != null && countAfter != null) ? Math.max(0, countAfter - countBefore) : null;
    const updated = inserted != null ? Math.max(0, upsertedTotal - inserted) : null;

    // Job insights are now generated deterministically on demand (lib/server/jobInsights.js
    // via api/job-insights.js) — no Anthropic pre-generation needed in the cron.

    // Sunday only: backfill company_id on jobs that are missing it + merge duplicates
    let merged = 0;
    if (new Date().getDay() === 0 && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      // Backfill: find jobs with no company_id, stamp them
      try {
        const h = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
        const nullRes = await fetch(
          `${SUPABASE_URL}/rest/v1/jobs?company_id=is.null&select=id,company&limit=500`,
          { headers: h }
        );
        if (nullRes.ok) {
          const nullJobs = await nullRes.json();
          for (const j of (nullJobs || [])) {
            const cid = await getOrCreateCompanyId(j.company, SUPABASE_URL, SUPABASE_SERVICE_KEY);
            if (cid) {
              await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${j.id}`, {
                method: 'PATCH',
                headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ company_id: cid }),
              });
            }
          }
          console.log(`BACKFILL: stamped company_id on ${nullJobs?.length || 0} jobs`);
        }
      } catch(e) { console.error('backfill error (non-fatal):', e.message); }

      const mr = await mergeCompanies(SUPABASE_URL, SUPABASE_SERVICE_KEY).catch(() => ({}));
      merged = mr.deleted || 0;
    }

    return res.status(200).json({
      ok: true,
      date: new Date().toISOString(),
      mode: fullMode ? 'full' : 'batch',
      auto_healed: autoHealed,
      batch: fullMode ? 'all' : batchIndex,
      searches: searches.length,
      found: allJobs.length,
      bySource: sourceCounts,
      upserted: upsertedTotal,
      inserted,
      updated,
      purged: junkResult.removed,
      merged,
    });

  } catch (err) {
    console.error('refresh-jobs error:', err.message);
    logError('refresh-jobs', err.message, { isCron });
    return res.status(500).json({ error: err.message });
  }
}
