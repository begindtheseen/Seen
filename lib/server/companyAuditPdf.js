// Company Score Audit & Methodology Report — legal-ready PDF renderer.
//
// Renders the company_audit_bundle (see api/_utils/companyAuditBundle.js) into a professional,
// legal-protection PDF packet. This is a METHODOLOGY + EVIDENCE DISCLOSURE document, not a
// marketing export and not a legal finding.
//
// Hard rules baked into this renderer:
//   • pdfkit only (built-in Helvetica/Times fonts — no font files, no browser, no network).
//   • No external AI. Nothing here calls Anthropic/OpenAI or any LLM.
//   • Privacy: submitter pseudonym tokens, user ids, emails, IPs, payment/account identifiers
//     and server secrets are NEVER printed. The evidence register shows only the report-level,
//     already-pseudonymized fields. `legalProductionMode` is reserved for a future,
//     separately-approved production mode and changes nothing about secret exposure here.
//   • The score is confidence-labelled and never overstated; low sample / low confidence raise
//     prominent warnings; the copy never calls the company guilty or asserts universal ghosting.

import PDFDocument from 'pdfkit';
import { LOW_SAMPLE_THRESHOLD } from '../../api/_utils/companyAuditBundle.js';

export { LOW_SAMPLE_THRESHOLD };

// ── Layout + palette (black / navy / gray — restrained, business-legal) ──────────────
const PAGE = { size: 'LETTER', width: 612, height: 792 };
const M = 54;                       // page margin
const CW = PAGE.width - M * 2;       // content width (504)
const BOTTOM = PAGE.height - M;      // bottom content boundary (738)
const INK = '#111318';               // near-black body
const NAVY = '#1c2c4c';              // headings / rules
const GRAY = '#5b6470';              // secondary
const FAINT = '#8a929c';             // captions
const LINE = '#c9ced6';              // table rules
const WARN_BG = '#fbeceb';           // warning fill (very muted red)
const WARN_INK = '#7a1f1a';          // warning text
const WARN_LINE = '#c68b86';
const BOXBG = '#f4f6f9';             // neutral callout fill

const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const ITAL = 'Helvetica-Oblique';
const SERIF = 'Times-Roman';

// ── small helpers ────────────────────────────────────────────────────────────────────
const S = (v) => (v == null || v === '' ? '—' : String(v));
const pct = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(1)}%`);
const num = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : String(v));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'); } catch { return String(iso); }
}
function normName(n) { return String(n || '').trim().toLowerCase().replace(/[\s,]+(inc|llc|corp|ltd|co|plc)\.?$/i, '').trim(); }

// Ensure `need` vertical points are available; else start a new page. Returns current y.
function ensure(doc, need) {
  if (doc.y + need > BOTTOM) doc.addPage();
  return doc.y;
}

function sectionHeading(doc, index, title) {
  ensure(doc, 46);
  doc.moveDown(0.4);
  const y = doc.y;
  doc.save();
  doc.rect(M, y, CW, 20).fill(NAVY);
  doc.fill('#ffffff').font(BOLD).fontSize(10.5).text(`${index}.  ${title.toUpperCase()}`, M + 8, y + 5.5, { width: CW - 16, lineBreak: false });
  doc.restore();
  doc.fill(INK).font(FONT).fontSize(9.5);
  doc.y = y + 30;
}

function para(doc, text, opts = {}) {
  doc.font(opts.font || FONT).fontSize(opts.size || 9.5).fill(opts.color || INK);
  ensure(doc, 14);
  doc.text(text, M, doc.y, { width: CW, align: opts.align || 'left', lineGap: 1.5 });
  doc.moveDown(opts.gap ?? 0.5);
}

function bullet(doc, text) {
  doc.font(FONT).fontSize(9.5).fill(INK);
  ensure(doc, 14);
  const x = M + 14;
  const top = doc.y;
  doc.text('•', M + 2, top, { width: 10, lineBreak: false });
  doc.text(text, x, top, { width: CW - 14, lineGap: 1 });
  doc.moveDown(0.25);
}

// Two-column key/value block. Long values wrap in the value column (no clipping).
function kv(doc, rows, opts = {}) {
  const labelW = opts.labelW || 150;
  const valX = M + labelW + 10;
  const valW = CW - labelW - 10;
  doc.fontSize(9.5);
  for (const [label, value, strong] of rows) {
    const vStr = S(value);
    const h = Math.max(
      doc.font(BOLD).heightOfString(label, { width: labelW }),
      doc.font(strong ? BOLD : FONT).heightOfString(vStr, { width: valW }),
    );
    ensure(doc, h + 6);
    const y = doc.y;
    doc.font(BOLD).fill(GRAY).text(label, M, y, { width: labelW });
    doc.font(strong ? BOLD : FONT).fill(strong ? NAVY : INK).text(vStr, valX, y, { width: valW });
    doc.y = y + h + 4;
  }
}

// A boxed strong warning (low sample / low confidence).
function warningBox(doc, title, lines) {
  doc.font(FONT).fontSize(9.5);
  const innerW = CW - 24;
  let bodyH = 0;
  for (const ln of lines) bodyH += doc.heightOfString(ln, { width: innerW }) + 3;
  const boxH = 22 + bodyH + 10;
  ensure(doc, boxH + 6);
  const y = doc.y;
  doc.save();
  doc.rect(M, y, CW, boxH).fill(WARN_BG);
  doc.rect(M, y, 4, boxH).fill(WARN_LINE);
  doc.restore();
  doc.font(BOLD).fontSize(10).fill(WARN_INK).text(`⚠  ${title}`, M + 12, y + 8, { width: innerW });
  let yy = y + 24;
  doc.font(FONT).fontSize(9.5).fill(WARN_INK);
  for (const ln of lines) {
    doc.text(ln, M + 12, yy, { width: innerW });
    yy += doc.heightOfString(ln, { width: innerW }) + 3;
  }
  doc.y = y + boxH + 8;
}

function calloutBox(doc, lines) {
  doc.font(FONT).fontSize(9.5);
  const innerW = CW - 20;
  let bodyH = 0;
  for (const ln of lines) bodyH += doc.heightOfString(ln, { width: innerW }) + 3;
  const boxH = bodyH + 14;
  ensure(doc, boxH + 6);
  const y = doc.y;
  doc.save();
  doc.rect(M, y, CW, boxH).fill(BOXBG);
  doc.restore();
  let yy = y + 7;
  doc.font(FONT).fontSize(9.5).fill(INK);
  for (const ln of lines) {
    doc.text(ln, M + 10, yy, { width: innerW });
    yy += doc.heightOfString(ln, { width: innerW }) + 3;
  }
  doc.y = y + boxH + 8;
}

// Bordered data table with wrapping cells and a header row that repeats after a page break.
function table(doc, columns, rows) {
  const totalW = columns.reduce((s, c) => s + c.w, 0);
  const scale = CW / totalW;
  const cols = columns.map(c => ({ ...c, w: c.w * scale }));
  const pad = 4;

  const drawHeader = () => {
    const y = doc.y;
    const hgt = 16;
    doc.save();
    doc.rect(M, y, CW, hgt).fill(NAVY);
    doc.fill('#ffffff').font(BOLD).fontSize(7.8);
    let x = M;
    for (const c of cols) { doc.text(c.label, x + pad, y + 4.5, { width: c.w - pad * 2, lineBreak: false }); x += c.w; }
    doc.restore();
    doc.y = y + hgt;
  };

  ensure(doc, 40);
  drawHeader();
  doc.font(FONT).fontSize(8).fill(INK);

  for (const row of rows) {
    const cells = cols.map(c => S(row[c.key]));
    const heights = cols.map((c, i) => doc.font(FONT).fontSize(8).heightOfString(cells[i], { width: c.w - pad * 2 }));
    const rowH = Math.max(14, ...heights) + 6;
    if (doc.y + rowH > BOTTOM) { doc.addPage(); drawHeader(); doc.font(FONT).fontSize(8).fill(INK); }
    const y = doc.y;
    let x = M;
    for (let i = 0; i < cols.length; i++) {
      doc.font(FONT).fontSize(8).fill(INK).text(cells[i], x + pad, y + 3, { width: cols[i].w - pad * 2 });
      x += cols[i].w;
    }
    doc.save().strokeColor(LINE).lineWidth(0.5).moveTo(M, y + rowH).lineTo(M + CW, y + rowH).stroke().restore();
    doc.y = y + rowH;
  }
  doc.moveDown(0.6);
}

// A labelled evidence card — used for the evidence register so long report IDs / company names
// / trust reasons wrap cleanly instead of clipping in a wide table. Submitter identity is NOT
// among the printed fields.
function evidenceCard(doc, n, r) {
  const fields = [
    ['Report ID', r.id],
    ['Created (UTC)', fmtDate(r.created_at)],
    ['Company', r.company_name],
    ['Company ID', r.company_id],
    ['City', r.city],
    ['Role', r.role],
    ['Platform', r.platform],
    ['Stored source', r.stored_source],
    ['Source type', r.source_type],
    ['Source trust weight', r.source_trust_weight],
    ['Outcome', r.outcome],
    ['Ghost stage', r.ghost_stage],
    ['Rounds', r.rounds],
    ['Wait days', r.wait_days],
    ['Unpaid work', r.unpaid_work],
    ['Experience level', r.experience_level],
    ['Outcome weight', r.outcome_weight],
    ['Needs review', r.needs_review ? 'yes' : 'no'],
    ['Included in score', r.included_in_score ? 'YES' : 'NO (held for review)'],
    ['Trust reason', r.trust_reason],
  ];
  // Two columns of label:value pairs inside a bordered card.
  const colW = (CW - 16) / 2;
  const labelW = 92;
  const rowsPerCol = Math.ceil(fields.length / 2);
  const left = fields.slice(0, rowsPerCol);
  const right = fields.slice(rowsPerCol);
  doc.font(FONT).fontSize(7.6);
  const measure = (pairs) => pairs.reduce((h, [l, v]) => h + Math.max(
    doc.heightOfString(l, { width: labelW }),
    doc.heightOfString(S(v), { width: colW - labelW - 6 }),
  ) + 3, 0);
  const bodyH = Math.max(measure(left), measure(right));
  const cardH = bodyH + 22;
  if (doc.y + cardH > BOTTOM) doc.addPage();
  const y0 = doc.y;
  doc.save().strokeColor(LINE).lineWidth(0.7).rect(M, y0, CW, cardH).stroke().restore();
  doc.font(BOLD).fontSize(8.5).fill(NAVY).text(`Evidence #${n}`, M + 8, y0 + 6, { width: CW - 16, lineBreak: false });
  const drawCol = (pairs, x) => {
    let yy = y0 + 20;
    for (const [l, v] of pairs) {
      const vw = colW - labelW - 6;
      const h = Math.max(doc.font(BOLD).heightOfString(l, { width: labelW }), doc.font(FONT).heightOfString(S(v), { width: vw }));
      doc.font(BOLD).fontSize(7.6).fill(GRAY).text(l, x, yy, { width: labelW });
      doc.font(FONT).fontSize(7.6).fill(INK).text(S(v), x + labelW + 4, yy, { width: vw });
      yy += h + 3;
    }
  };
  drawCol(left, M + 8);
  drawCol(right, M + 8 + colW + 8);
  doc.y = y0 + cardH + 8;
}

// One factor line: "+18  ats_direct — <reason>". Indented, page-break aware.
function factorLine(doc, f) {
  const sign = f.points > 0 ? `+${f.points}` : `${f.points}`;
  const txt = `${sign}  ${S(f.signal)} — ${S(f.reason)}`;
  doc.font(FONT).fontSize(7.8).fill(INK);
  const h = doc.heightOfString(txt, { width: CW - 24 });
  ensure(doc, h + 3);
  doc.text(txt, M + 16, doc.y, { width: CW - 24, lineGap: 0.5 });
}

// A single listing's transparency score printed next to the exact factors that produced it.
// The factor deltas (plus the baseline) sum to the raw score, so the number is reconstructable
// from the reasons shown here — the legal point of the section.
function listingCard(doc, n, l) {
  ensure(doc, 56);
  doc.font(BOLD).fontSize(9).fill(NAVY).text(`Listing #${n}: ${S(l.title) || '(untitled listing)'}`, M, doc.y, { width: CW });
  doc.font(FONT).fontSize(7.8).fill(GRAY).text(
    `${S(l.location) || 'location n/a'}  ·  source ${S(l.source) || 'n/a'}  ·  ${S(l.type) || 'n/a'}  ·  posted ${fmtDate(l.posted_at)}`,
    M, doc.y, { width: CW });
  doc.moveDown(0.15);
  doc.font(BOLD).fontSize(8.4).fill(INK).text(
    `Transparency ${l.transparency_score}/95   ·   Wasted-time risk ${l.waste_score}/90` +
    (l.score_mismatch ? `   ·   stored ${l.stored_score} (flagged for recompute)` : ''),
    M, doc.y, { width: CW });
  doc.moveDown(0.1);
  doc.font(BOLD).fontSize(7.6).fill(GRAY); ensure(doc, 12);
  doc.text('Why this transparency score:', M, doc.y, { width: CW });
  for (const f of (l.score_factors || [])) factorLine(doc, f);
  doc.font(BOLD).fontSize(7.6).fill(GRAY); ensure(doc, 12);
  doc.text('Why this wasted-time risk:', M, doc.y + 2, { width: CW });
  for (const f of (l.waste_factors || [])) factorLine(doc, f);
  doc.save().strokeColor(LINE).lineWidth(0.5).moveTo(M, doc.y + 4).lineTo(M + CW, doc.y + 4).stroke().restore();
  doc.y = doc.y + 10;
}

// One source-inventory entry: name + classification + reason + limitation, page-break aware.
// Makes each source's use-classification defensible on its own line.
function sourceInventoryCard(doc, s, catLabel) {
  ensure(doc, 40);
  doc.font(BOLD).fontSize(8.6).fill(NAVY).text(S(s.source), M, doc.y, { width: CW });
  const meta = `Class ${S(s.source_class)} · ${s.record_count ?? 0} record(s) · affected score: ${s.affected_score ? 'YES' : 'no'}`
    + (s.effective_trust_weight != null ? ` · applied trust ${s.effective_trust_weight}` : (s.configured_trust_weight != null ? ` · configured trust ${s.configured_trust_weight}` : ''))
    + ` · ${catLabel[s.category] || S(s.category)}`;
  doc.font(FONT).fontSize(7.8).fill(GRAY).text(meta, M, doc.y + 1, { width: CW });
  doc.font(FONT).fontSize(7.9).fill(INK).text(`Reason: ${S(s.reason)}`, M + 10, doc.y + 1, { width: CW - 10 });
  doc.font(FONT).fontSize(7.9).fill(INK).text(`Limitation: ${S(s.limitation)}`, M + 10, doc.y, { width: CW - 10 });
  doc.save().strokeColor(LINE).lineWidth(0.5).moveTo(M, doc.y + 4).lineTo(M + CW, doc.y + 4).stroke().restore();
  doc.y = doc.y + 9;
}

// Header + footer + page numbers, painted after all content so the total is known.
function paintChrome(doc, sourceHash) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    // Header
    doc.font(BOLD).fontSize(7.5).fill(NAVY)
      .text('SeenJobs — Company Score Audit & Methodology Report', M, 24, { width: CW - 90, lineBreak: false });
    doc.font(BOLD).fontSize(7.5).fill(WARN_INK)
      .text('CONFIDENTIAL', M, 24, { width: CW, align: 'right', lineBreak: false });
    doc.save().strokeColor(LINE).lineWidth(0.6).moveTo(M, 36).lineTo(M + CW, 36).stroke().restore();
    // Footer
    doc.save().strokeColor(LINE).lineWidth(0.6).moveTo(M, PAGE.height - 40).lineTo(M + CW, PAGE.height - 40).stroke().restore();
    doc.font(FONT).fontSize(6.8).fill(FAINT)
      .text('Confidential Legal Methodology Disclosure — not a legal finding', M, PAGE.height - 34, { width: CW * 0.55, lineBreak: false });
    doc.font(FONT).fontSize(6.8).fill(FAINT)
      .text(`Page ${i + 1} of ${total}`, M, PAGE.height - 34, { width: CW, align: 'center', lineBreak: false });
    doc.font(FONT).fontSize(6.5).fill(FAINT)
      .text(`SHA-256 ${sourceHash.slice(0, 16)}…`, M + CW * 0.6, PAGE.height - 34, { width: CW * 0.4, align: 'right', lineBreak: false });
  }
}

// ── main entry ─────────────────────────────────────────────────────────────────────
export function renderCompanyAuditPdf(bundle, opts = {}) {
  const { sourceHash = '', codeVersion = null, engineVersion = null, termsVersion = null } = opts;
  const computed = bundle.computed_score || {};
  const cached = bundle.cached_company_score || {};
  const totals = bundle.totals || {};
  const method = bundle.methodology || {};
  const includedCount = totals.included_in_score ?? 0;
  const avail = bundle.source_availability || {};
  const inventory = bundle.source_inventory || [];
  const confidenceLabel = String(computed.confidence_label || cached.data_quality || 'low').toLowerCase();
  const lowSample = includedCount < LOW_SAMPLE_THRESHOLD;
  const lowConfidence = confidenceLabel === 'low' || computed.sufficient === false || (computed.confidence != null && computed.confidence < 0.33);
  // NO report signal: nothing was actually resolved into the grade — the score is the neutral
  // 50/100 baseline, NOT a "mixed/elevated" reading. Gate all report-risk wording on this.
  const noReportSignal = avail.no_applicant_reports_counted ?? ((computed.sources_used || []).length === 0);
  // Other source classes that exist even when no applicant report counted — so we never say
  // "no data" when listings / aliases / external context are present.
  const hasOtherSources = (avail.listing_data_available > 0) || avail.external_context_available === true;
  const riskWord = noReportSignal ? 'No report-derived company risk signal — neutral baseline'
    : computed.risk_level === 'safe' ? 'Lower reported risk'
      : computed.risk_level === 'warn' ? 'Mixed / elevated reported signals'
        : computed.risk_level === 'danger' ? 'Higher reported risk (read limitations)'
          : '—';
  const overallScoreLabel = noReportSignal
    ? `${computed.overall_score != null ? computed.overall_score : 50} / 100 neutral baseline — no applicant reports counted`
    : (computed.overall_score != null ? `${computed.overall_score} / 100` : (cached.overall_score != null ? `${cached.overall_score} / 100` : '—'));
  const MAX_CARDS = 400;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', bufferPages: true, margins: { top: M, bottom: M, left: M, right: M }, autoFirstPage: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ══ 1. COVER PAGE ══
    doc.y = 96;
    doc.font(BOLD).fontSize(22).fill(NAVY).text('Company Score Audit', M, doc.y, { width: CW, align: 'left' });
    doc.font(BOLD).fontSize(22).fill(NAVY).text('& Methodology Report', M, doc.y, { width: CW });
    doc.moveDown(0.4);
    doc.font(BOLD).fontSize(11).fill(WARN_INK).text('Confidential Legal Methodology Disclosure', { width: CW });
    doc.moveDown(1.2);
    doc.save().strokeColor(NAVY).lineWidth(1.2).moveTo(M, doc.y).lineTo(M + CW, doc.y).stroke().restore();
    doc.moveDown(1);
    kv(doc, [
      ['Company / query', bundle.query, true],
      ['Export type', bundle.export_type],
      ['Schema version', bundle.schema_version],
      ['Generated (UTC)', fmtDate(bundle.generated_at)],
      ['Generated by', `admin ${S(bundle.generated_by?.admin_id)} · role ${S(bundle.generated_by?.role)}`],
      ['Source JSON SHA-256', sourceHash],
    ], { labelW: 160 });
    doc.moveDown(0.8);
    calloutBox(doc, [
      'Purpose: this packet documents which company was matched, the score shown, the data used, which reports were included or excluded, a full inventory of EVERY source class SeenJobs holds for the company (score-contributing, context-only, listing-only, matching-only, held-out, or unavailable), the methodology and source weights applied, the confidence level, the privacy protections in force, the limitations that apply, and how the company may dispute or correct the score and how this record can be reproduced.',
      'It is prepared for a company, attorney, regulator, or authorized legal representative requesting an explanation of how SeenJobs scored the company. It is a methodology and evidence disclosure — not legal advice, not a legal finding, and not a statement that the company is guilty of anything.',
    ]);
    if (lowSample || lowConfidence) {
      warningBox(doc, 'Preliminary — read the executive summary and limitations first', [
        lowSample ? `Only ${includedCount} report(s) counted toward this score (below the ${LOW_SAMPLE_THRESHOLD}-report threshold for a firm reading).` : null,
        lowConfidence ? `Confidence for this score is "${confidenceLabel}". It should not be read as a conclusive assessment of the company.` : null,
      ].filter(Boolean));
    }

    // ══ 2. SCORE SNAPSHOT ══
    doc.addPage();
    sectionHeading(doc, 2, 'Score snapshot');
    para(doc, 'This snapshot is the APPLICANT-REPORT company grade. Listing transparency is a separate score (see its own section) and is not blended in here.', { size: 8.5, color: GRAY });
    kv(doc, [
      ['Applicant-report company score', overallScoreLabel, true],
      ['Risk level', riskWord, true],
      ['Confidence label', cap(confidenceLabel), true],
      ['Reports counted (sample size)', includedCount, true],
      ['Total reports found', totals.total_reports],
      ['Included reports', includedCount],
      ['Excluded reports (needs review)', totals.excluded_needs_review],
      ['Distinct submitters', totals.distinct_submitters],
      ['Ghost rate', noReportSignal ? 'n/a (no reports counted)' : pct(computed.ghost_rate)],
      ['Response rate', noReportSignal ? 'n/a (no reports counted)' : pct(computed.response_rate)],
      ['Waste score', noReportSignal ? 'n/a (no reports counted)' : (computed.waste_score != null ? `${computed.waste_score} / 100` : '—')],
      ['Unpaid-work rate', noReportSignal ? 'n/a (no reports counted)' : pct(computed.unpaid_rate)],
      ['Average wait (days)', noReportSignal ? 'n/a' : num(computed.avg_wait_days)],
      ['Average rounds', noReportSignal ? 'n/a' : num(computed.avg_rounds)],
      ['Sufficient sample', computed.sufficient === true ? 'true' : 'false', true],
    ], { labelW: 200 });
    // Split confidence/availability — never a single vague "Data quality: Medium" beside zero
    // reports. Each dimension stands on its own.
    doc.moveDown(0.2);
    para(doc, 'Confidence & availability (reported separately — availability of a source does not mean it affected the grade)', { font: BOLD, size: 9, gap: 0.2 });
    kv(doc, [
      ['Applicant-report confidence', cap(String(avail.applicant_report_confidence || confidenceLabel))],
      ['Applicant-report sample size', `${avail.applicant_report_sample_size ?? includedCount} included report(s)`],
      ['External / context source availability', avail.external_context_available ? `Present (${avail.external_review_snippet_count ?? 0} external-review snippet(s); aliases/company records may also apply)` : 'None'],
      ['Listing data availability', `${avail.listing_data_available ?? 0} listing(s)`],
      ['Company matching confidence', cap(String(avail.company_matching_confidence || 'none'))],
    ], { labelW: 220 });

    // ══ 3. EXECUTIVE SUMMARY ══
    sectionHeading(doc, 3, 'Executive summary');
    para(doc,
      noReportSignal
        ? `This report concerns the query "${S(bundle.query)}". No applicant reports counted toward the company score, so the applicant-report grade is the neutral 50/100 baseline rather than a reading of hiring behavior. SeenJobs may still hold other company-related signals (listings, aliases, external context); the Source Inventory section classifies each one and states whether it affected the grade (none did).`
        : `This report concerns the query "${S(bundle.query)}". The overall score shown${computed.overall_score != null ? ` (${computed.overall_score} of 100)` : ''} is an informational, confidence-labelled summary of applicant-reported hiring outcomes for the matched company, computed with the configured scoring methodology at the time of export. It reflects what applicants reported to SeenJobs — it is not a verified finding about every hiring interaction involving the company.`,
      { font: SERIF, size: 10 });
    para(doc,
      'The score summarizes available applicant-reported outcomes and the configured source weights. Reports flagged for review are held out of the score. Scores are subject to revision as additional reports, corrections, or verification data are received.',
      { font: SERIF, size: 10 });
    if (noReportSignal) {
      // Never "no data" when other source classes exist — say precisely what has zero.
      calloutBox(doc, hasOtherSources ? [
        'No score-contributing applicant reports: no applicant reports counted toward the company score, so the applicant-report grade is the neutral 50/100 baseline — not a positive or negative finding.',
        `Other source classes ARE present for this company and are documented in the Source Inventory: ${avail.listing_data_available ?? 0} job listing(s), scored independently for listing transparency (they grade the posting, not the company), plus company-matching and/or external-context data. Their presence does not change the applicant-report grade.`,
        'Applicant-report company score: neutral baseline / insufficient applicant data. Listing transparency: available for the listing(s) above, scored independently from posting content.',
      ] : [
        'No score-contributing applicant reports and no other company-related source classes were present for this company in this export. The applicant-report grade is the neutral 50/100 baseline — insufficient applicant data, not a finding.',
      ]);
    }
    if (lowSample) {
      warningBox(doc, 'Low sample size', [
        `Only ${includedCount} report(s) counted toward this score, below the ${LOW_SAMPLE_THRESHOLD}-report threshold used for a firm reading.`,
        'A score computed from a small sample can move substantially with a few additional reports and must not be treated as a stable or conclusive measure of the company.',
      ]);
    }
    if (lowConfidence) {
      warningBox(doc, 'Low confidence', [
        `The confidence label for this score is "${confidenceLabel}".`,
        'A low-confidence or low-sample score should not be interpreted as a conclusive assessment of the company as a whole. Treat it as an early signal pending additional data.',
      ]);
    }

    // ══ 4. COMPANY MATCHING ══
    sectionHeading(doc, 4, 'Company matching');
    const matched = bundle.company?.matched_records || [];
    const canonical = matched[0]?.name || null;
    kv(doc, [
      ['Search query', bundle.query],
      ['Matched company records', matched.length],
      ['Canonical company name', canonical],
      ['Aliases', (bundle.company?.aliases || []).join(', ') || 'none recorded'],
      ['Alias resolution source', 'company_aliases table (not recorded per-alias)'],
    ], { labelW: 175 });
    doc.moveDown(0.3);
    if (matched.length) {
      table(doc, [
        { key: 'id', label: 'Matched company ID', w: 46 },
        { key: 'name', label: 'Name', w: 34 },
        { key: 'match', label: 'Match confidence', w: 20 },
      ], matched.map(m => ({ id: S(m.id), name: S(m.name), match: normName(m.name) === normName(bundle.query) ? 'exact' : 'partial' })));
    } else {
      para(doc, 'No company records matched the query. The score, if any, is computed from reports keyed by company name.', { color: GRAY });
    }

    // ══ 5. METHODOLOGY ══
    sectionHeading(doc, 5, 'Methodology');
    para(doc, S(method.description), { font: SERIF, size: 10 });
    doc.moveDown(0.2);
    para(doc, 'Source trust weights', { font: BOLD, size: 9.5, gap: 0.2 });
    const stw = method.source_trust_weights || {};
    table(doc, [{ key: 'source', label: 'Source type', w: 50 }, { key: 'weight', label: 'Trust weight', w: 50 }],
      Object.entries(stw).map(([k, v]) => ({ source: k, weight: String(v) })));
    kv(doc, [['Prior strength', method.prior_strength]], { labelW: 175 });
    doc.moveDown(0.2);
    para(doc, 'Outcome taxonomy', { font: BOLD, size: 9.5, gap: 0.2 });
    const tax = method.outcome_taxonomy || {};
    kv(doc, [
      ['Ghost outcomes', (tax.ghost || []).join(', ')],
      ['Response outcomes', (tax.response || []).join(', ')],
      ['Non-terminal (excluded from rates)', (tax.non_terminal_excluded_from_rates || []).join(', ')],
    ], { labelW: 200 });
    para(doc, 'Included vs excluded: a report is included in the score unless it is flagged needs_review, in which case it is held out until an admin clears it. needs_review rows appear in the evidence register marked "Included in score: NO" so the exclusion is auditable.', { size: 9 });
    if (computed.confidence != null) para(doc, `Confidence calculation: the fusion engine assigns a confidence of ${computed.confidence} (label "${confidenceLabel}") from the trust-weighted sample size, tenure sample, and data age; "sufficient" is true when confidence ≥ 0.33.`, { size: 9 });
    para(doc, 'Score reproduction snapshot', { font: BOLD, size: 9.5, gap: 0.2 });
    kv(doc, [
      ['Base score', num(computed.base_score)],
      ['Tenure adjustment', num(computed.tenure_adjustment)],
      ['Overall score', num(computed.overall_score)],
      ['Effective sample (eff_n)', num(computed.empirical?.eff_n)],
      ['Sources used', (computed.sources_used || []).join(', ')],
    ], { labelW: 175 });
    calloutBox(doc, ['This score is reproducible: re-running the trust-weighted fusion over the included reports listed in the evidence register (with an empty web prior) yields the overall score above. The SHA-256 on the cover fingerprints the exact JSON bundle these values were rendered from.']);

    // ══ 6. SOURCE BREAKDOWN (SCORE-CONTRIBUTING ONLY) ══
    sectionHeading(doc, 6, 'Source breakdown (score-contributing only)');
    para(doc, 'This table shows ONLY the source buckets that contributed to the applicant-report grade. The full set of source classes SeenJobs holds for this company — including those that did NOT affect the grade — is in the next section (Source Inventory & Use Classification).', { size: 9, color: GRAY });
    const sb = bundle.source_breakdown || [];
    if (sb.length) {
      table(doc, [
        { key: 'source_type', label: 'Source type', w: 26 },
        { key: 'trust_weight', label: 'Trust', w: 14 },
        { key: 'report_count', label: 'Reports', w: 16 },
        { key: 'resolved', label: 'Resolved', w: 16 },
        { key: 'ghosted', label: 'Ghosted', w: 16 },
        { key: 'responded', label: 'Responded', w: 18 },
        { key: 'weighted_resolved', label: 'Wgt. resolved', w: 20 },
      ], sb.map(s => ({ ...s, trust_weight: String(s.trust_weight) })));
    } else {
      para(doc, 'No source buckets contributed to the score (no applicant reports counted). See the Source Inventory below for the other source classes that may still be present.', { color: GRAY });
    }

    // ══ 7. SOURCE INVENTORY & USE CLASSIFICATION ══
    sectionHeading(doc, 7, 'Source inventory & use classification');
    para(doc, 'SeenJobs may maintain or display multiple categories of company-related signals. Not every available signal contributes to the company grade. This audit distinguishes between score-contributing evidence, company-matching data, listing-transparency data, external/contextual enrichment, and sources held out or unavailable for this export.', { font: SERIF, size: 10 });
    para(doc, 'Where third-party or public-source signals are present, they are treated as contextual or lower-weight evidence unless the scoring methodology explicitly includes them. The audit packet identifies their use classification and configured trust weight so the score can be reproduced and challenged.', { font: SERIF, size: 10 });
    para(doc, 'Source availability does not mean the source affected the company score. The "Use Classification" column identifies whether each source was score-contributing, context-only, listing-only, matching-only, or excluded.', { font: BOLD, size: 9.5 });
    para(doc, 'Listing transparency scores grade the posting, not the company.', { font: BOLD, size: 9.5 });
    doc.moveDown(0.2);

    const CAT_LABEL = {
      included_in_score: 'Included in company score',
      available_not_included: 'Available, not in score',
      matching_only: 'Company matching only',
      listing_transparency_only: 'Listing transparency only',
      display_context_only: 'Display / context only',
      held_out_excluded: 'Held out / excluded (review)',
      not_available: 'Not available for this export',
    };
    const NATURE_LABEL = {
      applicant_reported: 'Applicant-reported',
      third_party_contextual: 'Third-party / contextual',
      listing_derived: 'Listing-derived',
      admin_enriched: 'Admin-enriched',
      matching: 'Company-matching',
    };
    if (inventory.length) {
      table(doc, [
        { key: 'source', label: 'Source', w: 42 },
        { key: 'nature', label: 'Nature', w: 24 },
        { key: 'records', label: 'Records', w: 13 },
        { key: 'affected', label: 'In score?', w: 15 },
        { key: 'trust', label: 'Trust wt', w: 14 },
        { key: 'use', label: 'Use classification', w: 32 },
      ], inventory.map(s => ({
        source: S(s.source),
        nature: NATURE_LABEL[s.nature] || S(s.nature),
        records: String(s.record_count ?? 0),
        affected: s.affected_score ? 'YES' : 'no',
        trust: s.effective_trust_weight != null ? String(s.effective_trust_weight)
          : (s.configured_trust_weight != null ? `(${s.configured_trust_weight})` : '—'),
        use: CAT_LABEL[s.category] || S(s.category),
      })));
      para(doc, 'Trust weight shown bare = the weight actually applied to the grade; a value in (parentheses) = the methodology-configured weight for a source that did NOT contribute (present-but-unused or absent). "—" = no trust weight applies (matching/listing/enrichment data).', { size: 8, color: GRAY });
      // Per-source reason + limitation, so each classification is defensible line by line.
      doc.moveDown(0.2);
      para(doc, 'Per-source classification detail', { font: BOLD, size: 9.5, gap: 0.2 });
      for (const s of inventory) sourceInventoryCard(doc, s, CAT_LABEL);
    } else {
      para(doc, 'No source inventory was produced for this export.', { color: GRAY });
    }

    // ══ 8. EVIDENCE REGISTER ══
    sectionHeading(doc, 8, 'Evidence register');
    const reports = bundle.reports || [];
    para(doc, `${reports.length} report(s) on record for this company (${includedCount} counted toward the score, ${totals.excluded_needs_review ?? 0} held for review). Submitter identities are excluded — see the privacy section.`, { size: 9, color: GRAY });
    const show = reports.slice(0, MAX_CARDS);
    show.forEach((r, i) => evidenceCard(doc, i + 1, r));
    if (reports.length > MAX_CARDS) {
      warningBox(doc, 'Register truncated for length', [
        `This PDF renders the first ${MAX_CARDS} of ${reports.length} reports. The complete, unabridged register is in the companion JSON export whose SHA-256 appears on the cover page — nothing is silently omitted from the record of hash.`,
      ]);
    }

    // ══ 9. LISTING TRANSPARENCY SCORES ══
    sectionHeading(doc, 9, 'Listing transparency scores');
    const listings = bundle.listing_scores || [];
    const lm = bundle.listing_methodology || {};
    para(doc, S(lm.description), { font: SERIF, size: 9.5 });
    if (lm.distinct_from_company_grade) para(doc, S(lm.distinct_from_company_grade), { font: SERIF, size: 9.5, color: GRAY });
    kv(doc, [
      ['Transparency score range', Array.isArray(lm.transparency_range) ? `${lm.transparency_range[0]}–${lm.transparency_range[1]} (baseline ${lm.transparency_baseline})` : 'n/a'],
      ['Wasted-time score range', Array.isArray(lm.waste_range) ? `${lm.waste_range[0]}–${lm.waste_range[1]} (baseline ${lm.waste_baseline})` : 'n/a'],
      ['Listings on record', listings.length],
      ['Stored score ≠ live recompute', totals.listings_with_score_mismatch ?? 0],
    ], { labelW: 220 });

    if (!listings.length) {
      para(doc, 'No job listings are currently on record for this company, so there are no listing transparency scores to disclose.', { size: 9, color: GRAY });
    } else {
      para(doc, 'Each listing below shows its transparency score next to the exact factors that produced it. Every factor states its point delta and reason; those deltas plus the neutral baseline sum to the raw score, which is then clamped to the stated range — so each number is fully reconstructable from its stated reasons.', { size: 9, color: GRAY });
      const MAX_LISTING_CARDS = 40;
      listings.slice(0, MAX_LISTING_CARDS).forEach((l, i) => listingCard(doc, i + 1, l));
      if (listings.length > MAX_LISTING_CARDS) {
        warningBox(doc, 'Listing detail truncated for length', [
          `This PDF prints the full factor breakdown for the first ${MAX_LISTING_CARDS} of ${listings.length} listings. Every listing's complete factor list is in the companion JSON export (field "listing_scores") whose SHA-256 appears on the cover page — nothing is silently omitted from the hashed record.`,
        ]);
      }
    }

    // ══ 10. PRIVACY AND PSEUDONYMIZATION ══
    sectionHeading(doc, 10, 'Privacy and pseudonymization');
    para(doc, S(bundle.privacy_note), { font: SERIF, size: 10 });
    bullet(doc, 'Submitter identity is not disclosed by default. This packet prints no submitter tokens, user ids, names, emails, IP addresses, payment records, or account identifiers.');
    bullet(doc, 'Where the underlying bundle carries a submitter token, it is a keyed one-way hash (stable per submitter for distinct-count integrity) and is not reversible to an account without the server secret, which is never included here.');
    bullet(doc, 'Re-identification or linkage of any pseudonymized token to a person or account requires separate legal review and a distinct, explicitly-approved legal-production process — it is not part of this standard audit PDF.');
    bullet(doc, 'Server secrets and account identifiers are excluded from the normal legal audit PDF and are not derivable from its contents.');
    bullet(doc, 'Third-party / external-review signals (e.g. Glassdoor / Reddit / Blind snippets from web research) are summarized here by metadata only — source class, record counts, dates, and weighting. Raw external excerpts are NOT reproduced in this standard packet; they are included only in a separate, legally-approved source appendix, so third-party platform terms and attribution rules are respected.');

    // ══ 11. LIMITATIONS AND LEGAL POSITIONING ══
    sectionHeading(doc, 11, 'Limitations and legal positioning');
    para(doc, 'This report is a methodology and evidence disclosure packet. It is not legal advice, not a legal opinion, not a judicial finding, and not a definitive statement about every hiring interaction involving the company.', { font: SERIF, size: 10 });
    para(doc, 'The company score summarizes available applicant-reported outcomes and configured scoring methodology at the time of export. Scores are confidence-labeled and subject to revision as additional reports, corrections, or verification data are received.', { font: SERIF, size: 10 });
    para(doc, 'A low-confidence or low-sample score should not be interpreted as a conclusive assessment of the company as a whole.', { font: SERIF, size: 10 });
    bullet(doc, 'Reports are applicant-submitted claims. SeenJobs applies anti-Sybil trust weighting and a needs-review hold, but does not independently verify every individual report.');
    bullet(doc, 'The score does not establish that the company definitively ghosted, rejected, or mistreated any specific applicant, nor that it does so as a universal practice.');
    bullet(doc, 'Rates are computed over terminal outcomes only; non-terminal outcomes are excluded from rate denominators as described in the methodology.');

    // ══ 12. CORRECTION AND DISPUTE PROTOCOL ══
    sectionHeading(doc, 12, 'Correction and dispute protocol');
    para(doc, 'A company or authorized representative may dispute or request correction of the score. The repeatable process is:', { size: 9.5 });
    [
      'Intake the legal / correction request and record the requesting party and the specific records or values challenged.',
      'Preserve this source export (retain the PDF and its companion JSON; the SHA-256 fingerprint identifies the exact bundle).',
      'Verify the company match — confirm the matched company record(s) and aliases correspond to the disputing entity.',
      'Review the challenged records in the evidence register, including any held-for-review reports.',
      'Evaluate any new evidence or corrections supplied by the company.',
      'Recompute the score if the review warrants it, using the same deterministic methodology.',
      'Generate a NEW, versioned packet reflecting the outcome (new generated_at, new SHA-256).',
      'Do not silently overwrite the historical packet — the prior versioned export is retained as the record of what was disclosed at that time.',
    ].forEach(t => bullet(doc, t));

    // ══ 13. APPENDIX ══
    sectionHeading(doc, 13, 'Appendix — machine-readable field summary');
    kv(doc, [
      ['export_type', bundle.export_type],
      ['schema_version', bundle.schema_version],
      ['generated_at', bundle.generated_at],
      ['query', bundle.query],
      ['overall_score', computed.overall_score],
      ['confidence_label', confidenceLabel],
      ['sufficient', String(computed.sufficient)],
      ['total_reports', totals.total_reports],
      ['included_in_score', totals.included_in_score],
      ['excluded_needs_review', totals.excluded_needs_review],
      ['distinct_submitters', totals.distinct_submitters],
      ['total_listings', totals.total_listings ?? 0],
      ['listings_with_score_mismatch', totals.listings_with_score_mismatch ?? 0],
      ['source_classes_inventoried', inventory.length],
      ['source_classes_score_contributing', inventory.filter(s => s.affected_score).length],
      ['no_applicant_reports_counted', String(noReportSignal)],
      ['applicant_report_confidence', avail.applicant_report_confidence ?? confidenceLabel],
      ['company_matching_confidence', avail.company_matching_confidence ?? 'none'],
      ['cached_score_provenance', avail.cached_score_provenance ?? 'none'],
      ['source_json_sha256', sourceHash],
      ['code_version', codeVersion || 'not recorded'],
      ['scoring_engine_version', engineVersion || 'not recorded'],
      ['terms_privacy_version', termsVersion || 'not recorded'],
    ], { labelW: 175 });

    // ══ 14. CUSTODIAN CERTIFICATION PLACEHOLDER ══
    sectionHeading(doc, 14, 'Custodian certification (placeholder)');
    warningBox(doc, 'Attorney review required before any evidentiary use', [
      'This signature block is a placeholder and should not be used as a sworn declaration, affidavit, or evidentiary certification unless drafted or approved by counsel for the specific jurisdiction and proceeding.',
    ]);
    doc.moveDown(0.5);
    const sigRow = (label) => {
      ensure(doc, 34);
      const y = doc.y + 14;
      doc.save().strokeColor(GRAY).lineWidth(0.7).moveTo(M, y).lineTo(M + 300, y).stroke().restore();
      doc.font(FONT).fontSize(8).fill(GRAY).text(label, M, y + 3, { width: 300 });
      doc.y = y + 22;
    };
    sigRow('Custodian name');
    sigRow('Title');
    sigRow('Date');
    sigRow('Signature');

    // Chrome (header/footer/page numbers) painted last, then close.
    paintChrome(doc, sourceHash);
    doc.end();
  });
}
