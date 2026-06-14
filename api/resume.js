import zlib from 'zlib';
import { promisify } from 'util';
import { createClient } from '@supabase/supabase-js';
import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { gateAI } from '../lib/server/credits.js';
const inflateRaw = promisify(zlib.inflateRaw);

export default async function handler(req, res) {
  const _o = req.headers.origin || '';
  const _devO = !_o || _o.includes('localhost') || _o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', (_devO || ['https://seenjobs.io','https://www.seenjobs.io'].includes(_o)) ? (_o || '*') : 'https://seenjobs.io');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  // ── Route: email_analysis — send resume analysis + apply link via Resend ──────
  if (body.action === 'email_analysis') {
    if (req.method !== 'POST') return res.status(405).end();
    if (await applyRateLimit(req, res, 'email-analysis')) return;
    return handleEmailAnalysis(req, res, body);
  }

  // ── Route: parse — formerly api/parse-resume.js, folded in to stay at 11 functions ──
  if (body.action === 'parse' || body.base64) {
    if (req.method !== 'POST') return res.status(405).end('Method not allowed');
    if (await applyRateLimit(req, res, 'parse-resume')) return;
    const gate = await gateAI(req, 'parse_resume');
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: gate.credits_required, balance: gate.balance ?? 0 });
    return handleParseResume(req, res, body);
  }

  // ── Route: AI tools (optimize, score, etc.) ──────────────────────────────
  const { tool } = body;
  const endpoint = tool ? `resume-${tool}` : 'resume';
  if (await applyRateLimit(req, res, endpoint)) return;

  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  // Credit gate — requires auth and 1 credit per call
  const gate = await gateAI(req, `resume_${tool || 'tool'}`);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: gate.credits_required, balance: gate.balance ?? 0 });

  try {
    if (!tool) return res.status(400).json({ error: 'Missing tool parameter' });

    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });

    let prompt, systemPrompt;

    // Validate resume text is actually readable before sending to Claude
    if (body.resume !== undefined) {
      const r = body.resume || '';
      // Count pure alphabetic words (3+ letters) — catches binary/base64 garbage
      // which has essentially no real English words, while allowing resumes heavy
      // with dates, numbers, abbreviations, and medical/technical codes.
      const wordMatches = r.match(/[A-Za-z]{3,}/g) || [];
      if (r.length > 100 && wordMatches.length < 20) {
        return res.status(400).json({ error: 'RESUME_CORRUPTED' });
      }
    }

    if (tool === 'scanner') {
      const { job, company, resume, jobDescription } = body;
      if (!resume || !jobDescription) return res.status(400).json({ error: 'Resume and job description required' });
      systemPrompt = 'You are an ATS resume scanner. Analyze resume fit for a job and return ONLY valid JSON with no markdown.';
      prompt = `Analyze this resume against the job description. Return ONLY a JSON object:
{"match_score":<0-100>,"score_summary":"<2 sentences>","missing_keywords":["..."],"strong_keywords":["..."],"specific_fixes":[{"current":"<bullet>","improved":"<rewrite>"}],"ghost_risk_note":"<1 sentence>"}

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${(jobDescription||'').slice(0,3000)}
RESUME:\n${(resume||'').slice(0,4000)}`;

    } else if (tool === 'optimize') {
      const { job, company, resume, jobDescription } = body;
      if (!resume) return res.status(400).json({ error: 'Resume required' });
      systemPrompt = 'You are a career strategist who aligns candidate experience to specific job requirements. Return ONLY valid JSON with no markdown.';
      prompt = `Tailor this resume specifically for the ${job} role at ${company}.

Step 1: Identify the 5-6 most important requirements, skills, or qualities this employer is actually hiring for.
Step 2: Find which of the candidate's real experiences best match each of those requirements.
Step 3: Rewrite 4-6 bullets to make the connection explicit — use the employer's exact language and terminology.

Rules:
- Never fabricate experience. Only rewrite based on what the candidate actually did.
- Mirror the JD's vocabulary exactly (if JD says "pipeline management" don't write "sales tracking").
- Each rewritten bullet must directly address one of the job's key requirements.
- A recruiter should read each bullet and immediately see why it's relevant to THIS role.

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${(jobDescription||'').slice(0,2500)}
RESUME:\n${(resume||'').slice(0,4000)}

Return ONLY this JSON:
{"job_priorities":["<top requirement>","<second>","<third>","<fourth>","<fifth>"],"optimized_bullets":[{"original":"<exact text from resume>","optimized":"<rewritten to address JD requirement>","addresses":"<which priority in 3-5 words>"}],"keywords_added":["<exact JD term>"]}`;

    } else if (tool === 'coach') {
      const { job, company, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return res.status(400).json({ error: 'Job, company, and job description required' });
      systemPrompt = 'You are a job application strategist. Return ONLY valid JSON.';
      prompt = `Create an application playbook. Return ONLY a JSON object:
{"hiring_manager_script":"<LinkedIn message>","timing_note":"<why apply fast>","company_intel":"<2-3 things about ${company}>","cover_letter_framework":"<3 paragraph framework>","referral_strategy":"<how to get referral>"}

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${(jobDescription||'').slice(0,2500)}${background?'\nCANDIDATE:\n'+background.slice(0,1000):''}`;

    } else if (tool === 'proposal') {
      const { job, company, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return res.status(400).json({ error: 'Job, company, and job description required' });
      systemPrompt = 'You are a career strategist. Return ONLY valid JSON.';
      prompt = `Write a 30/60/90 day plan. Return ONLY a JSON object:
{"day_30":"<30 day plan>","day_60":"<60 day plan>","day_90":"<90 day plan>","opening_note":"<1 sentence>"}

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${(jobDescription||'').slice(0,2500)}${background?'\nCANDIDATE:\n'+background.slice(0,1000):''}`;

    } else {
      return res.status(400).json({ error: 'Unknown tool: ' + tool });
    }

    const requestBody = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: tool === 'optimize' ? 2500 : 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    // Retry up to 5 times on 429 (rate limit) or 529 (overloaded) — both are transient
    let apiRes;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        const retryAfter = apiRes?.headers?.get('retry-after');
        const waitMs = retryAfter ? Math.min(parseInt(retryAfter) * 1000, 30000) : attempt * 6000;
        await new Promise(r => setTimeout(r, waitMs));
      }
      apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: requestBody,
      });
      if (apiRes.status !== 429 && apiRes.status !== 529) break;
    }

    if (!apiRes.ok) {
      if (apiRes.status === 429 || apiRes.status === 529) {
        return res.status(429).json({ error: 'The optimizer is busy right now — try again in a few seconds.' });
      }
      const errText = await apiRes.text();
      throw new Error('Claude API ' + apiRes.status + ': ' + errText.slice(0, 200));
    }

    const apiData = await apiRes.json();
    const text = (apiData.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (!objMatch) throw new Error('No JSON in response');

    let parsed;
    try { parsed = JSON.parse(objMatch[0]); }
    catch(e) { throw new Error('Invalid JSON from model'); }

    // If Claude itself returned an error object (e.g. couldn't parse the resume), surface it as 400
    if (parsed.error) {
      return res.status(400).json({ error: 'RESUME_CORRUPTED' });
    }

    return res.status(200).json(parsed);

  } catch(err) {
    console.error('Resume API error:', err.message);
    logError('resume', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Parse handler (formerly api/parse-resume.js) ─────────────────────────────
async function handleParseResume(req, res, body) {
  try {
    const { base64, fileName, mimeType } = body;
    if (!base64) return res.status(400).json({ error: 'No file data provided' });

    const fileBuffer = Buffer.from(base64, 'base64');
    if (fileBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large. Max 10MB.' });
    }

    const nameLower = (fileName || '').toLowerCase();
    const isPDF = nameLower.endsWith('.pdf') || (mimeType || '').includes('pdf');
    const isWord = nameLower.endsWith('.docx') || nameLower.endsWith('.doc') ||
                   (mimeType || '').includes('word') || (mimeType || '').includes('officedocument');

    if (!isPDF && !isWord) {
      return res.status(400).json({ error: 'Only PDF and Word documents (.pdf, .doc, .docx) are supported.' });
    }

    let extractedText = '';

    if (isPDF) {
      const b64 = fileBuffer.toString('base64');
      let apiRes;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          const wait = apiRes?.headers?.get('retry-after');
          await new Promise(r => setTimeout(r, wait ? Math.min(parseInt(wait) * 1000, 20000) : attempt * 6000));
        }
        apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 3000,
            messages: [{
              role: 'user',
              content: [
                { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
                { type: 'text', text: 'Extract ALL text from this resume. Preserve structure — job titles, companies, dates, bullets, skills, education. Output the raw text only, no commentary.' }
              ]
            }]
          })
        });
        if (apiRes.status !== 429) break;
      }
      if (!apiRes.ok) {
        const errText = await apiRes.text();
        throw new Error('PDF extraction failed: ' + apiRes.status + ' ' + errText.slice(0, 100));
      }
      const data = await apiRes.json();
      extractedText = data.content?.[0]?.text || '';

    } else if (isWord) {
      extractedText = await extractDocxText(fileBuffer);
      if (!extractedText || extractedText.length < 150) {
        const b64 = fileBuffer.toString('base64');
        let apiRes;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) {
            const wait = apiRes?.headers?.get('retry-after');
            await new Promise(r => setTimeout(r, wait ? Math.min(parseInt(wait) * 1000, 20000) : attempt * 6000));
          }
          apiRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 3000,
              messages: [{ role: 'user', content: 'Extract all text from this Word document resume (base64). Return ONLY the extracted resume text with no commentary.\n\nBase64: ' + b64.slice(0, 8000) }]
            })
          });
          if (apiRes.status !== 429) break;
        }
        if (apiRes?.ok) {
          const data = await apiRes.json();
          const result = data.content?.[0]?.text || '';
          if (result && result.length > 100) extractedText = result;
        }
      }
    }

    if (!extractedText || extractedText.length < 50) {
      return res.status(422).json({ error: 'Could not extract readable text. Make sure the file has selectable text (not a scanned image). Try exporting as PDF.' });
    }

    // Extract structured employment history — best-effort, no retry
    let employment = [];
    try {
      const empRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [{ role: 'user', content: `Extract employment history from this resume. Return ONLY a JSON array, no commentary. Each object: {"company":"","title":"","start_date":"","end_date":""}. Use "" for unknown fields. Max 15 entries. end_date="Present" if still employed there.\n\nResume:\n${extractedText.slice(0, 6000)}` }]
        })
      });
      if (empRes.ok) {
        const empData = await empRes.json();
        const empText = empData.content?.[0]?.text || '';
        const jsonMatch = empText.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          employment = parsed.slice(0, 15).filter(e => e && e.company);
        }
      }
    } catch(_) { /* best-effort */ }

    const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

    // Fire-and-forget signal extraction — runs in background, never blocks parse response
    Promise.race([
      storeCareerSignals(extractedText, employment, req),
      new Promise(r => setTimeout(r, 3000)),
    ]).catch(() => {});

    return res.status(200).json({ ok: true, text: extractedText, fileName, fileType: isPDF ? 'pdf' : 'word', wordCount, employment });

  } catch(err) {
    console.error('Parse resume error:', err.message);
    logError('parse-resume', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Email analysis handler ─────────────────────────────────────────────────────
async function handleEmailAnalysis(req, res, body) {
  try {
    const RESEND_KEY = process.env.RESEND_KEY;
    if (!RESEND_KEY) return res.status(500).json({ error: 'Email not configured' });

    const { email, co, role, jid, jobUrl, summary, matchScore } = body;
    if (!email || !co || !role) return res.status(400).json({ error: 'Missing required fields' });

    // Build the apply link — leads to the forced "did you apply?" prompt
    const applyParams = new URLSearchParams({
      co,
      role,
      ...(jid ? { jid } : {}),
      ...(jobUrl ? { jobUrl } : {}),
    });
    const applyLink = `https://seenjobs.io/apply?${applyParams.toString()}`;

    const scoreHtml = matchScore != null
      ? `<div style="font-size:32px;font-weight:bold;color:${matchScore >= 75 ? '#10b981' : matchScore >= 50 ? '#f59e0b' : '#ef4444'};margin-bottom:4px;">${matchScore}%</div><div style="font-size:13px;color:#6b7280;margin-bottom:20px;">ATS match score</div>`
      : '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#02040a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:40px 24px;">
  <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#3b82f6;margin-bottom:24px;">SEEN · Resume Optimizer</div>
  <h1 style="font-size:24px;font-weight:800;color:#ffffff;margin:0 0 8px;letter-spacing:-.02em;">Your resume analysis is ready</h1>
  <p style="font-size:14px;color:#9ca3af;margin:0 0 28px;">For <strong style="color:#fff">${role}</strong> at <strong style="color:#fff">${co}</strong></p>
  <div style="background:#0c0f1a;border:1px solid #1f2937;border-radius:12px;padding:24px;margin-bottom:28px;text-align:center;">
    ${scoreHtml}
    ${summary ? `<p style="font-size:14px;color:#d1d5db;margin:0;line-height:1.6;">${summary}</p>` : '<p style="font-size:14px;color:#6b7280;margin:0;">Open Seen to review your full analysis, keyword gaps, and line-by-line rewrites.</p>'}
  </div>
  <a href="${applyLink}" style="display:block;background:linear-gradient(135deg,rgba(16,185,129,0.2),rgba(16,185,129,0.1));border:1.5px solid rgba(16,185,129,0.5);color:#10b981;text-decoration:none;font-weight:700;font-size:15px;text-align:center;padding:16px 24px;border-radius:12px;margin-bottom:16px;letter-spacing:-.01em;">
    ✅ I applied — track my application →
  </a>
  <p style="font-size:12px;color:#374151;text-align:center;margin:0 0 24px;">Click above after you submit your application to start tracking your timeline, ghost alerts, and Day 7/14/30 check-ins.</p>
  <div style="border-top:1px solid #1f2937;padding-top:20px;font-size:11px;color:#374151;text-align:center;">
    <a href="https://seenjobs.io" style="color:#3b82f6;text-decoration:none;">seenjobs.io</a> · You're receiving this because you used Resume Optimizer on Seen.
  </div>
</div>
</body>
</html>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Seen <noreply@seenjobs.io>',
        to: [email],
        subject: `Your resume analysis for ${role} at ${co}`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error('Resend error: ' + errText.slice(0, 100));
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('email_analysis error:', err.message);
    logError('email-analysis', err.message);
    return res.status(500).json({ error: 'Failed to send email' });
  }
}

// ── Career signal extraction — builds the proprietary data moat ────────────────
// Extracts anonymized career signals from a parsed resume and stores them in
// two layers: resume_skills (per-user, private) and career_signals (anonymized).
async function storeCareerSignals(resumeText, employment, req) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_KEY) return;

  // Get user_id from JWT if available
  let userId = null;
  try {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const supaUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data } = await supaUser.auth.getUser(auth.slice(7));
      userId = data?.user?.id || null;
    }
  } catch (_) {}

  // Extract skills, seniority, function, years_exp from resume text
  let signal = null;
  try {
    const sigRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Extract career signal from this resume. Return ONLY JSON, no commentary:
{"skills":["<top 8 technical/domain skills>"],"seniority":"<junior|mid|senior|staff|principal|executive>","function":"<engineering|design|product|marketing|sales|ops|data|finance|legal|other>","years_exp":<int or null>}

Resume (first 3000 chars):\n${resumeText.slice(0, 3000)}`
        }],
      })
    });
    if (sigRes.ok) {
      const sigData = await sigRes.json();
      const txt = sigData.content?.[0]?.text || '';
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) signal = JSON.parse(m[0]);
    }
  } catch (_) {}
  if (!signal?.skills?.length) return;

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Layer 1: per-user resume_skills (private, with user_id)
  if (userId) {
    const topTitles = employment.slice(0, 3).map(e => e.title).filter(Boolean);
    await sb.from('resume_skills').upsert({
      user_id: userId,
      skills: signal.skills,
      seniority: signal.seniority,
      function: signal.function,
      years_exp: signal.years_exp,
      top_titles: topTitles,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).catch(() => {});
  }

  // Layer 2: anonymized career_signals (no user_id — pure market signal)
  const { data: signalRow } = await sb.from('career_signals').insert({
    skills: signal.skills,
    seniority: signal.seniority,
    function: signal.function,
    years_exp: signal.years_exp,
  }).select('id').single();

  // Layer 2b: career transitions (anonymized, from employment history)
  if (signalRow?.id && employment.length >= 2) {
    const transitions = [];
    for (let i = 0; i < employment.length - 1; i++) {
      const from = employment[i + 1]; // older role
      const to   = employment[i];     // newer role
      if (from.title && to.title) {
        // Estimate years in prior role (best-effort, not surfaced to user)
        let yearsInPrior = null;
        if (from.start_date && from.end_date && from.end_date !== 'Present') {
          const yr = s => parseInt(s.replace(/\D/g, '').slice(0, 4));
          const diff = yr(from.end_date) - yr(from.start_date);
          if (!isNaN(diff) && diff >= 0 && diff <= 40) yearsInPrior = diff;
        }
        transitions.push({ from_title: from.title, to_title: to.title, function: signal.function, years_in_prior_role: yearsInPrior });
      }
    }
    if (transitions.length) await sb.from('career_transitions').insert(transitions).catch(() => {});
  }
}

async function extractDocxText(buffer) {
  try {
    const xml = await readZipEntry(buffer, 'word/document.xml');
    if (!xml) return '';
    let result = '';
    const paragraphs = xml.split(/<\/w:p>/);
    for (const para of paragraphs) {
      const tMatches = para.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      const paraText = tMatches
        .map(m => m.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"'))
        .join('').trim();
      if (paraText) result += paraText + '\n';
    }
    return result.trim();
  } catch(e) { return ''; }
}

async function readZipEntry(buffer, targetName) {
  let offset = 0;
  while (offset < buffer.length - 30) {
    if (buffer[offset] !== 0x50 || buffer[offset+1] !== 0x4B || buffer[offset+2] !== 0x03 || buffer[offset+3] !== 0x04) { offset++; continue; }
    const compression  = buffer.readUInt16LE(offset + 8);
    const compressedSz = buffer.readUInt32LE(offset + 18);
    const nameLen      = buffer.readUInt16LE(offset + 26);
    const extraLen     = buffer.readUInt16LE(offset + 28);
    const entryName    = buffer.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart    = offset + 30 + nameLen + extraLen;
    if (entryName === targetName) {
      const compressed = buffer.slice(dataStart, dataStart + compressedSz);
      if (compression === 0) return compressed.toString('utf8');
      if (compression === 8) return (await inflateRaw(compressed)).toString('utf8');
      return null;
    }
    offset = dataStart + compressedSz;
    if (compressedSz === 0 && nameLen === 0) offset++;
  }
  return null;
}
