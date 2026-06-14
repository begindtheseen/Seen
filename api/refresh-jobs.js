import { getQueryExpansion } from '../lib/server/expand.js';
import { mergeCompanies } from '../lib/server/merge.js';

// Canonical company name aliases — keeps all subsidiaries/variants under one brand
// so job listings roll up correctly to the same company insights page.
const _ALIASES = {
  'aws': 'Amazon', 'amazon web services': 'Amazon', 'amazon.com': 'Amazon',
  'amazon fresh': 'Amazon', 'amazon logistics': 'Amazon', 'whole foods': 'Amazon',
  'whole foods market': 'Amazon', 'zappos': 'Amazon', 'ring': 'Amazon', 'twitch': 'Amazon',
  'facebook': 'Meta', 'instagram': 'Meta', 'whatsapp': 'Meta', 'meta platforms': 'Meta',
  'alphabet': 'Google', 'alphabet inc': 'Google', 'google llc': 'Google', 'youtube': 'Google',
  'deepmind': 'Google', 'waymo': 'Google',
  'microsoft corp': 'Microsoft', 'microsoft corporation': 'Microsoft',
  'apple inc': 'Apple', 'jpmorgan chase': 'JPMorgan', 'jp morgan': 'JPMorgan',
  'goldman sachs group': 'Goldman Sachs', 'bank of america corp': 'Bank of America',
  'wells fargo bank': 'Wells Fargo', 'unitedhealth group': 'UnitedHealth',
  'cvs pharmacy': 'CVS Health', 'cvs caremark': 'CVS Health',
  'deloitte llp': 'Deloitte', 'deloitte consulting': 'Deloitte',
  'walmart inc': 'Walmart', 'wal-mart': 'Walmart', 'target corporation': 'Target',
  'costco wholesale': 'Costco', 'salesforce inc': 'Salesforce', 'salesforce.com': 'Salesforce',
  'slack': 'Salesforce', 'tableau': 'Salesforce',
  'ibm corporation': 'IBM', 'international business machines': 'IBM',
  'oracle corporation': 'Oracle', 'accenture plc': 'Accenture',
  'tesla inc': 'Tesla', 'tesla motors': 'Tesla',
  'lockheed martin corporation': 'Lockheed Martin',
  'raytheon technologies': 'Raytheon', 'boeing company': 'Boeing',
  'spacex': 'SpaceX', 'space exploration technologies': 'SpaceX',
  'netflix inc': 'Netflix', 'uber technologies': 'Uber', 'lyft inc': 'Lyft',
  'shopify inc': 'Shopify', 'doordash inc': 'DoorDash',
  "mcdonald's corporation": "McDonald's", 'mcdonalds': "McDonald's",
  'starbucks corporation': 'Starbucks', 'instacart': 'Instacart', 'maplebear': 'Instacart',
};
const _SFXRE = /[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings)\.?$/i;
function normalizeCompany(raw) {
  if (!raw) return raw;
  const k = raw.toLowerCase().trim();
  if (_ALIASES[k]) return _ALIASES[k];
  const k2 = k.replace(_SFXRE, '').trim();
  return _ALIASES[k2] || raw.trim();
}

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

const BATCH_SIZE = 20;

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

function formatSalary(min, max) {
  if (!min && !max) return null;
  const fmt = v => v >= 10000 ? `$${Math.round(v / 1000)}k` : (v > 0 ? `$${v}/hr` : null);
  const fmin = fmt(min), fmax = fmt(max);
  if (fmin && fmax && fmin !== fmax) return `${fmin}–${fmax}`;
  return fmin || fmax || null;
}

function inferLevel(title) {
  const t = (title || '').toLowerCase();
  if (/\b(senior|sr\b|lead|principal|staff|architect)\b/.test(t)) return 'Senior';
  if (/\b(junior|jr\b|entry.level|associate|intern)\b/.test(t)) return 'Entry level';
  if (/\b(director|vp\b|vice president|head of|chief)\b/.test(t)) return 'Director+';
  return 'Mid level';
}

function scoreJob(company, salaryMin) {
  let s = 65;
  const co = (company || '').toLowerCase();
  if (salaryMin > 0) s += 8;
  if (['stripe', 'figma', 'notion', 'vercel', 'linear', 'google', 'microsoft', 'apple', 'meta', 'netflix'].some(g => co.includes(g))) s += 15;
  if (['amazon', 'accenture', 'cognizant', 'infosys', 'wipro', 'tata'].some(g => co.includes(g))) s -= 15;
  return Math.min(95, Math.max(35, s));
}

function wasteScore(company) {
  const co = (company || '').toLowerCase();
  let w = 25;
  if (['amazon', 'accenture', 'cognizant', 'infosys', 'wipro'].some(g => co.includes(g))) w += 35;
  return Math.min(85, w);
}

async function fetchAdzuna(what, where, appId, appKey) {
  const url = new URL('https://api.adzuna.com/v1/api/jobs/us/search/1');
  url.searchParams.set('app_id', appId);
  url.searchParams.set('app_key', appKey);
  url.searchParams.set('what', what);
  if (where && where.toLowerCase() !== 'remote') url.searchParams.set('where', where);
  url.searchParams.set('results_per_page', '50');
  url.searchParams.set('sort_by', 'date');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s per call max
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    const now = new Date().toISOString();
    return (data.results || []).map(j => ({
      title: j.title || what,
      company: normalizeCompany(j.company?.display_name) || 'Unknown',
      location: j.location?.display_name || where,
      salary: formatSalary(j.salary_min, j.salary_max),
      description: (j.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 8000),
      apply_url: j.redirect_url || null,
      source: 'Adzuna',
      type: j.contract_time === 'part_time' ? 'Part-time' : 'Full-time',
      level: inferLevel(j.title),
      score: scoreJob(normalizeCompany(j.company?.display_name), j.salary_min),
      waste_score: wasteScore(normalizeCompany(j.company?.display_name)),
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      availability_status: 'active',
      last_seen_at: now,
      last_checked_at: now,
    })).filter(j => j.company !== 'Unknown' && j.apply_url && j.description && j.description.length > 80);
  } catch (e) {
    clearTimeout(timeout);
    console.warn('Adzuna fetch error:', e.message);
    return [];
  }
}

// Cache company name → id within a single cron run to avoid duplicate lookups
const _companyIdCache = {};

// Blocks placeholder/garbage values from entering the companies table.
function isValidCompanyName(name) {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim();
  if (n.length < 2 || n.length > 200) return false;
  if (!/[a-zA-Z]/.test(n)) return false;
  if (n.startsWith('#')) return false;
  const lower = n.toLowerCase();
  const BLOCKED = new Set([
    'unknown','n/a','na','none','test','company','employer','null','undefined',
    'other','various','multiple','anonymous','private','confidential','tbd','tba',
    'not specified','not listed','not provided','see description',
  ]);
  if (BLOCKED.has(lower)) return false;
  return true;
}

async function getOrCreateCompanyId(name, supabaseUrl, serviceKey) {
  if (!name || !isValidCompanyName(name)) return null;
  const canon = normalizeCompany(name);
  if (_companyIdCache[canon]) return _companyIdCache[canon];
  const h = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  // Look up by canonical name first
  const look = await fetch(
    `${supabaseUrl}/rest/v1/companies?name=eq.${encodeURIComponent(canon)}&select=id&limit=1`,
    { headers: h }
  );
  if (look.ok) {
    const rows = await look.json();
    if (rows?.[0]?.id) {
      _companyIdCache[canon] = rows[0].id;
      return rows[0].id;
    }
  }
  // Create it
  const create = await fetch(`${supabaseUrl}/rest/v1/companies`, {
    method: 'POST',
    headers: { ...h, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ name: canon }),
  });
  if (create.ok) {
    const rows = await create.json();
    const id = Array.isArray(rows) ? rows[0]?.id : rows?.id;
    if (id) { _companyIdCache[canon] = id; return id; }
  }
  return null;
}

async function upsertJobs(jobs, supabaseUrl, serviceKey) {
  if (!jobs.length) return { upserted: 0, rows: [] };

  // Stamp company_id on every job before inserting
  const withIds = await Promise.all(jobs.map(async j => {
    const cid = await getOrCreateCompanyId(j.company, supabaseUrl, serviceKey);
    return cid ? { ...j, company_id: cid } : j;
  }));

  const res = await fetch(`${supabaseUrl}/rest/v1/jobs?select=id,title,company,description`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(withIds),
  });
  if (!res.ok) return { upserted: 0, rows: [] };
  const rows = await res.json();
  return { upserted: Array.isArray(rows) ? rows.length : 0, rows: Array.isArray(rows) ? rows : [] };
}

// Pre-generate insights for jobs that don't have them yet.
// 5 concurrent Haiku calls, max 20 jobs per cron run (~8s total).
// After the first pass the DB fills up and this becomes a near no-op.
async function pregenInsights(jobs, supabaseUrl, serviceKey, anthropicKey) {
  if (!jobs.length || !anthropicKey || !supabaseUrl || !serviceKey) return;

  const eligible = jobs.filter(j => j.id && j.description && j.description.length > 80).slice(0, 20);
  if (!eligible.length) return;

  // Batch-check which job_ids already have valid cached insights
  const idList = eligible.map(j => `"${j.id}"`).join(',');
  let existingIds = new Set();
  try {
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/job_insights?job_id=in.(${idList})&expires_at=gt.${new Date().toISOString()}&select=job_id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (checkRes.ok) {
      const existing = await checkRes.json();
      existingIds = new Set((existing || []).map(r => String(r.job_id)));
    }
  } catch(e) { /* table may not exist yet — skip */ return; }

  const needed = eligible.filter(j => !existingIds.has(String(j.id)));
  if (!needed.length) return;

  // Generate 5 at a time — fast, cheap, safe on rate limits
  const CONCURRENCY = 5;
  for (let i = 0; i < needed.length; i += CONCURRENCY) {
    await Promise.all(needed.slice(i, i + CONCURRENCY).map(job => _generateOne(job, supabaseUrl, serviceKey, anthropicKey)));
  }
}

async function _generateOne(job, supabaseUrl, serviceKey, anthropicKey) {
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        system: 'You are a job market analyst. Return ONLY valid JSON with no markdown.',
        messages: [{
          role: 'user',
          content: `Analyze this job posting. Return ONLY this JSON:
{"what_they_want":["<skill/trait>","<2>","<3>","<4>","<5>"],"hidden_requirements":["<unstated expectation>","<2>","<3>"],"insider_tip":"<1 sentence strategic advice>","description_summary":"<2-3 paragraph overview of role, responsibilities, and requirements written for job seekers>"}

JOB: ${job.title} at ${job.company}
JOB DESCRIPTION:\n${(job.description || '').slice(0, 2000)}`
        }]
      })
    });
    if (!apiRes.ok) return;

    const text = (await apiRes.json()).content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    const match = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').match(/\{[\s\S]*\}/);
    if (!match) return;
    const parsed = JSON.parse(match[0]);
    if (!parsed?.what_they_want?.length) return;

    await fetch(`${supabaseUrl}/rest/v1/job_insights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        job_id: String(job.id),
        what_they_want: parsed.what_they_want || [],
        hidden_requirements: parsed.hidden_requirements || [],
        insider_tip: parsed.insider_tip || '',
        description_summary: parsed.description_summary || '',
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
  } catch(e) {
    console.error('pregen _generateOne:', e.message);
  }
}

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
  if (!isCron && cronSecret) {
    const authHeader  = req.headers['authorization'] || '';
    const querySecret = new URL(req.url, 'https://x').searchParams.get('secret') || '';
    const cronOk = authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
    if (!cronOk && !adminToken) return res.status(401).json({ error: 'Unauthorized' });
    if (!cronOk && adminToken) {
      // Validate admin session token
      const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SB || !SK) return res.status(401).json({ error: 'Unauthorized' });
      const sr = await fetch(`${SB}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`, { headers: { apikey: SK, Authorization: `Bearer ${SK}` } });
      const sess = sr.ok ? (await sr.json())?.[0] : null;
      if (!sess || new Date(sess.expires_at) < new Date()) return res.status(401).json({ error: 'Unauthorized' });
    }
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

    // Pick which batch of 10 to run based on current UTC hour
    // Pass ?batch=0..4 to override (useful for manual trigger of all batches)
    const batchParam = new URL(req.url, 'https://x').searchParams.get('batch');
    const batchIndex = batchParam !== null ? parseInt(batchParam) : getCurrentBatch();
    const searches = ALL_SEARCHES.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);

    const dbHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };
    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

    // Resolve canonical form for each search term (DB cache → Haiku, runs once per term)
    const canonicalMap = Object.fromEntries(
      await Promise.all(
        searches.map(async s => {
          const qNorm = s.what.toLowerCase().trim();
          const { canonical } = await getQueryExpansion(qNorm, SUPABASE_URL, dbHeaders, ANTHROPIC_KEY);
          return [s.what, canonical];
        })
      )
    );

    // Run all searches in parallel, tag each job with its canonical search_query
    const results = await Promise.allSettled(
      searches.map(async s => {
        const jobs = await fetchAdzuna(s.what, s.where, ADZUNA_APP_ID, ADZUNA_APP_KEY);
        const canonical = canonicalMap[s.what] || s.what.toLowerCase().trim();
        return jobs.map(j => ({ ...j, search_query: canonical }));
      })
    );
    const allJobs = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

    // Pre-warm company ID cache for all unique companies in this batch
    // so parallel upserts below hit the in-memory cache instead of racing to create companies
    const uniqueCompanies = [...new Set(allJobs.map(j => j.company).filter(Boolean))];
    await Promise.all(uniqueCompanies.map(name => getOrCreateCompanyId(name, SUPABASE_URL, SUPABASE_SERVICE_KEY)));

    // Upsert in batches of 100, 3 batches at a time — 4× fewer round trips than 25-per-batch serial
    const UPSERT_BATCH = 100;
    const upsertBatches = Array.from({ length: Math.ceil(allJobs.length / UPSERT_BATCH) }, (_, i) =>
      allJobs.slice(i * UPSERT_BATCH, (i + 1) * UPSERT_BATCH)
    );
    const upsertResults = [];
    for (let i = 0; i < upsertBatches.length; i += 3) {
      const chunk = await Promise.all(upsertBatches.slice(i, i + 3).map(b => upsertJobs(b, SUPABASE_URL, SUPABASE_SERVICE_KEY)));
      upsertResults.push(...chunk);
    }

    // Pre-generate insights for new/uncached jobs — capped at 12s to stay within 60s maxDuration
    const allRows = upsertResults.flatMap(r => r.rows || []);
    await Promise.race([
      pregenInsights(allRows, SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_KEY),
      new Promise(r => setTimeout(r, 12000)),
    ]).catch(e => console.error('pregen error (non-fatal):', e.message));

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
      batch: batchIndex,
      searches: searches.length,
      found: allJobs.length,
      upserted: upsertResults.reduce((sum, r) => sum + (r.upserted || 0), 0),
      purged: junkResult.removed,
      merged,
    });

  } catch (err) {
    console.error('refresh-jobs error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
