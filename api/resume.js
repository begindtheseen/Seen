import zlib from 'zlib';
import { promisify } from 'util';
import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';
import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { gateAI } from '../lib/server/credits.js';
import { runScanner, runOptimize, runAdvantage, extractEmployment, extractCareerSignal, buildResumeDocument, resumeFileName } from '../lib/server/resumeAnalysis.js';
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

  // ── Route: download_resume — return a complete, submittable résumé PDF ────────
  // Built deterministically from the user's OWN parsed résumé text (header,
  // summary, experience, skills, education). No credit gate — it only reformats
  // the user's existing résumé, it doesn't run an AI tool.
  if (body.action === 'download_resume') {
    if (req.method !== 'POST') return res.status(405).end('Method not allowed');
    if (await applyRateLimit(req, res, 'download-resume')) return;
    return handleDownloadResume(req, res, body);
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
      const { job, company, resume, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return res.status(400).json({ error: 'Job, company, and job description required' });
      const intelNote = _seenIntel(company, body.companyIntel);
      const full = runAdvantage({ job, company, resume, jobDescription, background, intelNote, intelStats: _intelStats(body.companyIntel) });
      // 'coach' historically returns only the playbook keys.
      parsed = {
        hiring_manager_script: full.hiring_manager_script,
        timing_note: full.timing_note,
        company_intel: full.company_intel,
        cover_letter_framework: full.cover_letter_framework,
        referral_strategy: full.referral_strategy,
      };

    } else if (tool === 'proposal') {
      const { job, company, resume, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return res.status(400).json({ error: 'Job, company, and job description required' });
      const full = runAdvantage({ job, company, resume, jobDescription, background });
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
      const { job, company, resume, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return res.status(400).json({ error: 'Job, company, and job description required' });
      const intelNote = _seenIntel(company, body.companyIntel);
      parsed = runAdvantage({ job, company, resume, jobDescription, background, intelNote, intelStats: _intelStats(body.companyIntel) });

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

// ── Résumé PDF generation ────────────────────────────────────────────────────
// Renders a COMPLETE, submittable, recruiter-grade résumé from a structured
// document produced by buildResumeDocument(). Classic black serif "Harvard"
// template: a centred Times-Bold name, a contact line beneath, bold/uppercase
// section headers each underlined by a full-width hairline rule, and Harvard
// entry blocks (organization bold left + location right; position italic left +
// dates italic right; then black round bullets with a hanging indent).
//
// Pagination is fully EXPLICIT and CONTINUOUS — PDFKit auto-pagination is
// disabled and every unit (heading, entry line, bullet) is measured and a new
// page is started ONLY when the very next line would overflow the printable
// area. Content flows page→page with no blank gaps and no orphaned bullets.
//
// Every section is omitted when its data is empty — the renderer never
// fabricates content. ATS-parseable: real selectable text, standard sections,
// no text baked into images. `meta` may carry the target role/company for a
// subtle context line; it is omitted when blank.
export function buildResumePDF(document, meta = {}) {
  const d = document || {};
  const MARGIN = 58;
  const FOOTER_BAND = 40;          // reserved band at page bottom for the footer
  return new Promise((resolve, reject) => {
    // bufferPages lets us draw footers on every page AFTER content is laid out.
    // We set a tiny bottom margin and drive ALL pagination ourselves so PDFKit
    // never auto-breaks mid-bullet (the old cause of blank pages + stray "•").
    const doc = new PDFDocument({ size: 'LETTER', bufferPages: true, margins: { top: MARGIN, bottom: 2, left: MARGIN, right: MARGIN } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const LEFT = MARGIN;
    const RIGHT = doc.page.width - MARGIN;
    const W = doc.page.width - MARGIN * 2;            // usable width
    const TOP = MARGIN;
    // Last y a line of content may occupy before we must start a new page.
    const CONTENT_BOTTOM = doc.page.height - FOOTER_BAND - 14;

    // Conservative, professional palette: black ink everywhere, with one dark
    // gray reserved for secondary meta (dates, location). No color accents.
    const INK  = '#000000'; // primary text — pure black
    const META = '#444444'; // dark gray — dates / location only
    const RULE = '#999999'; // thin gray hairline under section headers
    const FOOT = '#666666'; // muted gray footer

    // ── Pagination primitives ────────────────────────────────────────────────
    // Start a fresh page and reset the cursor to the top margin.
    function newPage() {
      doc.addPage();
      doc.x = LEFT;
      doc.y = TOP;
    }
    // Ensure `need` vertical points are available below the current cursor; if
    // not, move to a new page. Returns nothing — callers draw right after.
    function ensure(need) {
      if (doc.y + need > CONTENT_BOTTOM) newPage();
    }
    // Add vertical space without ever overflowing into the footer band.
    function gap(pts) {
      doc.y = Math.min(doc.y + pts, CONTENT_BOTTOM);
    }

    // ── Section heading: BOLD UPPERCASE label + full-width hairline rule ──────
    // Keeps the heading attached to whatever follows by reserving room for the
    // heading line, its rule, and at least one following line before breaking.
    function sectionHeading(text, followNeed = 26) {
      gap(14);
      ensure(18 + followNeed);
      doc.fillColor(INK).font('Times-Bold').fontSize(11.5)
         .text(text.toUpperCase(), LEFT, doc.y, { width: W, characterSpacing: 1.2, lineBreak: false });
      doc.moveDown(0.18);
      const ruleY = doc.y;
      doc.save().lineWidth(0.9).strokeColor(RULE)
         .moveTo(LEFT, ruleY).lineTo(RIGHT, ruleY).stroke().restore();
      doc.y = ruleY + 7;
    }

    // ── Header: centred Times-Bold name + contact line ───────────────────────
    const c = d.contact || {};
    const contactBits = [c.phone, c.email, c.location, c.linkedin].filter(Boolean);
    if (d.name) {
      doc.fillColor(INK).font('Times-Bold').fontSize(20)
         .text(d.name, LEFT, doc.y, { width: W, align: 'center', characterSpacing: 0.5 });
      doc.moveDown(0.22);
    }
    // Subtle target-role context line (only when we know it) — not fabricated.
    const targetLine = [meta.role, meta.company].filter(Boolean).join('   ·   ');
    if (targetLine) {
      doc.fillColor(META).font('Times-Italic').fontSize(10.5)
         .text(targetLine, LEFT, doc.y, { width: W, align: 'center' });
      doc.moveDown(0.22);
    }
    if (contactBits.length) {
      doc.fillColor(INK).font('Times-Roman').fontSize(10)
         .text(contactBits.join('   ·   '), LEFT, doc.y, { width: W, align: 'center' });
      doc.moveDown(0.4);
    }
    if (d.name || contactBits.length || targetLine) {
      const ruleY = doc.y;
      doc.save().lineWidth(1.1).strokeColor(INK)
         .moveTo(LEFT, ruleY).lineTo(RIGHT, ruleY).stroke().restore();
      doc.y = ruleY + 2;
    }

    // ── Professional summary ──
    if (d.summary && d.summary.trim()) {
      sectionHeading('Summary');
      drawBody(doc, d.summary.trim(), LEFT, W, INK, CONTENT_BOTTOM, newPage);
    }

    // ── Experience ──
    const experience = Array.isArray(d.experience) ? d.experience.filter(e => e.title || e.company) : [];
    if (experience.length) {
      sectionHeading('Experience');
      for (let r = 0; r < experience.length; r++) {
        const e = experience[r];
        if (r > 0) gap(9);

        const org = (e.company || '').trim();
        const loc = (e.location || '').trim();
        const title = (e.title || '').trim();
        const dateText = (e.dates || '').trim();

        // Line 1: Organization (bold, left) + Location (gray, right).
        // We keep the org line with the title line and the first bullet so a
        // role header never lands alone at the foot of a page.
        const bullets = Array.isArray(e.bullets)
          ? e.bullets.map(b => String(b || '').trim()).filter(b => b && /[a-z0-9]/i.test(b))
          : [];
        const firstBulletH = bullets.length
          ? bulletHeight(doc, bullets[0], W) : 0;
        ensure(15 + (title ? 14 : 0) + firstBulletH);

        if (org) {
          const y = doc.y;
          doc.fillColor(INK).font('Times-Bold').fontSize(11)
             .text(org, LEFT, y, { width: loc ? W - 150 : W, lineBreak: false, ellipsis: true });
          if (loc) {
            doc.fillColor(META).font('Times-Italic').fontSize(10)
               .text(loc, LEFT, y, { width: W, align: 'right', lineBreak: false });
          }
          doc.y = y + 13.5;
        }

        // Line 2: Position title (italic, left) + Dates (gray italic, right).
        if (title || dateText) {
          const y = doc.y;
          if (title) {
            doc.fillColor(INK).font('Times-Italic').fontSize(10.5)
               .text(title, LEFT, y, { width: dateText ? W - 150 : W, lineBreak: false, ellipsis: true });
          }
          if (dateText) {
            doc.fillColor(META).font('Times-Italic').fontSize(10)
               .text(dateText, LEFT, y, { width: W, align: 'right', lineBreak: false });
          }
          doc.y = y + 13;
        }

        gap(1.5);
        for (const b of bullets) drawBullet(doc, b, LEFT, W, INK, CONTENT_BOTTOM, newPage);
      }
    }

    // ── Education ──
    const education = Array.isArray(d.education)
      ? d.education.map(s => String(s || '').trim()).filter(s => s && /[a-z0-9]/i.test(s)) : [];
    if (education.length) {
      sectionHeading('Education');
      for (const ed of education) drawBullet(doc, ed, LEFT, W, INK, CONTENT_BOTTOM, newPage);
    }

    // ── Skills ──
    const skills = Array.isArray(d.skills)
      ? d.skills.map(s => String(s || '').trim()).filter(Boolean) : [];
    if (skills.length) {
      sectionHeading('Skills');
      drawBody(doc, skills.join('   ·   '), LEFT, W, INK, CONTENT_BOTTOM, newPage);
    }

    // ── Footer on every page (drawn after content, via buffered pages) ──
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, LEFT, W, RULE, FOOT, FOOTER_BAND);
    }
    doc.flushPages();

    doc.end();
  });
}

// Measure how tall a single hanging-indent bullet will be at width W.
function bulletHeight(doc, text, W) {
  const INDENT = 14;
  const h = doc.font('Times-Roman').fontSize(10.5)
    .heightOfString(String(text || ''), { width: W - INDENT, lineGap: 2 });
  return h + 4; // + inter-bullet spacing
}

// Draw a single hanging-indent bullet with a small black round marker. Measures
// the bullet first and starts a new page when it would overflow the printable
// area, so the marker and its text are ALWAYS drawn together on the same page —
// never an orphaned "•" at the bottom of one page and text on the next.
function drawBullet(doc, text, LEFT, W, INK, CONTENT_BOTTOM, newPage) {
  const t = String(text || '').trim();
  if (!t || !/[a-z0-9]/i.test(t)) return; // never draw an empty bullet
  const INDENT = 14;
  const h = doc.font('Times-Roman').fontSize(10.5)
    .heightOfString(t, { width: W - INDENT, lineGap: 2 });
  if (doc.y + h > CONTENT_BOTTOM) newPage();
  const y = doc.y;
  doc.fillColor(INK).font('Times-Roman').fontSize(10.5)
     .text('•', LEFT + 2, y, { width: INDENT, lineBreak: false });
  doc.fillColor(INK).font('Times-Roman').fontSize(10.5)
     .text(t, LEFT + INDENT, y, { width: W - INDENT, lineGap: 2, align: 'left' });
  doc.y = y + h + 4;
}

// Draw a flowing body paragraph (summary / skills line) with continuous
// pagination. If the whole block fits, draw it; otherwise split it line-by-line
// so it flows across the page boundary without leaving a blank gap.
function drawBody(doc, text, LEFT, W, INK, CONTENT_BOTTOM, newPage) {
  const t = String(text || '').trim();
  if (!t) return;
  doc.font('Times-Roman').fontSize(10.5);
  const full = doc.heightOfString(t, { width: W, lineGap: 2.5, align: 'left' });
  if (doc.y + full <= CONTENT_BOTTOM) {
    doc.fillColor(INK).text(t, LEFT, doc.y, { width: W, lineGap: 2.5, align: 'left' });
    doc.y += 0; // text() already advanced doc.y
    return;
  }
  // Doesn't fit as one block — flow word by word, breaking pages as needed.
  const words = t.split(/\s+/);
  let line = '';
  const lineH = doc.heightOfString('Mg', { width: W }) + 2.5;
  const flush = () => {
    if (!line) return;
    if (doc.y + lineH > CONTENT_BOTTOM) newPage();
    doc.fillColor(INK).text(line, LEFT, doc.y, { width: W, lineBreak: false });
    doc.y += lineH;
    line = '';
  };
  for (const word of words) {
    const trial = line ? line + ' ' + word : word;
    if (doc.widthOfString(trial) > W && line) { flush(); line = word; }
    else line = trial;
  }
  flush();
}

// Draw the tasteful Seen footer at the bottom of the current page, inside the
// reserved footer band so it never collides with content.
function drawFooter(doc, LEFT, W, RULE, FOOT, footerBand) {
  const footY = doc.page.height - footerBand;
  doc.save().lineWidth(0.8).strokeColor(RULE)
     .moveTo(LEFT, footY).lineTo(LEFT + W, footY).stroke().restore();
  doc.fillColor(FOOT).font('Times-Roman').fontSize(8.5)
     .text('Optimized with Seen  ·  seenjobs.io', LEFT, footY + 9, { width: W, align: 'center', characterSpacing: 0.3, lineBreak: false });
}

// ── Email analysis handler ─────────────────────────────────────────────────────
async function handleEmailAnalysis(req, res, body) {
  try {
    const RESEND_KEY = process.env.RESEND_KEY;
    if (!RESEND_KEY) return res.status(500).json({ error: 'Email not configured' });

    const { email, co, role, jid, jobUrl, bullets = [], keywords = [], ghostNote = '', resume = '', jobDescription = '' } = body;
    if (!email || !co || !role) return res.status(400).json({ error: 'Missing required fields' });

    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // Build the apply link — leads to the forced "did you apply?" prompt
    const applyParams = new URLSearchParams({
      co, role,
      ...(jid ? { jid } : {}),
      ...(jobUrl ? { jobUrl } : {}),
    });
    const applyLink = `https://seenjobs.io/apply?${applyParams.toString()}`;

    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // ── Generate the complete-résumé PDF attachment ──
    // Build a real, submittable résumé from the user's OWN parsed résumé text
    // (header, summary, experience, skills, education). The before/after tips
    // live in the email body below — the attachment is a clean résumé.
    let pdfBase64 = null;
    let attachName = `Seen Resume.pdf`;
    try {
      const resumeDoc = buildResumeDocument({ resume, jobDescription, job: role, company: co });
      // Only attach a real document when we have actual content to render.
      const hasContent = resumeDoc.name || resumeDoc.summary ||
        (resumeDoc.experience && resumeDoc.experience.length) ||
        (resumeDoc.skills && resumeDoc.skills.length) ||
        (resumeDoc.education && resumeDoc.education.length);
      if (hasContent) {
        const pdfBuf = await buildResumePDF(resumeDoc, { role, company: co });
        pdfBase64 = pdfBuf.toString('base64');
        attachName = resumeFileName({ name: resumeDoc.name, role });
      }
    } catch (pdfErr) {
      console.error('PDF generation error:', pdfErr.message);
      // PDF is best-effort — continue without it
    }

    // ── Bullet rows for email body ──
    const bulletRowsHtml = (Array.isArray(bullets) ? bullets : []).map(b => `
      <div style="margin-bottom:20px;padding:18px 20px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#9ca3af;text-transform:uppercase;margin-bottom:6px;">Before</div>
        <div style="font-size:13px;color:#6b7280;line-height:1.6;margin-bottom:12px;">${esc(b.original)}</div>
        <div style="height:1px;background:#e5e7eb;margin-bottom:12px;"></div>
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#059669;text-transform:uppercase;margin-bottom:6px;">After · <span style="font-weight:500;">${esc(b.addresses)}</span></div>
        <div style="font-size:13px;color:#111827;line-height:1.6;font-weight:600;">${esc(b.optimized)}</div>
        ${b.note ? `<div style="font-size:12px;color:#6b7280;line-height:1.55;margin-top:8px;font-style:italic;">💡 ${esc(b.note)}</div>` : ''}
      </div>
    `).join('');

    // Fallback body when there are no bullet rewrites — never email a blank doc.
    const keywordList = (Array.isArray(keywords) ? keywords : []).filter(Boolean);
    const guidanceHtml = `
      <div style="margin-bottom:20px;padding:18px 20px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#4f46e5;text-transform:uppercase;margin-bottom:8px;">How to strengthen your resume</div>
        ${keywordList.length ? `<div style="font-size:13px;color:#374151;line-height:1.6;margin-bottom:10px;">Work these keywords in where they reflect real experience: <strong>${keywordList.map(esc).join(', ')}</strong>.</div>` : ''}
        <div style="font-size:13px;color:#374151;line-height:1.6;">Lead each bullet with a strong action verb (Led, Built, Drove, Delivered) and attach a number — a %, $, count, or timeframe — so every accomplishment is measurable.</div>
        ${ghostNote ? `<div style="font-size:12px;color:#6b7280;line-height:1.55;margin-top:10px;font-style:italic;">${esc(ghostNote)}</div>` : ''}
      </div>`;
    const bodyRowsHtml = bulletRowsHtml || guidanceHtml;

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
          <div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:4px;">${esc(role)} · ${esc(co)}</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#fff;padding:32px 36px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">

          <p style="font-size:14px;color:#374151;margin:0 0 8px;line-height:1.7;font-weight:500;">
            Open the PDF attached to this email.
          </p>
          <p style="font-size:13px;color:#6b7280;margin:0 0 24px;line-height:1.7;">
            Copy the rewritten bullets into your resume before you submit your application.
            The PDF has your before/after rewrites and every keyword that was added.
          </p>

          <!-- Before/after rewrites (or guidance when there are none) -->
          ${bodyRowsHtml}

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
        filename: attachName,
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

// ── Download complete résumé handler ─────────────────────────────────────────
// Streams a finished, submittable résumé PDF built from the user's OWN résumé
// text. Sets a clean, professional Content-Disposition filename. Deterministic,
// keyless — no AI, no credit gate (it reformats the user's existing résumé).
async function handleDownloadResume(req, res, body) {
  try {
    const { resume = '', job = '', company = '', jobDescription = '' } = body;
    if (!resume || String(resume).trim().length < 30) {
      return res.status(400).json({ error: 'Add your résumé first.' });
    }

    const resumeDoc = buildResumeDocument({ resume, jobDescription, job, company });
    const hasContent = resumeDoc.name || resumeDoc.summary ||
      (resumeDoc.experience && resumeDoc.experience.length) ||
      (resumeDoc.skills && resumeDoc.skills.length) ||
      (resumeDoc.education && resumeDoc.education.length);
    if (!hasContent) {
      return res.status(422).json({ error: 'Could not read enough structure from this résumé to build a document. Make sure it has your roles and bullet points.' });
    }

    const pdfBuf = await buildResumePDF(resumeDoc, { role: job, company });
    const filename = resumeFileName({ name: resumeDoc.name, role: job });

    // RFC 5987 — a plain ASCII fallback plus a UTF-8 encoded name so the em-dash
    // survives. asciiName strips non-ASCII for the fallback token.
    const asciiName = filename.replace(/[^\x20-\x7E]/g, '-').replace(/"/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(pdfBuf);
  } catch (err) {
    console.error('download_resume error:', err.message);
    logError('download-resume', err.message);
    return res.status(500).json({ error: 'Failed to build résumé PDF.' });
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
