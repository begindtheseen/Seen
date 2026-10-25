import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';
import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { gateAI, resolveProAccess, resolveAuthedUser } from '../lib/server/credits.js';
import { RESUME_OPTIMIZE_COST } from '../lib/server/creditRules.js';
import { previewOnlyError } from '../lib/server/postingGate.js';
import { optimizeCacheKey, readCachedOptimize, writeCachedOptimize } from '../lib/server/optimizeCache.js';
import { buildPaidOptimize, unoptimizableListing } from '../lib/server/optimizePackage.js';
import { runAdvantage, requirementsStated, extractEmployment, extractCareerSignal, buildResumeDocument, resumeFileName } from '../lib/server/resumeAnalysis.js';
import { scannerFromSeenFit } from '../lib/server/seenfitCompat.js';
import { extractUploadText } from '../lib/server/resumeUpload.js';
import { isReadableResume } from '../lib/server/resumeReadability.js';
import { deriveResumeJobQuery, pullResumeJobFloor } from '../lib/server/resumeJobMatch.js';
import { firstPartyReportCount, isGradeable } from '../lib/server/reportCounts.js';
import { structureAction, healthAction, rewriteAction, tailorAction, atsCheckAction, exportAction, templatesAction, structureText, StudioError } from '../lib/server/resumeStudio.js';
import { renderPdf } from '../lib/resume/render/pdf.js';
import { parseResume } from '../lib/resume/parse/index.js';
import { normalizeDoc, docIsEmpty } from '../lib/resume/model.js';
import { llmAvailable } from '../lib/server/llm.js';
import { loadSkillTaxonomy } from '../lib/server/skillTaxonomy.js';
import { fitContext } from '../lib/server/fitContext.js';
import { canonicalResumeText } from '../lib/resume/canonical.js';
import { serializeToText } from '../lib/resume/model.js';
import { docFromBody } from '../lib/server/resumeStudio.js';

// One-line "Seen data" block from read-only company intel (ghost/response from our
// scores), or '' when we have no data on the company. This is the differentiator —
// only Seen knows how a company actually treats applicants.
// Grade gate (lib/server/reportCounts.js): rates/grade are only quoted when MIN_REPORTS_FOR_GRADE
// real reports back them — the client sends the gated score payload, and a below-bar company's
// null rates must never become "0% ghosted". The count quoted is first-party only (never the fused
// report_count, which includes the web-research claim).
function _intelUsable(ci) {
  return !!ci && isGradeable(ci) && ci.overall_score != null && ci.ghost_rate != null && ci.response_rate != null;
}
function _seenIntel(company, ci) {
  if (!_intelUsable(ci)) return '';
  const pct = (v) => Math.round((Number(v) || 0) * 100);
  return `SEEN DATA on ${company} (from ${firstPartyReportCount(ci)} real applicant reports): ${pct(ci.ghost_rate)}% were ghosted, ${pct(ci.response_rate)}% got a response, average wait ${Math.round(Number(ci.avg_wait_days) || 0)} days, Seen hiring grade ${Math.round(Number(ci.overall_score) || 0)}/100.`;
}

// Numeric company-intel rates for deterministic advice templates (or null).
function _intelStats(ci) {
  if (!_intelUsable(ci)) return null;
  return {
    ghost_rate: Number(ci.ghost_rate) || 0,
    response_rate: Number(ci.response_rate) || 0,
    avg_wait_days: Number(ci.avg_wait_days) || 0,
    overall_score: Number(ci.overall_score) || 0,
  };
}

// Normalize the OPTIONAL optimized-package fields that download_resume / email_analysis may
// receive. Returns null when none are present (→ behavior identical to today). Never touches
// the base résumé — these only feed the clearly-separated "Optimized for …" export section.
function _normalizeOptimizedPackage(body) {
  const strOf = (x) => (typeof x === 'string' ? x : (x && (x.optimized || x.humanized || x.text || x.original || x.warning || x.reason)) || '');
  const toList = (arr) => (Array.isArray(arr) ? arr.map(strOf).map((s) => String(s || '').trim()).filter(Boolean) : []);
  // HumanProof (humanized) bullets win over raw optimized bullets when both are present.
  const bullets = toList(Array.isArray(body.humanproofBullets) && body.humanproofBullets.length ? body.humanproofBullets : body.optimizedBullets);
  const confirmItems = toList(body.confirmWarnings);
  const message = typeof body.applicationMessage === 'string' ? body.applicationMessage.trim() : '';
  const fitScore = body.fitScore != null && !Number.isNaN(Number(body.fitScore)) ? Number(body.fitScore) : null;
  if (!bullets.length && !confirmItems.length && !message) return null;
  return {
    role: body.jobTitle || body.role || body.job || '',
    company: body.company || body.co || '',
    fitScore,
    bullets,
    confirmItems,
    message,
  };
}

// When Seen first saw the listing (jobs.created_at — the only date a listing has): the caller's
// snapshot date, else a read-only lookup by the saved job's id. null when unknown; the strategy plan
// then makes no timing claim ("Apply within the first 48 hours" was said of a 5-day-old listing).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function listingPostedAt(body) {
  const given = body && body.postedAt && Date.parse(body.postedAt);
  if (Number.isFinite(given)) return new Date(given).toISOString();
  const id = String((body && body.jobId) || '');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!UUID_RE.test(id) || !url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/jobs?id=eq.${encodeURIComponent(id)}&select=created_at&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const rows = r.ok ? await r.json() : [];
    return (Array.isArray(rows) && rows[0] && rows[0].created_at) || null;
  } catch (_) { return null; }
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
  // SECURITY: require auth and send ONLY to the signed-in user's own email. This
  // route was previously unauthenticated with a body-supplied recipient, letting
  // any anonymous caller send Seen-branded mail from noreply@seenjobs.io to any
  // address (spam / deliverability-reputation abuse). Both real callers already
  // default the recipient to the user's own email, so binding it to the token is
  // behavior-preserving for legitimate use.
  if (body.action === 'email_analysis') {
    if (req.method !== 'POST') return res.status(405).end();
    if (await applyRateLimit(req, res, 'email-analysis')) return;
    const authed = await resolveProAccess(req);
    if (!authed?.email) return res.status(401).json({ error: 'Sign in to email your package' });
    return handleEmailAnalysis(req, res, { ...body, email: authed.email }, authed.pro);
  }

  // ── Résumé Studio routes (lib/server/resumeStudio.js) ──────────────────────
  // structure / health / rewrite / ats_check / templates: deterministic, keyless, FREE (CPU only,
  // rate-limited). export: free with the "seenjobs.io" line, unbranded for Pro (same rule as
  // download_resume). tailor: 1 credit like every AI tool; its optional LLM polish is Pro-only.
  if (STUDIO_ROUTES[body.action]) return handleStudio(req, res, body);

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
  // FREE (RESUME_PARSE_COST = 0, lib/server/creditRules.js): handleParseResume is file→text
  // extraction + rule-based structuring with NO model call, so it is rate-limited only — never
  // credit-gated. Signed-out callers can parse too (the result is returned, not stored).
  if (body.action === 'parse' || body.base64) {
    if (req.method !== 'POST') return res.status(405).end('Method not allowed');
    if (await applyRateLimit(req, res, 'parse-resume')) return;
    return handleParseResume(req, res, body);
  }

  // ── Route: AI tools (optimize, score, etc.) ──────────────────────────────
  const { tool } = body;
  const endpoint = tool ? `resume-${tool}` : 'resume';
  if (await applyRateLimit(req, res, endpoint)) return;

  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  // optimize: checks, cache and probe all happen BEFORE the credit gate (handleOptimizeTool).
  if (tool === 'optimize') return handleOptimizeTool(req, res, body);

  // Nothing to build on → nothing to charge for. The scanner, the strategy plan, the coach and the
  // proposal read the posting's requirements; a posting that states none (a "join our family" ad) used
  // to cost a credit (eval harness, 2026-10-25). Decided BEFORE gateAI, the same rule Optimize follows.
  if (['advantage', 'coach', 'proposal', 'scanner'].includes(tool) && body.jobDescription && String(body.jobDescription).trim()) {
    const empty = tool === 'scanner'
      ? (body.resume ? unoptimizableListing({ resume: canonicalResumeText(body.resume), jobDescription: body.jobDescription, job: body.job, company: body.company, taxonomy: await loadSkillTaxonomy() }) : null)
      : (requirementsStated(body.jobDescription, body.job) ? null : { requirement_count: 0, message: "This listing doesn't state what it requires, so there is nothing to build a strategy on — no credit used." });
    if (empty) return res.status(422).json({ error: 'no_requirements', ...empty, cost: 0, charged: false });
  }

  // Credit gate — 1 credit per call; Pro users are never charged (consume_credit answers pro:true)
  const gate = await gateAI(req, `resume_${tool || 'tool'}`);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: gate.credits_required, balance: gate.balance ?? 0 });

  try {
    if (!tool) return res.status(400).json({ error: 'Missing tool parameter' });

    // Validate resume text is actually readable before analysing it — the CANONICAL check
    // (lib/server/resumeReadability.js), identical to the upload gate and the DB save gate,
    // so text that reaches any tool is always text every other layer would also accept.
    if (body.resume !== undefined && !isReadableResume(body.resume || '')) {
      return res.status(400).json({ error: 'RESUME_CORRUPTED' });
    }

    // ── Deterministic, keyless analysis — no LLM, no API keys, free at scale ──
    let parsed;

    if (tool === 'scanner') {
      const { job, company, resume, jobDescription } = body;
      if (!resume || !jobDescription) return res.status(400).json({ error: 'Resume and job description required' });
      const intelNote = _seenIntel(company, body.companyIntel);
      // Canonical SeenFit pipeline, adapted to the legacy scanner shape (keyless/deterministic).
      parsed = scannerFromSeenFit({ resume, jobDescription, job, company, intelNote });

    } else if (tool === 'coach') {
      const { job, company, resume, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return res.status(400).json({ error: 'Job, company, and job description required' });
      const intelNote = _seenIntel(company, body.companyIntel);
      const full = runAdvantage({ job, company, resume, jobDescription, background, intelNote, intelStats: _intelStats(body.companyIntel), postedAt: await listingPostedAt(body) });
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
      parsed = runAdvantage({ job, company, resume, jobDescription, background, intelNote, intelStats: _intelStats(body.companyIntel), postedAt: await listingPostedAt(body) });

    } else {
      return res.status(400).json({ error: 'Unknown tool: ' + tool });
    }

    // what the gate did, so the UI never prints "1 credit used" for a Pro user
    return res.status(200).json({ ...parsed, charged: !gate.pro, pro: !!gate.pro });

  } catch(err) {
    const ref = logError('resume', err, { method: req.method, tool: body?.tool, action: body?.action });
    return res.status(500).json({ error: err.message, ref });
  }
}

// ── Parse handler (formerly api/parse-resume.js) ─────────────────────────────
async function handleParseResume(req, res, body) {
  try {
    const { base64, fileName, mimeType, location } = body;
    // Keyless file→text extraction + quality gates (PDF / Word / plain-text). See resumeUpload.js.
    const extracted = await extractUploadText({ base64, fileName, mimeType });
    if (!extracted.ok) return res.status(extracted.status).json({ error: extracted.error });
    const { text: extractedText, fileType, wordCount, lines, layout, warnings } = extracted;

    // Extract structured employment history — deterministic regex/heuristics.
    let employment = [];
    try { employment = extractEmployment(extractedText); }
    catch(_) { employment = []; }

    // Résumé Studio: the structured document (+ health score + how much of the raw text it
    // covers) from the same extraction, so one upload = everything the Studio needs.
    // Best-effort: a structuring failure never fails the upload (the text path still works).
    let studio = null;
    try { studio = structureText({ text: extractedText, lines, source: fileType, fileName, layout }); }
    catch (e) { console.warn('parse: structuring failed (text path still returned):', e && e.message); }

    // Fire-and-forget: persist the résumé signal, THEN warm the corpus for the résumé's role
    // so the /jobs "Matched to your résumé" rail is already full when the user gets there. A
    // parsed résumé is the strongest job-seeking signal we get — act on it. BOTH steps are
    // best-effort and NEVER block the parse response (the analysis returns instantly below);
    // the pull is cooldown + global-budget guarded, so a flood of uploads can't stampede spend.
    Promise.race([
      storeCareerSignals(extractedText, employment, req)
        .then(signal => warmResumeJobs(signal, employment, location)),
      new Promise(r => setTimeout(r, 8000)),
    ]).catch(() => {});

    return res.status(200).json({
      ok: true, text: extractedText, fileName, fileType, wordCount, employment,
      doc: studio ? studio.doc : null, health: studio ? studio.health : null, coverage: studio ? studio.coverage : null,
      layout: layout || null, warnings: warnings || [],
    });

  } catch(err) {
    const ref = logError('parse-resume', err, { method: req.method });
    return res.status(500).json({ error: err.message, ref });
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

    // ── Optimized-for appendix (ONLY when an optimized package is supplied) ──
    // A clearly-separated section at the END of the résumé. It NEVER edits the base résumé
    // body above — SeenFit-optimized bullets, a fit summary, an application message, and
    // any "confirm before using" items are surfaced here so the user reviews and copies
    // them deliberately. Confirm items carry an explicit textual marker (no color needed).
    const opt = meta.optimized || null;
    if (opt && ((opt.bullets && opt.bullets.length) || (opt.confirmItems && opt.confirmItems.length) || opt.message)) {
      const roleLine = [opt.role, opt.company ? `at ${opt.company}` : ''].filter(Boolean).join(' ');
      sectionHeading(roleLine ? `Optimized for ${roleLine}` : 'Optimized for this role');
      if (opt.fitScore != null && !Number.isNaN(Number(opt.fitScore))) {
        drawBody(doc, `SeenFit match: ${Math.round(Number(opt.fitScore))}/100. The bullets below are tailored to this role and grounded in your résumé — review, then copy the ones that fit.`, LEFT, W, META, CONTENT_BOTTOM, newPage);
      }
      for (const b of (opt.bullets || [])) drawBullet(doc, b, LEFT, W, INK, CONTENT_BOTTOM, newPage);
      if (opt.confirmItems && opt.confirmItems.length) {
        gap(6);
        doc.fillColor(META).font('Times-Bold').fontSize(10).text('CONFIRM BEFORE USING', LEFT, doc.y, { width: W, characterSpacing: 0.5, lineBreak: false });
        doc.y += 13;
        doc.fillColor(META).font('Times-Italic').fontSize(9.5).text('These add specifics we could not verify from your résumé. Only use them if they are true — fill in the real detail first.', LEFT, doc.y, { width: W, lineGap: 1.5 });
        doc.moveDown(0.2);
        for (const c of opt.confirmItems) drawBullet(doc, `⚠ ${c}`, LEFT, W, META, CONTENT_BOTTOM, newPage);
      }
      if (opt.message && String(opt.message).trim()) {
        gap(6);
        doc.fillColor(INK).font('Times-Bold').fontSize(10).text('APPLICATION MESSAGE', LEFT, doc.y, { width: W, characterSpacing: 0.5, lineBreak: false });
        doc.y += 13;
        drawBody(doc, String(opt.message).trim(), LEFT, W, INK, CONTENT_BOTTOM, newPage);
      }
    }

    // ── Footer on every page (drawn after content, via buffered pages) ──
    // Free/anonymous exports carry the "seenjobs.io" wordmark footer; Pro users get a
    // clean, unbranded résumé. meta.pro === true suppresses the footer entirely. The
    // reserved FOOTER_BAND is kept either way, so pagination is byte-for-byte identical
    // between the two — the only difference is the presence of the footer line.
    if (!meta.pro) {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        drawFooter(doc, LEFT, W, RULE, FOOT, FOOTER_BAND);
      }
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

// ── tool:optimize — the paid optimizer (1 credit, cached 7 days) ─────────────────────────────
// Order matters, and every step before gateAI is free:
//   1. identity (no token → 401, nothing charged);
//   2. a readable résumé (a corrupted one used to be charged and THEN refused);
//   3. a real posting — a ≤520-char preview / Adzuna teaser is 422 `preview_only` (D2);
//   4. the 7-day cache per (user, job, posting text, résumé text) — a hit is returned free with
//      `cached: true` (C2);
//   5. something to optimize against — a posting whose score the free diagnosis withholds (fewer
//      than 3 requirements read) is 422 `no_requirements`, probe or not, and never charged;
//      `probe: true` stops here and reports `cached: false` + the price;
//   6. only then the credit, the package (lib/server/optimizePackage.js — a strict superset of the
//      free diagnosis, C3) and the cache write.
async function handleOptimizeTool(req, res, body) {
  try {
    const authed = await resolveAuthedUser(req);
    if (!authed?.uid) return res.status(401).json({ error: 'Sign in to use AI features', credits_required: true });
    const { job, company, jobDescription, jobId } = body;
    if (!body.resume) return res.status(400).json({ error: 'Resume required' });
    if (!isReadableResume(body.resume)) return res.status(400).json({ error: 'RESUME_CORRUPTED' });
    const preview = previewOnlyError(body);
    if (preview) return res.status(preview.status).json({ ...preview.body, charged: false });
    // The canonical text and the shared taxonomy — the same inputs the free fit check and the Studio
    // score, so the three screens print one number (lib/resume/canonical.js, skillTaxonomy.js).
    const resume = canonicalResumeText(body.resume);
    const [taxonomy, fit] = await Promise.all([loadSkillTaxonomy(), fitContext({ company, jobDescription })]);

    // The cache key carries the parser + optimizer versions (optimizeCache.js): a result built by an
    // older engine is never served (Tasha got a pre-fix "(1,800 subscribers)." summary, 2026-10-25).
    // `fresh: true` (the "Re-run" button) skips the cache.
    const key = optimizeCacheKey({ uid: authed.uid, jobId, jobDescription, resume });
    const hit = body.fresh ? null : await readCachedOptimize(authed.uid, key);
    if (hit) return res.status(200).json({ ...hit.output, cached: true, cached_at: hit.created_at, charged: false });
    // A posting with no measurable requirements has nothing to optimize against: refused free,
    // probe or not, before the credit gate (the modal said "No score" and then charged a credit).
    const unoptimizable = unoptimizableListing({ resume, jobDescription, job, company, taxonomy });
    if (unoptimizable) return res.status(422).json({ error: 'no_requirements', ...unoptimizable, cost: 0, charged: false });
    if (body.probe) return res.status(200).json({ cached: false, price: RESUME_OPTIMIZE_COST, charged: false });

    const gate = await gateAI(req, 'resume_optimize');
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: gate.credits_required, pro_required: gate.pro_required, balance: gate.balance ?? 0 });
    const result = buildPaidOptimize({ resume, jobDescription, job, company, pro: gate.pro, jobId, taxonomy, fit });
    const stored = await writeCachedOptimize(authed.uid, key, result);
    // charged is what the gate did: a Pro user is never charged (consume_credit answers pro:true)
    return res.status(200).json({ ...result, cached: false, cache_saved: stored, charged: !gate.pro, pro: !!gate.pro, balance: gate.balance });
  } catch (err) {
    const ref = logError('resume', err, { method: req.method, tool: 'optimize' });
    return res.status(500).json({ error: err.message, ref });
  }
}

// ── Résumé Studio dispatch ───────────────────────────────────────────────────
// action → rate-limit key. Credit/Pro gating is decided per action in handleStudio.
const STUDIO_ROUTES = {
  structure: 'resume-studio', health: 'resume-studio', rewrite: 'resume-studio', ats_check: 'resume-studio', templates: 'resume-studio',
  export: 'resume-export', tailor: 'resume-tailor',
};

async function handleStudio(req, res, body) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');
  if (await applyRateLimit(req, res, STUDIO_ROUTES[body.action])) return;
  try {
    switch (body.action) {
      case 'templates': return res.status(200).json(templatesAction());
      case 'structure': return res.status(200).json(structureAction(body));
      case 'health': return res.status(200).json(healthAction(body));
      case 'rewrite': return res.status(200).json(rewriteAction(body));
      case 'ats_check': return res.status(200).json(await atsCheckAction(body));
      case 'export': {
        // Effective Pro status (no credit consumed) decides branding — same rule as download_resume.
        const { pro } = await resolveProAccess(req);
        const out = await exportAction(body, { pro });
        const asciiName = out.fileName.replace(/[^\x20-\x7E]/g, '-').replace(/"/g, '');
        res.setHeader('Content-Type', out.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Seen-Template', out.template || '');
        res.setHeader('X-Seen-Pages', String(out.pages || ''));
        res.setHeader('X-Seen-Branded', pro ? '0' : '1');
        return res.status(200).send(out.buffer);
      }
      case 'tailor': {
        // a posting that is only a preview is never charged (a title-only tailor stays allowed)
        if (String(body.jobDescription || '').trim()) {
          const preview = previewOnlyError(body);
          if (preview) return res.status(preview.status).json({ ...preview.body, charged: false });
        }
        const [taxonomy, fit] = await Promise.all([loadSkillTaxonomy(), fitContext({ company: body.company, jobDescription: body.jobDescription })]);
        // A posting that states no requirements has nothing to tailor against: refused free, before
        // the credit gate (harness 2026-10-25: charged 1 and returned an unscored plan).
        if (String(body.jobDescription || '').trim()) {
          const unopt = unoptimizableListing({ resume: serializeToText(docFromBody(body)), jobDescription: body.jobDescription, job: body.jobTitle, company: body.company, taxonomy });
          if (unopt) return res.status(422).json({ error: 'no_requirements', ...unopt, cost: 0, charged: false });
        }
        const gate = await gateAI(req, 'resume_tailor');
        if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: gate.credits_required, pro_required: gate.pro_required, balance: gate.balance ?? 0 });
        const out = await tailorAction(body, { pro: !!gate.pro, allowPolish: llmAvailable(), taxonomy, fit });
        return res.status(200).json({ ...out, balance: gate.balance, pro: !!gate.pro, charged: !gate.pro });
      }
      default: return res.status(400).json({ error: `Unknown action: ${body.action}` });
    }
  } catch (err) {
    if (err instanceof StudioError) return res.status(err.status).json({ error: err.message, ...err.extra });
    const ref = logError('resume-studio', err, { method: req.method, action: body.action });
    return res.status(500).json({ error: err.message, ref });
  }
}

// Résumé PDF for the legacy export actions (download_resume / email_analysis): the structured
// renderer (lib/resume/render — links, metadata, whole-word headings) whenever the résumé parses
// into a document, else the legacy Harvard builder as the safety net. A caller that already holds
// a structured `doc` (the Studio) sends it and skips re-parsing. Returns null when there is
// nothing renderable.
async function buildExportPdf({ resume, doc: docIn, job, company, jobDescription, template, optimized, pro }) {
  let doc = docIn && typeof docIn === 'object' ? normalizeDoc(docIn) : null;
  if (!doc || docIsEmpty(doc)) { try { doc = parseResume({ text: String(resume || ''), source: 'text' }); } catch { doc = null; } }
  if (doc && !docIsEmpty(doc) && (doc.experience.length || doc.skills.length || doc.basics.summary)) {
    // The target role becomes the headline only when the candidate wrote none (never the company).
    const r = await renderPdf(doc, { template: template || 'classic', pro, appendix: optimized || null, targetLine: !doc.basics.headline && job ? String(job).slice(0, 120) : '' });
    return { buffer: r.buffer, name: doc.basics.name || '', pages: r.pages, template: r.template };
  }
  const legacy = buildResumeDocument({ resume, jobDescription, job, company });
  const hasContent = legacy.name || legacy.summary || (legacy.experience && legacy.experience.length) || (legacy.skills && legacy.skills.length) || (legacy.education && legacy.education.length);
  if (!hasContent) return null;
  return { buffer: await buildResumePDF(legacy, { role: job, company, optimized, pro }), name: legacy.name || '', pages: null, template: 'legacy' };
}

// ── Email analysis handler ─────────────────────────────────────────────────────
async function handleEmailAnalysis(req, res, body, pro = false) {
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

    // ── Generate the complete-résumé PDF attachment ──
    // Build a real, submittable résumé from the user's OWN parsed résumé text
    // (header, summary, experience, skills, education). The before/after tips
    // live in the email body below — the attachment is a clean résumé.
    let pdfBase64 = null;
    let attachName = `Seen Resume.pdf`;
    try {
      // Optional optimized-package appendix (additive) — never edits the base résumé body.
      const optimized = _normalizeOptimizedPackage(body);
      const built = await buildExportPdf({ resume, doc: body.doc, job: role, company: co, jobDescription, template: body.template, optimized, pro });
      if (built) {
        pdfBase64 = built.buffer.toString('base64');
        attachName = resumeFileName({ name: built.name, role });
      } else {
        // Honest degradation: the email still sends (best-effort), but log why the
        // résumé attachment is missing so a caller that forgot `resume`/`jobDescription`
        // in the email_analysis payload is visible instead of silently attachment-less.
        console.warn('email_analysis: no résumé content — attachment skipped (missing resume/jobDescription in payload?)');
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

    // ── Optional optimized-package block (additive) ──
    // Fit summary, humanized bullets, an application message, and clearly-marked
    // "confirm before using" items. Rendered ONLY when the caller sends the package fields.
    const _opt = _normalizeOptimizedPackage(body);
    let optimizedBlockHtml = '';
    if (_opt) {
      const roleLine = [_opt.role, _opt.company ? `at ${_opt.company}` : ''].filter(Boolean).join(' ');
      const fitHtml = _opt.fitScore != null
        ? `<div style="font-size:12px;color:#4f46e5;font-weight:700;margin-bottom:10px;">SeenFit match · ${Math.round(_opt.fitScore)}/100</div>` : '';
      const bulletsHtml = _opt.bullets.length
        ? `<ul style="margin:0 0 12px;padding-left:18px;">${_opt.bullets.map(b => `<li style="font-size:13px;color:#111827;line-height:1.6;margin-bottom:6px;">${esc(b)}</li>`).join('')}</ul>` : '';
      const msgHtml = _opt.message
        ? `<div style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#4f46e5;text-transform:uppercase;margin:6px 0;">Application message</div><div style="font-size:13px;color:#374151;line-height:1.65;margin-bottom:12px;">${esc(_opt.message)}</div>` : '';
      const confirmHtml = _opt.confirmItems.length
        ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin-top:6px;">
             <div style="font-size:11px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">⚠ Confirm before using</div>
             <div style="font-size:12px;color:#92400e;line-height:1.55;margin-bottom:8px;">These add specifics we couldn't verify from your résumé. Only use them if they're true — fill in the real detail first.</div>
             <ul style="margin:0;padding-left:18px;">${_opt.confirmItems.map(c => `<li style="font-size:12px;color:#92400e;line-height:1.55;margin-bottom:4px;">${esc(c)}</li>`).join('')}</ul>
           </div>` : '';
      optimizedBlockHtml = `
        <div style="margin-bottom:20px;padding:18px 20px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#059669;text-transform:uppercase;margin-bottom:8px;">Optimized${roleLine ? ` for ${esc(roleLine)}` : ''}</div>
          ${fitHtml}${bulletsHtml}${msgHtml}${confirmHtml}
        </div>`;
    }

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

          <!-- Optimized package (fit summary, bullets, message, confirm-before-using) -->
          ${optimizedBlockHtml}

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

    return res.status(200).json({ ok: true, attached: !!pdfBase64 });
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

    // Effective Pro status (no credit consumed) decides watermarking: anonymous/free
    // callers get the "seenjobs.io" footer; Pro users get a clean, unbranded résumé.
    const { pro } = await resolveProAccess(req);

    // Optional optimized-package appendix (additive) — never edits the base résumé body.
    const optimized = _normalizeOptimizedPackage(body);
    const built = await buildExportPdf({ resume, doc: body.doc, job, company, jobDescription, template: body.template, optimized, pro });
    if (!built) {
      return res.status(422).json({ error: 'Could not read enough structure from this résumé to build a document. Make sure it has your roles and bullet points.' });
    }
    const pdfBuf = built.buffer;
    const filename = resumeFileName({ name: built.name, role: job });

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
  // Use the same env-var names as the rest of the codebase (SUPABASE_URL /
  // SUPABASE_SERVICE_KEY). The prior NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
  // names are almost certainly unset in prod, which silently no-op'd this whole
  // function — so resume_skills never persisted and `recommended` was degraded.
  // Keep the old names as a fallback in case an env sets only those.
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;

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
  // A non-tech résumé can carry zero dictionary skills and still have real job titles — the
  // strongest signal the /jobs rail has. Persist the per-user row whenever there is ANY signal;
  // the anonymized market layers below still need skills.
  const topTitles = (Array.isArray(employment) ? employment : []).slice(0, 3).map(e => e && e.title).filter(Boolean);
  if (!signal || (!signal.skills?.length && !topTitles.length)) return null;

  // The anonymized inserts below are best-effort — never let one failing reject this function,
  // so the caller still gets `signal` back and the résumé→jobs warm can fire off it.
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Layer 1: per-user resume_skills (private, with user_id)
    if (userId) {
      await sb.from('resume_skills').upsert({
        user_id: userId,
        skills: signal.skills || [],
        seniority: signal.seniority,
        function: signal.function,
        years_exp: signal.years_exp,
        top_titles: topTitles,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }).catch(() => {});
    }

    // Layer 2: anonymized career_signals (no user_id — pure market signal); needs real skills
    if (!signal.skills?.length) return signal;
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
  } catch (_) { /* anonymized-layer write failed — still return the signal for the warm */ }

  return signal;
}

// ── Résumé → jobs warm ─────────────────────────────────────────────────────────
// A parsed résumé is the strongest job-seeking signal we get. Warm the corpus for the
// résumé's ROLE (derived from the person's real titles / function / skills) at their
// location, so the /jobs "Matched to your résumé" rail is already full when they arrive.
// Routes through the SAME live aggregation the job search uses (pullResumeJobFloor →
// cooldown + global budget + upsert) — no parallel matcher, no second uncapped pull.
// Best-effort and fully guarded; safe to fire-and-forget after the parse response is sent.
async function warmResumeJobs(signal, employment, location) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
    const top_titles = (Array.isArray(employment) ? employment : []).map(e => e && e.title).filter(Boolean);
    const query = deriveResumeJobQuery({ top_titles, function: signal?.function, skills: signal?.skills });
    if (!query) return;
    await pullResumeJobFloor({
      query,
      location: typeof location === 'string' ? location.trim().slice(0, 120) : '',
      supabaseUrl: SUPABASE_URL,
      serviceKey: SUPABASE_SERVICE_KEY,
      adzunaAppId: process.env.ADZUNA_APP_ID,
      adzunaAppKey: process.env.ADZUNA_APP_KEY,
    });
  } catch { /* best-effort warm — never affects the parse response */ }
}
