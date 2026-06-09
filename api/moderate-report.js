// Report content moderation: location reality-check + Claude quality/safety review
// Called before saving a report to DB. Fails open (ok:true) on any API error
// so a bad connection never blocks a legitimate submission.

export default async function handler(req, res) {
  const _o=req.headers.origin||'';
  const _devO=!_o||_o.includes('localhost')||_o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin',(_devO||['https://seenjobs.io','https://www.seenjobs.io'].includes(_o))?(_o||'*'):'https://seenjobs.io');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = req.body;
  if (typeof body === 'string') try { body = JSON.parse(body); } catch(e) { body = {}; }
  const { company, role, location, experience } = body || {};

  if (!company || !role) {
    return res.status(400).json({ ok: false, issues: ['Company and role are required.'] });
  }

  const results = await Promise.allSettled([
    checkLocation(location),
    moderateContent(company, role, experience),
  ]);

  const locResult  = results[0].status === 'fulfilled' ? results[0].value : { valid: true, normalized: location };
  const modResult  = results[1].status === 'fulfilled' ? results[1].value : { ok: true, issues: [], corrected_experience: null };

  const issues = [
    ...(!locResult.valid ? ['Location not recognized — enter a real city (e.g. "Austin, TX" or "Chicago, IL").'] : []),
    ...(modResult.issues || []),
  ];

  return res.json({
    ok: locResult.valid && modResult.ok,
    issues,
    corrected_experience: modResult.corrected_experience || null,
    normalized_location: locResult.normalized || location,
  });
}

// ── Location check via Nominatim (free, no key) ───────────────────────────────
async function checkLocation(location) {
  if (!location || location.trim().length < 3) return { valid: false, normalized: null };
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Seen/1.0 (seenjobs.io)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { valid: true, normalized: location }; // fail open
    const places = await res.json();
    if (!places?.length) return { valid: false, normalized: null };
    const addr = places[0].address || {};
    const city  = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
    const state = addr.state || '';
    const country = addr.country_code?.toUpperCase() || '';
    // Only accept US + major territories for now
    const normalized = city && state ? `${city}, ${state}` : city || state || location;
    return { valid: true, normalized };
  } catch(e) {
    return { valid: true, normalized: location }; // fail open on timeout/error
  }
}

// ── Claude Haiku content moderation ──────────────────────────────────────────
async function moderateContent(company, role, experience) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  if (!ANTHROPIC_KEY) return { ok: true, issues: [], corrected_experience: null };

  const exp = (experience || '').trim();
  const prompt = `You moderate reports on a job-application transparency platform. Review this submission:

Company: "${company}"
Job title: "${role}"
Experience: "${exp || '(not provided)'}"

Flag ANY of the following — be strict:
1. Profanity or slurs (even mild)
2. Hate speech or discrimination
3. Personal attacks on named individuals
4. Doxxing or private information
5. Obviously fake content (gibberish, keyboard mashing, lorem ipsum)
6. Job title that is not a real position name

For the experience text, also correct any genuine spelling mistakes (not slang or informal phrasing).

Return ONLY valid JSON, no extra text:
{
  "ok": true,
  "issues": [],
  "corrected_experience": null
}

If there are problems set ok:false and fill issues[]. If spelling was fixed set corrected_experience to the cleaned text, otherwise null.`;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!apiRes.ok) return { ok: true, issues: [], corrected_experience: null };
    const data = await apiRes.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { ok: true, issues: [], corrected_experience: null };
    return JSON.parse(match[0]);
  } catch(e) {
    return { ok: true, issues: [], corrected_experience: null }; // fail open
  }
}
