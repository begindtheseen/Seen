// Reddit pipeline: fetch hiring-experience posts, classify with Claude Haiku,
// insert into reports with low outcome_weight (community signal, not direct user data).
//
// Runs as a Vercel cron job (GET /api/reddit-import, authenticated via x-vercel-cron).
// Also runnable via CLI: node api/reddit-import.js [--company "Acme Corp"] [--dry-run]
//
// Uses Reddit public JSON API (no OAuth for read-only search).
// Classifies 20 posts per Haiku batch (~$0.002/batch, ~$0.0001/post).

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;

// Companies to process on each scheduled run
const DEFAULT_COMPANIES = [
  'Amazon', 'Google', 'Meta', 'Microsoft', 'Apple', 'Netflix',
  'Walmart', 'Target', 'UPS', 'FedEx', 'Deloitte', 'McKinsey',
  'Goldman Sachs', 'JPMorgan', 'Bank of America', 'Salesforce',
  'Oracle', 'IBM', 'Accenture', 'Lockheed Martin',
];

const SUBREDDITS = ['recruitinghell', 'jobs', 'cscareerquestions', 'careerguidance'];
const POSTS_PER_QUERY = 25;
const REDDIT_WEIGHT   = 0.3; // community signal vs 1.0 for direct user submissions

const dbHeaders = () => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
});

// ── Reddit fetch ─────────────────────────────────────────────────────────────

async function fetchRedditPosts(company, subreddit) {
  const query = encodeURIComponent(`"${company}" hiring OR interview OR ghosted OR rejected OR offer`);
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${query}&sort=new&t=year&limit=${POSTS_PER_QUERY}&restrict_sr=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SeenJobs-HiringIntelligence/1.0 (hiring transparency research)' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data?.children || []).map(c => ({
      id: c.data.name,
      title: (c.data.title || '').slice(0, 300),
      body:  (c.data.selftext || '').slice(0, 1200),
      subreddit: c.data.subreddit || subreddit,
    }));
  } catch {
    return [];
  }
}

// ── Dedup check ──────────────────────────────────────────────────────────────

async function getAlreadyImported(postIds) {
  if (!postIds.length) return new Set();
  const filter = postIds.map(id => `reddit_post_id.eq.${encodeURIComponent(id)}`).join(',');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reddit_imports?or=(${filter})&select=reddit_post_id`,
      { headers: dbHeaders() },
    );
    if (!res.ok) return new Set();
    const rows = await res.json();
    return new Set((rows || []).map(r => r.reddit_post_id));
  } catch {
    return new Set();
  }
}

// ── Claude Haiku classification ───────────────────────────────────────────────

const CLASSIFICATION_SYSTEM = `Classify Reddit posts about job applications and hiring experiences.
For each post return one JSON object with:
- outcome: "ghosted" | "rejected" | "hired" | "offer" | "interview" | "applied" | "unknown"
- role: job title mentioned, or null
- is_hiring_experience: true only if this is a first-person hiring story
- sentiment: "positive" | "negative" | "neutral" | "mixed"
- summary: 1-sentence max-200-char summary of the experience, or null if not a hiring story
Return ONLY a JSON array, one object per post, same order. No markdown.`;

async function classifyBatch(posts) {
  const input = posts
    .map((p, i) => `[${i}] TITLE: ${p.title}\nBODY: ${p.body || '(no body)'}`)
    .join('\n\n---\n\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: CLASSIFICATION_SYSTEM,
      messages: [{ role: 'user', content: `Classify these ${posts.length} Reddit posts:\n\n${input}` }],
    }),
  });

  if (!res.ok) return posts.map(() => ({ outcome: 'unknown', is_hiring_experience: false }));

  try {
    const data = await res.json();
    return JSON.parse(data.content?.[0]?.text || '[]');
  } catch {
    return posts.map(() => ({ outcome: 'unknown', is_hiring_experience: false }));
  }
}

// ── DB writes ─────────────────────────────────────────────────────────────────

async function upsertCompany(name) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/companies?name=ilike.${encodeURIComponent(name)}&select=id&limit=1`,
    { headers: dbHeaders() },
  );
  if (res.ok) {
    const rows = await res.json();
    if (rows?.[0]?.id) return rows[0].id;
  }
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/companies`, {
    method: 'POST',
    headers: { ...dbHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({ name }),
  });
  if (!ins.ok) return null;
  const created = await ins.json();
  return created?.[0]?.id || null;
}

async function insertReport(company_name, company_id, post, cls) {
  const body = {
    company_name,
    platform: `Reddit r/${post.subreddit}`,
    outcome:  cls.outcome || 'unknown',
    role:     cls.role    || null,
    report_text: cls.summary || post.title.slice(0, 500),
    source: 'reddit',
    outcome_weight: REDDIT_WEIGHT,
    trust_reason:   'community_signal',
    needs_review:   false,
    rounds:       0,
    unpaid_work:  'na',
    experience_level: 'Unknown',
  };
  if (company_id) body.company_id = company_id;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
    method: 'POST',
    headers: { ...dbHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.id || null;
}

async function recordImport(post, company_name, report_id, skipped, skip_reason) {
  await fetch(`${SUPABASE_URL}/rest/v1/reddit_imports`, {
    method: 'POST',
    headers: { ...dbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      reddit_post_id: post.id,
      company_name,
      subreddit: post.subreddit,
      report_id: report_id || null,
      skipped,
      skip_reason: skip_reason || null,
    }),
  });
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function processCompany(company, dryRun) {
  console.log(`\n► ${company}`);
  let imported = 0, skipped = 0;

  for (const sub of SUBREDDITS) {
    const posts = await fetchRedditPosts(company, sub);
    if (!posts.length) continue;

    const seen    = await getAlreadyImported(posts.map(p => p.id));
    const newPosts = posts.filter(p => !seen.has(p.id));
    if (!newPosts.length) {
      console.log(`  r/${sub}: all ${posts.length} already imported`);
      continue;
    }
    console.log(`  r/${sub}: ${newPosts.length} new posts`);

    for (let i = 0; i < newPosts.length; i += 20) {
      const batch = newPosts.slice(i, i + 20);
      const classifications = await classifyBatch(batch);

      for (let j = 0; j < batch.length; j++) {
        const post = batch[j];
        const cls  = Array.isArray(classifications) ? (classifications[j] || {}) : {};

        if (!cls.is_hiring_experience) {
          if (!dryRun) await recordImport(post, company, null, true, 'not_hiring_experience');
          skipped++;
          continue;
        }

        if (dryRun) {
          console.log(`  [dry-run] ${post.title.slice(0, 60)} → ${cls.outcome}`);
          imported++;
          continue;
        }

        const company_id = await upsertCompany(company);
        const report_id  = await insertReport(company, company_id, post, cls);
        await recordImport(post, company, report_id, !report_id, report_id ? null : 'insert_failed');
        if (report_id) imported++; else skipped++;
      }

      // Stay within Reddit rate limit
      if (i + 20 < newPosts.length) await new Promise(r => setTimeout(r, 600));
    }
  }

  console.log(`  → imported: ${imported}, skipped: ${skipped}`);
  return { imported, skipped };
}

// ── Vercel handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Vercel cron sends GET with x-vercel-cron header; manual trigger can POST
  const isCron = req.headers['x-vercel-cron'] === '1';
  const isPost = req.method === 'POST';
  if (!isCron && !isPost) return res.status(405).json({ error: 'not allowed' });

  // POST calls must include service key for security
  if (isPost) {
    const auth = req.headers.authorization || '';
    if (!SERVICE_KEY || !auth.includes(SERVICE_KEY)) return res.status(401).json({ error: 'unauthorized' });
  }

  if (!ANTHROPIC_KEY || !SERVICE_KEY || !SUPABASE_URL) {
    return res.status(500).json({ error: 'missing env vars' });
  }

  const { companies = DEFAULT_COMPANIES, dry_run = false } = req.body || {};
  const results = {};

  for (const company of companies.slice(0, 12)) { // max 12 per cron run
    results[company] = await processCompany(company, dry_run);
  }

  return res.status(200).json({ ok: true, results });
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('reddit-import.js')) {
  if (!ANTHROPIC_KEY || !SERVICE_KEY || !SUPABASE_URL) {
    console.error('Set ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const dryRun     = args.includes('--dry-run');
  const coIdx      = args.indexOf('--company');
  const companies  = coIdx >= 0 ? [args[coIdx + 1]] : DEFAULT_COMPANIES;

  let total = 0;
  for (const company of companies) {
    const r = await processCompany(company, dryRun);
    total += r.imported;
  }
  console.log(`\nTotal imported: ${total}`);
}
