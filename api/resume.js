import zlib from 'zlib';
import { promisify } from 'util';
import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';
import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { gateAI } from '../lib/server/credits.js';
import { runScanner, runOptimize, runAdvantage, extractEmployment, extractCareerSignal } from '../lib/server/resumeAnalysis.js';
import { extractPdfText } from '../lib/server/pdfText.js';
const inflateRaw = promisify(zlib.inflateRaw);

// One-line "Seen data" block from read-only company intel (ghost/response from our
// scores), or '' when we have no data on the company. This is the differentiator —
// only Seen knows how a company actually treats applicants.
function _seenIntel(company, ci) {
  if (!ci || !ci.report_count) return '';
  const pct = (v) => Math.round((Number(v) || 0) * 100);
  return `SEEN DATA on ${company} (from ${ci.report_count} real applicant reports): ${pct(ci.ghost_rate)}% were ghosted, ${pct(ci.response_rate)}% got a response, average wait ${Math.round(Number(ci.avg_wait_days) || 0)} days, Seen hiring grade ${Math.round(Number(ci.overall_score) || 0)}/100.`;
}

// Numeric company-intel rates for deterministic advice templates (or null).
function _intelStats(ci) {
  if (!ci || !ci.report_count) return null;
  return {
    ghost_rate: Number(ci.ghost_rate) || 0,
    response_rate: Number(ci.response_rate) || 0,
    avg_wait_days: Number(ci.avg_wait_days) || 0,
    overall_score: Number(ci.overall_score) || 0,
  };
}

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

  // Credit gate — 1 credit per call; Pro users get Stealth Mode baked into optimize at no extra cost
  const gate = await gateAI(req, `resume_${tool || 'tool'}`);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: gate.credits_required, balance: gate.balance ?? 0 });

  try {
    if (!tool) return res.status(400).json({ error: 'Missing tool parameter' });

    // Validate resume text is actually readable before analysing it.
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

    // ── Deterministic, keyless analysis — no LLM, no API keys, free at scale ──
    let parsed;

    if (tool === 'scanner') {
      const { job, company, resume, jobDescription } = body;
      if (!resume || !jobDescription) return res.status(400).json({ error: 'Resume and job description required' });
      const intelNote = _seenIntel(company, body.companyIntel);
      parsed = runScanner({ resume, jobDescription, job, company, intelNote });

    } else if (tool === 'optimize') {
      const { job, company, resume, jobDescription } = body;
      if (!resume) return res.status(400).json({ error: 'Resume required' });
      // Pro users get Stealth Mode baked in — same call, no extra credit or cost.
      parsed = runOptimize({ resume, jobDescription, job, company, pro: gate.pro });

    } else if (tool === 'coach') {
      const { job, company, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return res.status(400).json({ error: 'Job, company, and job description required' });
      const intelNote = _seenIntel(company, body.companyIntel);
      const full = runAdvantage({ job, company, jobDescription, background, intelNote, intelStats: _intelStats(body.companyIntel) });
      // 'coach' historically returns only the playbook keys.
      parsed = {
        hiring_manager_script: full.hiring_manager_script,
        timing_note: full.timing_note,
        company_intel: full.company_intel,
        cover_letter_framework: full.cover_letter_framework,
        referral_strategy: full.referral_strategy,
      };

    } else if (tool === 'proposal') {
      const { job, company, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return res.status(400).json({ error: 'Job, company, and job description required' });
      const full = runAdvantage({ job, company, jobDescription, background });
      // 'proposal' historically returns only the 30/60/90 plan keys.
      parsed = {
        opening_note: full.opening_note,
        day_30: full.day_30,
        day_60: full.day_60,
        day_90: full.day_90,
      };

    } else if (tool === 'advantage') {
      // Combined application-advantage tool: the outreach/positioning playbook AND the
      // 30/60/90-day plan in one call (one credit). Merges the old 'coach' + 'proposal'.
      const { job, company, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return res.status(400).json({ error: 'Job, company, and job description required' });
      const intelNote = _seenIntel(company, body.companyIntel);
      parsed = runAdvantage({ job, company, jobDescription, background, intelNote, intelStats: _intelStats(body.companyIntel) });

    } else {
      return res.status(400).json({ error: 'Unknown tool: ' + tool });
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
    if (typeof base64 !== 'string' || base64.length > 14_000_000) {
      return res.status(400).json({ error: 'File too large. Max 10MB.' });
    }

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
      // Keyless, native best-effort PDF text extraction — inflates content
      // streams and pulls text-showing operators. Works for résumés with real
      // selectable text (Word/Docs/Pages exports). Scanned-image PDFs return
      // nothing here, and we fall through to a clean "paste your text" error.
      extractedText = await extractPdfText(fileBuffer);

    } else if (isWord) {
      extractedText = await extractDocxText(fileBuffer);
    }

    if (!extractedText || extractedText.length < 50) {
      return res.status(422).json({
        error: isPDF
          ? 'Could not read selectable text from this PDF (it may be a scanned image, or use an unusual font encoding). Please copy your résumé text and paste it directly into the box instead.'
          : 'Could not extract readable text. Make sure the file has selectable text (not a scanned image), or paste your résumé text directly.'
      });
    }

    // Extract structured employment history — deterministic regex/heuristics.
    let employment = [];
    try { employment = extractEmployment(extractedText); }
    catch(_) { employment = []; }

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

// ── PDF generation helper ──────────────────────────────────────────────────────
function buildResumePDF({ role, co, bullets, keywords, date }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 56, bottom: 56, left: 64, right: 64 } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 128; // usable width
    const INDIGO = '#4f46e5';
    const DARK   = '#111827';
    const GRAY   = '#6b7280';
    const LGRAY  = '#9ca3af';
    const LINE   = '#e5e7eb';
    const GREEN  = '#059669';

    // ── Header ──
    doc.rect(0, 0, doc.page.width, 80).fill('#f9fafb');
    doc.fontSize(9).fillColor(INDIGO).font('Helvetica-Bold')
       .text('SEEN · RESUME OPTIMIZER', 64, 26, { characterSpacing: 1.5 });
    doc.fontSize(18).fillColor(DARK).font('Helvetica-Bold')
       .text('Optimized Resume', 64, 40);
    doc.moveDown(0.2);

    doc.rect(0, 80, doc.page.width, 1).fill(LINE);
    doc.moveDown(1);

    // ── Subheader: role + company ──
    doc.y = 96;
    doc.fontSize(11).fillColor(DARK).font('Helvetica-Bold')
       .text(`${role}`, 64, doc.y);
    doc.fontSize(11).fillColor(GRAY).font('Helvetica')
       .text(`at ${co}`, { continued: false });
    doc.fontSize(8).fillColor(LGRAY)
       .text(`Generated ${date} · seenjobs.io`, 64, doc.y + 2);
    doc.moveDown(1.4);

    // ── Keywords added ──
    if (keywords && keywords.length > 0) {
      doc.rect(64, doc.y, W, 1).fill(LINE);
      doc.moveDown(0.6);
      doc.fontSize(7).fillColor(INDIGO).font('Helvetica-Bold')
         .text('KEYWORDS ADDED', 64, doc.y, { characterSpacing: 1 });
      doc.moveDown(0.35);
      doc.fontSize(9).fillColor(DARK).font('Helvetica')
         .text(keywords.join('  ·  '), 64, doc.y, { width: W });
      doc.moveDown(1.2);
    }

    // ── Bullets ──
    if (bullets && bullets.length > 0) {
      doc.rect(64, doc.y, W, 1).fill(LINE);
      doc.moveDown(0.6);
      doc.fontSize(7).fillColor(INDIGO).font('Helvetica-Bold')
         .text(`OPTIMIZED BULLETS  (${bullets.length})`, 64, doc.y, { characterSpacing: 1 });
      doc.moveDown(0.5);

      for (const b of bullets) {
        const startY = doc.y;
        // Left accent bar
        const BAR_X = 64;
        const TEXT_X = 76;
        const textW = W - 12;

        // BEFORE label + text
        doc.fontSize(6.5).fillColor(LGRAY).font('Helvetica-Bold')
           .text('BEFORE', TEXT_X, doc.y, { characterSpacing: 0.8 });
        doc.moveDown(0.25);
        doc.fontSize(9).fillColor(GRAY).font('Helvetica')
           .text(b.original, TEXT_X, doc.y, { width: textW });
        doc.moveDown(0.5);

        // AFTER label + text
        doc.fontSize(6.5).fillColor(GREEN).font('Helvetica-Bold')
           .text(`AFTER  ·  ${b.addresses || ''}`, TEXT_X, doc.y, { characterSpacing: 0.8 });
        doc.moveDown(0.25);
        doc.fontSize(9).fillColor(DARK).font('Helvetica-Bold')
           .text(b.optimized, TEXT_X, doc.y, { width: textW });

        const endY = doc.y;
        // Draw accent bar on the left
        doc.rect(BAR_X, startY - 2, 2, endY - startY + 10).fill(INDIGO);

        doc.moveDown(1.1);
      }
    }

    // ── Footer ──
    const footY = doc.page.height - 48;
    doc.rect(0, footY - 1, doc.page.width, 1).fill(LINE);
    doc.fontSize(7.5).fillColor(LGRAY).font('Helvetica')
       .text(
         'Generated by Seen · seenjobs.io · Copy these bullets into your resume before applying.',
         64, footY + 8, { width: W, align: 'center' }
       );

    doc.end();
  });
}

// ── Email analysis handler ─────────────────────────────────────────────────────
async function handleEmailAnalysis(req, res, body) {
  try {
    const RESEND_KEY = process.env.RESEND_KEY;
    if (!RESEND_KEY) return res.status(500).json({ error: 'Email not configured' });

    const { email, co, role, jid, jobUrl, bullets = [], keywords = [] } = body;
    if (!email || !co || !role) return res.status(400).json({ error: 'Missing required fields' });

    // Build the apply link — leads to the forced "did you apply?" prompt
    const applyParams = new URLSearchParams({
      co, role,
      ...(jid ? { jid } : {}),
      ...(jobUrl ? { jobUrl } : {}),
    });
    const applyLink = `https://seenjobs.io/apply?${applyParams.toString()}`;

    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // ── Generate PDF attachment ──
    let pdfBase64 = null;
    try {
      const pdfBuf = await buildResumePDF({ role, co, bullets, keywords, date });
      pdfBase64 = pdfBuf.toString('base64');
    } catch (pdfErr) {
      console.error('PDF generation error:', pdfErr.message);
      // PDF is best-effort — continue without it
    }

    // ── Bullet rows for email body ──
    const bulletRowsHtml = bullets.map(b => `
      <div style="margin-bottom:20px;padding:18px 20px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#9ca3af;text-transform:uppercase;margin-bottom:6px;">Before</div>
        <div style="font-size:13px;color:#6b7280;line-height:1.6;margin-bottom:12px;">${b.original || ''}</div>
        <div style="height:1px;background:#e5e7eb;margin-bottom:12px;"></div>
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#059669;text-transform:uppercase;margin-bottom:6px;">After · <span style="font-weight:500;">${b.addresses || ''}</span></div>
        <div style="font-size:13px;color:#111827;line-height:1.6;font-weight:600;">${b.optimized || ''}</div>
      </div>
    `).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

        <!-- Header -->
        <tr><td style="background:#4f46e5;border-radius:12px 12px 0 0;padding:32px 36px 28px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:.18em;color:rgba(255,255,255,.55);text-transform:uppercase;margin-bottom:12px;">Seen</div>
          <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-.03em;line-height:1.15;margin-bottom:8px;">Your optimized resume<br>is attached.</div>
          <div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:4px;">${role} · ${co}</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#fff;padding:32px 36px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">

          <p style="font-size:14px;color:#374151;margin:0 0 8px;line-height:1.7;font-weight:500;">
            Open the PDF attached to this email.
          </p>
          <p style="font-size:13px;color:#6b7280;margin:0 0 28px;line-height:1.7;">
            Copy the rewritten bullets into your resume before you submit your application.
            The PDF has your before/after rewrites and every keyword that was added.
          </p>

          <!-- Earn-credit nudge -->
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
            <div style="font-size:13px;font-weight:700;color:#15803d;margin-bottom:4px;">Earn 1 AI credit back</div>
            <div style="font-size:12px;color:#166534;line-height:1.6;">
              Track your application below after you apply and we'll credit you back 1 AI credit — no strings.
            </div>
          </div>

          <!-- CTA -->
          <div style="text-align:center;margin-bottom:12px;">
            <a href="${applyLink}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:15px 36px;border-radius:9px;letter-spacing:-.01em;">
              I Applied — Track It →
            </a>
          </div>
          <p style="font-size:11px;color:#9ca3af;text-align:center;margin:0;line-height:1.6;">
            Tracks your timeline, ghost alerts, and Day 7 / 14 / 30 check-ins.
          </p>

        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:16px 36px;text-align:center;">
          <p style="font-size:11px;color:#9ca3af;margin:0;line-height:1.6;">
            <a href="https://seenjobs.io" style="color:#4f46e5;text-decoration:none;font-weight:600;">seenjobs.io</a>
            &nbsp;·&nbsp; Sent because you used Resume Optimizer.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const payload = {
      from: 'Seen <noreply@seenjobs.io>',
      to: [email],
      subject: `Your optimized resume for ${role} at ${co}`,
      html,
    };

    if (pdfBase64) {
      payload.attachments = [{
        filename: `seen-resume-${co.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${role.toLowerCase().replace(/[^a-z0-9]/g, '-')}.pdf`,
        content: pdfBase64,
      }];
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;

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

  // Extract skills, seniority, function, years_exp — deterministic, keyless.
  let signal = null;
  try { signal = extractCareerSignal(resumeText, employment); }
  catch (_) { signal = null; }
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
