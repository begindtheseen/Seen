// TRADE READING — oilfield entry jobs and trade apprenticeships / helper jobs (2026-11-13).
//
// What a first-time applicant to a floorhand, roustabout, frac operator, yard hand, CDL hauler, or an electrical /
// plumbing / HVAC / welding / line / heavy-equipment apprenticeship or helper job is screened on, read from the posting and
// judged against the résumé's own lines — never invented. The rules come from the hiring-side research
// (scratchpad research/resume-hiring-side.md §6, R1–R40); each rule below names the R it implements.
//
// ONE gate, `tradeContext(jobTitle, jobText)`: everything here runs only for a posting it places (null otherwise), so a
// posting outside the trades reads exactly as before.
//
// Hard rules kept here (CLAUDE.md 2026-11-10/11):
//   • a line is shown only by a résumé line that states the act (a lifted load, a repaired engine, an operated skid steer)
//     — never by an adjective ("physically fit", "hard worker") and never by a role header alone (R20, R22, R24);
//   • a job TITLE counts toward a related-BACKGROUND line ("farming, ranching, construction … or military"), never toward a
//     duty (R13);
//   • what only the person can say (a driver's license, a CDL class, a rotation, a ticket) is ASKED in plain words; the
//     answer is a claim (confirmations.js), never a résumé line (R1, R2, R5, R6, R11, R16);
//   • a drug test, a background check or a criminal record is a readiness NOTE shown to the person — never a question
//     whose answer could reach a résumé, and never résumé wording (R31, R32);
//   • an OSHA 10 / 30 is a card, never "certified" (R9).
import { postingSaysEntryLevel } from '../jobs/trainsBeginners.js';

// ── Which postings ───────────────────────────────────────────────────────────────────────────────────────────────
const OILFIELD_TITLE_RE = /\b(?:floor\s*hands?|roughnecks?|roustabouts?|derrick\s*(?:hands?|man)|motor\s*(?:hands?|man)|rig\s+(?:hands?|based)|lease\s*hands?|workover|well\s+servic\w*|frac(?:k?ing)?|flowback|wireline|coil(?:ed)?\s+tubing|water\s+transfer|(?:water|crude|oilfield|vac(?:uum)?|winch)\s+(?:hauler|truck\s+driver|driver)s?|haulers?|swampers?|pumpers?|hydro\s*-?vac|oil\s*field|toolpusher|yard\s+hands?|shop\s+(?:yard\s+)?hands?|casing\s+(?:crew|hands?|floorhands?))\b/i;
const TRADE_TITLE_RE = /\b(?:electricians?|plumbers?|plumbing|pipe\s*fitters?|steamfitters?|hvac|heating\s+and\s+air|refrigeration\s+tech\w*|welders?|welding|line(?:man|men|worker|workers|sman)|ground(?:s)?m[ae]n|heavy\s+equipment|equipment\s+operators?|operating\s+engineers?|crane\s+operators?|construction\s+(?:laborers?|workers?|helpers?)|general\s+laborers?|laborers?|cdl|truck\s+drivers?|tanker\s+drivers?|millwrights?|ironworkers?|boilermakers?)\b/i;
const RUNG_RE = /\b(?:pre-?apprentice\w*|apprentice\w*|helpers?|trainees?)\b/i;
const TRADE_NOUN_RE = /\b(?:electric\w*|plumb\w*|pipe\w*|hvac|heating|refrigeration|weld\w*|line(?:man|men|worker)?|lineman|ground\w*|equipment|operators?|construction|carpent\w*|mechanic\w*|diesel|millwright|iron\w*|boiler\w*|sheet\s*metal|insulat\w*|mason\w*|roof\w*|concrete|rig|frac|oil\w*|wireman|solar|fiber|cable|laborer|operating\s+engineers?)\b/i;
const NOT_CREW_TITLE_RE = /\b(?:engineer(?:ing)?|manager|director|sales|account\s+(?:executive|manager)|recruiter|coordinator|analyst|instructor|teacher|estimator|designer|scientist|inspector|dispatcher|planner|buyer|attorney|accountant|administrator|executive|specialist,?\s+(?:marketing|hr)|superintendent)\b/i;
const LABOR_TITLE_RE = /\b(?:hands?|helpers?|operators?|drivers?|haulers?|laborers?|technicians?|mechanics?|apprentices?|trainees?|yard|swampers?|crew|roughnecks?)\b/i;
const OILFIELD_TEXT_RE = /\b(?:oil\s*field|drilling\s+rig|rig\s+floor|frac\s+(?:jobs?|locations?|operations?|equipment)|well\s*sites?|workover|oil\s*(?:&|and)\s*gas)\b/i;

/** The trade reading's context for a posting, or null when the posting is not oilfield / trade work.
 *  { oilfield, entry, rung, driving } — `entry`: the posting trains beginners or is an apprentice / helper / trainee rung;
 *  `rung`: the TITLE names that rung; `driving`: driving is the job (a CDL hauler). */
export function tradeContext(jobTitle, jobText) {
  const title = String(jobTitle || '').slice(0, 160);
  const text = String(jobText || '');
  if (!title.trim()) return null;
  const oilfield = OILFIELD_TITLE_RE.test(title) || (LABOR_TITLE_RE.test(title) && OILFIELD_TEXT_RE.test(text.slice(0, 6000)));
  const rung = RUNG_RE.test(title) && TRADE_NOUN_RE.test(title);
  if (!oilfield && !rung && !TRADE_TITLE_RE.test(title)) return null;
  // an office / engineering / selling job named after a trade ("Welding Engineer", "HVAC Sales Manager", "Electrical
  // Apprenticeship Instructor") is not the trade's crew work; a "Non-CDL" driver is not a CDL job
  if (NOT_CREW_TITLE_RE.test(title) && !/\boperating\s+engineers?\b/i.test(title)) return null;
  if (/\bnon[- ]?cdl\b/i.test(title) && !oilfield && !rung && !TRADE_TITLE_RE.test(title.replace(/\bnon[- ]?cdl\b/ig, ''))) return null;
  // a posting that itself asks for time in the job ("3+ years of experience as an Electrician/Electrical Apprentice", "6
  // months' previous experience as a welder helper") is not a beginner job, whatever its title or perks say (R38) — a line
  // on an experienced-hire track beside a new-to-industry one, or one marked preferred, does not count
  const asksTime = statesTimeInJob(text);
  const entry = (rung || postingSaysEntryLevel({ title, description: text })) && !asksTime;
  const driving = /\b(?:(?<!non[- ]?)cdl|truck\s+driver|haulers?|tanker|drivers?)\b/i.test(title);
  return { oilfield, entry, rung, driving, asksTime };
}
const TIME_IN_JOB_RE = /\b(?:\d{1,2}|one|two|three|four|five|six|twelve|eighteen)\s*(?:\(\d+\)\s*)?\+?\s*(?:months?|years?|yrs?)['’]?\s+(?:of\s+)?(?:previous\s+|prior\s+|verifiable\s+)?(?:\w+\s+){0,3}?experience\s+(?:as|in|with|working|operating)\b/i;
function statesTimeInJob(text) {
  const track = experiencedTrack(text);
  for (const raw of String(text || '').split('\n')) {
    const l = raw.trim().replace(/^[•*\-]\s*/, '');
    if (!l || !TIME_IN_JOB_RE.test(l) || PREFERRED_RE.test(l) || /\bor\s+equivalent\b|\bequivalent\s+training\b/i.test(l)) continue;
    if (track && track.lines.some((t) => t.includes(l.slice(0, 40)))) continue;
    return true;
  }
  return false;
}

// ── Résumé lines ─────────────────────────────────────────────────────────────────────────────────────────────────
const lineList = (resumeText) => String(resumeText || '').split('\n').map((l) => l.trim()).filter(Boolean);
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, eighteen: 18 };
const num = (x) => (x == null ? null : /^\d/.test(String(x)) ? Number(x) : NUM[String(x).toLowerCase()] ?? null);
// a skills / certifications list line ("Skid steer, plate compactor, shovel") — it names things, it does not show a doing
const LIST_HEAD_RE = /^(?:skills?|tools?|equipment|certifications?|licen[sc]es?|projects?)\s*[:\-–]/i;

// ── Tickets and licences (R1, R2, R5, R9, R11) ──────────────────────────────────────────────────────────────────
// `post`: how a posting names it; `held`: how a résumé line names the same credential; `label`: the exact name shown.
const TICKETS = [
  { key: 'safeland', label: 'SafeLand / PEC Basic Orientation card', post: /\bsafe\s*-?\s*land(?:\s+usa)?\b|\bPEC(?:\s+(?:basic|safeland|core|safety))?\b/i, held: /\bsafe\s*-?\s*land\b|\bPEC\b/i },
  { key: 'h2s', label: 'H2S training card', post: /\bH2S\b(?!\s+(?:monitors?|detectors?|gas\b))/i, held: /\bH2S\b(?!\s+monitors?)/i },
  { key: 'osha10', label: 'OSHA 10-Hour card', post: /\bOSHA[\s-]*10\b/i, held: /\bOSHA[\s-]*10\b/i },
  { key: 'osha30', label: 'OSHA 30-Hour card', post: /\bOSHA[\s-]*30\b/i, held: /\bOSHA[\s-]*30\b/i },
  { key: 'cpr', label: 'CPR / First Aid card', post: /\b(?:CPR|first\s+aid|1st\s+aid)\b(?!\s+kits?)/i, held: /\b(?:CPR|first\s+aid|1st\s+aid)\b(?!\s+kits?)/i },
  { key: 'rigpass', label: 'IADC RigPass card', post: /\brig\s*pass\b/i, held: /\brig\s*pass\b/i },
  { key: 'wellcontrol', label: 'well control certification (IADC WellSHARP)', post: /\bwell\s*sharp\b|\bwell\s+control\s+(?:school|certif\w*|training|card)\b|\bwell\s+control\b(?=[^.]{0,30}\bcertif)/i, held: /\bwell\s*sharp\b|\bwell\s+control\b/i },
  { key: 'twic', label: 'TWIC card', post: /\bTWIC\b/, held: /\bTWIC\b/ },
  { key: 'epa608', label: 'EPA Section 608 certification', post: /\bEPA\s*(?:section\s*)?608\b|\bEPA\s+(?:type\s+(?:I{1,3}|[123])|universal)\b/i, held: /\bEPA\b[^.\n]{0,20}\b(?:608|type\s+(?:I{1,3}|[123])|universal)\b/i },
  // equipment cards: only as a credential ("Forklift Certification", "certifications to operate forklifts", a
  // certifications list) — a forklift in a duty is equipment (R22/R23)
  { key: 'forklift', label: 'forklift certification', post: /\bforklift\s+(?:certification|certificate|certified|card|licen[sc]e|operator\s+certification)\b|\bcertifications?\s+to\s+operate\s+forklifts?\b/i, held: /\bforklift\b[^.\n]{0,30}\b(?:certif\w*|card|licen[sc]e)\b|\b(?:certif\w*|licen[sc]ed)\b[^.\n]{0,20}\bforklift\b/i, listOnly: /\bforklift\b/i },
  { key: 'manlift', label: 'manlift / aerial lift certification', post: /\b(?:man\s*lifts?|aerial\s+lifts?|telehandlers?)\b[^.]{0,20}\b(?:certif\w*|card)\b|\bcertifications?\s+to\s+operate\b[^.]{0,40}\b(?:man\s*lifts?|telehandlers?)\b/i, held: /\b(?:man\s*lift|aerial\s+lift|telehandler)\b[^.\n]{0,30}\b(?:certif\w*|card)\b/i, listOnly: /\bman\s*lifts?\b/i },
  { key: 'dot_medical', label: 'DOT medical card', post: /\bDOT\s+(?:medical|physical|med(?:ical)?\s+card)|\bmedical\s+(?:examiner['’]?s\s+)?(?:card|certificate)\b/i, held: /\bDOT\s+(?:medical|physical)|\bmedical\s+card\b/i },
];
const CRED_LIST_RE = /\b(?:licen[sc]es?|certific\w*|tickets?|cards?)\b/i;
// the posting has new hires get it ("within 90 days of hire", "must be able to obtain", "training provided")
const OBTAIN_LATER_RE = /\b(?:must\s+be\s+able\s+to\s+)?obtain\w*\b|\bwithin\s+(?:\d{1,3}|thirty|sixty|ninety|six)\s+(?:days?|months?)\b|\b(?:will\s+be\s+)?provided\b|\bupon\s+hire\b|\bafter\s+(?:hire|start)\b|\bwe\s+(?:will\s+)?(?:train|certify|pay\s+for)\b/i;
const PREFERRED_RE = /\b(?:preferred|a\s+plus|plus\b|desired|desirable|nice\s+to\s+have|helpful|bonus|given\s+preference|increased\s+wage)\b/i;
const DRIVER_LICENCE_RE = /\bdriver['’]?s?\s+licen[sc]e\b|\bdrivers?\s+licen[sc]e\b|\bclass\s+c\s+(?:driver|licen)/i;
const CDL_RE = /\b(?:CDL|commercial\s+driver['’]?s?\s+licen[sc]e)\b/i;

function cdlClass(s) {
  const m = String(s || '').match(/\bclass\s+([AB])\b(?!\s+or\s+class\s+c)|\bCDL[\s-]+([AB])\b|\b([AB])\s+CDL\b/i);
  return m ? (m[1] || m[2] || m[3]).toUpperCase() : null;
}

// ── Schedule: rotations, travel, long hours (R16, R21) ─────────────────────────────────────────────────────────
const ROT_NUM = '(7|10|14|20|21|28)';
const ROTATION_RE = new RegExp(`\\b${ROT_NUM}\\s*(?:days?\\s+)?on\\s*(?:\\/|,|and|&|-|–|x)?\\s*${ROT_NUM.replace('20|', '4|')}\\s*(?:days?\\s+)?off\\b`, 'i');
const SLASH_ROT_RE = new RegExp(`\\b${ROT_NUM}\\s*\\/\\s*(4|7|10|14|21|28)\\b`);
const ROT_WORD_RE = /\brotation(?:al)?\b|\brotations?\b|\bhitch(?:es)?\b/i;
const TRAVEL_RE = /\b(?:willing(?:ness)?\s+to\s+travel|travel\s+(?:required|requirement\s*:\s*yes|may\s+vary|is\s+required)|must\s+(?:be\s+(?:able|willing)\s+to\s+)?travel|work\s+away\s+from\s+home|away\s+from\s+home|travel\s+to\s+and\s+work\s+in\s+remote|remote\s+(?:job\s+)?locations|extensive\s+(?:amount\s+of\s+)?(?:days|travel))\b/i;
function scheduleItems(s) {
  const out = {};
  const r = s.match(ROTATION_RE);
  if (r) out.rotation = `${r[1]} days on / ${r[2]} days off`;
  else if (ROT_WORD_RE.test(s)) { const sl = s.match(SLASH_ROT_RE); out.rotation = sl ? `${sl[1]} days on / ${sl[2]} days off` : 'a rotation schedule'; }
  if (TRAVEL_RE.test(s)) out.travel = true;
  // hours a day: "12-15 hours per day", "12.5 hour shifts", "shifts up to 12 hours per day", "12-hour tours"
  const d = s.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:-|–|to)\s*(\d{1,2})\s*hours?\s+(?:per|a)\s+day\b/i) || s.match(/\b(?:shifts?\s+(?:of\s+)?up\s+to|up\s+to)\s+(\d{1,2}(?:\.\d)?)\s+hours?\s+(?:per|a)\s+day\b/i) || s.match(/\b(\d{1,2}(?:\.\d)?)[- ]hours?\s+(?:shifts?|tours?|days?)\b/i) || s.match(/\b(\d{1,2}(?:\.\d)?)\s+hours?\s+per\s+day\b/i);
  if (d) { const h = Math.max(Number(d[1]) || 0, Number(d[2]) || 0); if (h >= 10 && h <= 24) { out.hoursDay = h; if (d[2] && Number(d[1]) < h) out.hoursDayText = `${d[1]}–${d[2]}`; } }
  // hours a week: "Approximately 90 hours per week", "30.0 – 100.0 per week", "40-60 hours a week"
  const w = s.match(/\b(\d{2,3})(?:\.0)?\s*(?:-|–|to)\s*(\d{2,3})(?:\.0)?\s*(?:hours?\s+)?(?:per|a)\s+week\b/i) || s.match(/\b(\d{2,3})(?:\.0)?\s+hours?\s+(?:per|a)\s+week\b/i);
  if (w) { const h = Math.max(Number(w[1]) || 0, Number(w[2]) || 0); if (h >= 50 && h <= 120) out.hoursWeek = h; }
  if (/\b7\s+days\s+(?:per|a)\s+week\b/i.test(s)) out.sevenDays = true;
  return out;
}
function scheduleLabel(it) {
  return [it.rotation ? (it.rotation === 'a rotation schedule' ? 'a rotation schedule' : `a ${it.rotation} rotation`) : null, it.travel ? 'travel / work away from home' : null, it.hoursDay ? `${it.hoursDayText || it.hoursDay}-hour days` : null, it.hoursWeek ? `up to ${it.hoursWeek} hours a week` : null, it.sevenDays ? '7-day weeks' : null].filter(Boolean);
}

const COMMIT_RE = /\bcommit(?:ment)?\s+to\b|\bafter\s+(?:the\s+)?training\b|\bemployment\s+with\s+us\b/i;
const HISTORY_RE = /\b(?:stable|steady|consistent|committed|continuous|verifiable)\s+(?:\w+\s+)?work\s+history\b|\bwork\s+history\b|\bposition\s+of\s+responsibility\b|\bpaid\s+or\s+volunteer\s+work\b|\bwork\s+record\b/i;
const SECOND_CHANCE_RE = /\bsecond[- ]chance\b|\bfair[- ]chance\b|\bcriminal\s+records?\s+(?:are\s+)?encouraged\b|\bwith\s+a\s+criminal\s+record\b[^.]{0,30}\bencouraged\b/i;
const DRUG_RE = /\bdrug\b|\balcohol\s+test/i;
const SCREENER_RE = /^\s*[*•\-]?\s*([A-Z][A-Za-z &/'-]{2,40}):\s*(\d{1,2})\s*(?:year|yr)s?(?:\(s\))?\s*\((Required|Preferred)\)\s*$/;

/**
 * The trade reads of a posting, applied to the constraint list extractConstraints built (`out`, mutated) — only when
 * tradeContext places the posting. `rows`: the requirement rows; `allRows`: every sectioned row (a "Second Chance"
 * sentence sits in a company paragraph); `push`: extractConstraints' de-duplicating push.
 */
export function applyTradeConstraints(text, jobTitle, { rows = [], allRows: allRowsIn = [], out, push }) {
  const ctx = tradeContext(jobTitle, text);
  if (!ctx) return;
  const allRows = typeof allRowsIn === 'function' ? allRowsIn() : allRowsIn;
  // 1. what the general reader read, retagged for the trades
  for (let i = out.length - 1; i >= 0; i--) {
    const c = out[i];
    const s = String(c.sentence || '');
    if (c.kind === 'schedule' && c.items) {
      // "12.5 hour shifts" is not a "5-hour shift minimum" (the general reader read the digits after the point)
      const bad = c.items.filter((it) => { const m = String(it).match(/^(\d+)-hour shift minimum$/); return m && new RegExp(`\\d\\.${Number(m[1])}\\s*[- ]?hours?`, 'i').test(s); });
      if (bad.length) { c.items = c.items.filter((it) => !bad.includes(it)); c.label = c.items.join(', '); c.value = c.items.join('|'); if (!c.items.length) { out.splice(i, 1); continue; } }
    }
    if (c.kind === 'years') {
      // "Commit to two years of full-time employment with us after training" is the employer's terms, not a requirement
      if (COMMIT_RE.test(s) && !/\bexperience\b/i.test(s.slice(0, Math.max(0, s.search(COMMIT_RE))))) { out.splice(i, 1); continue; }
      if (/\bdriving\s+experience\b|\bclean\s+driving\b/i.test(`${c.label} ${s}`)) { out[i] = { kind: 'background', label: `${c.value}+ years of clean driving experience`, value: 'clean driving record', gate: false, importance: c.importance, sentence: s, trade: { record: true, years: c.value } }; continue; }
      if (HISTORY_RE.test(`${c.label} ${s}`)) { c.trade = { history: { months: Math.round((Number(c.value) || 1) * 12) } }; c.gate = false; continue; }
      // an entry posting (it trains beginners, or the title is an apprentice / helper / trainee rung): a years line it does not
      // state as a hard requirement never refuses (R38 keeps a stated one — "3+ years as an Electrician" — a gate)
      if (ctx.entry && (PREFERRED_RE.test(s) || /\b(?:or\s+equivalent|and\/or\s+equivalent|equivalent\s+training|or\s+training)\b/i.test(s))) c.gate = false;
    }
    if (c.kind === 'certification') {
      const lab = `${c.label} ${c.value}`;
      if (CDL_RE.test(lab) || (/\bclass\s+[AB]\b/i.test(lab) && !/\bclass\s+c\b/i.test(s))) {
        const cls = cdlClass(lab) || cdlClass(s);
        c.trade = { licence: 'cdl', cls };
        c.label = cls ? `Class ${cls} CDL` : 'CDL';
      } else if (DRIVER_LICENCE_RE.test(lab) || /^drivers?\s+licen/i.test(String(c.label))) {
        if (!ctx.driving) { c.trade = { licence: 'driver' }; c.gate = false; c.label = "valid driver's license"; }
      } else if (/\bendorsement/i.test(lab)) {
        c.trade = { licence: 'endorsement' };
      } else {
        const t = TICKETS.find((k) => k.post.test(lab) || (k.listOnly && k.listOnly.test(lab) && CRED_LIST_RE.test(s)));
        if (t) { c.trade = { ticket: t.key }; c.label = t.label; if (PREFERRED_RE.test(s)) { c.importance = 'preferred'; c.gate = false; } }
      }
      if (c.trade && c.trade.licence !== 'driver' && OBTAIN_LATER_RE.test(s) && !/\bcurrently\s+(?:hold|pursuing)\b/i.test(s)) { c.trade.obtainLater = true; c.gate = false; }
      // "Willingness to pursue or currently pursuing a plumbing license" is not a license the person must hold (R38 keeps
      // a license the posting requires now)
      if (/\bwilling(?:ness)?\s+to\s+(?:pursue|obtain|get|earn)\b|\bpursu(?:e|ing)\b/i.test(s) && !(c.trade && c.trade.licence === 'cdl')) { c.gate = false; c.importance = 'preferred'; c.trade = { ...(c.trade || {}), pursue: true }; }
    }
    if (c.kind === 'background') {
      if (/\bmvr\b|motor\s+vehicle|driving\s+record/i.test(`${c.label} ${s}`) && !DRUG_RE.test(c.label)) { c.trade = { record: true }; c.label = 'clean driving record (MVR)'; }
      else c.trade = { readiness: DRUG_RE.test(`${c.label}`) ? 'drug' : 'background' };
    }
  }
  // 2. what the general reader does not read
  const has = (pred) => out.some(pred);
  const sched = { items: {}, sentence: '' };
  for (const r of rows) {
    const s = String(r.sentence || '');
    const importance = r.importance === 'preferred' || PREFERRED_RE.test(s) ? 'preferred' : 'required';
    // tickets the general list does not know (H2S, SafeLand/PEC, RigPass, TWIC, a manlift card…), one row per ticket
    for (const t of TICKETS) {
      const hit = t.post.test(s) || (t.listOnly && t.listOnly.test(s) && CRED_LIST_RE.test(`${s} ${r.kind === 'preferred' ? 'certification' : ''}`) && s.split(/\s+/).length <= 12);
      if (!hit || has((c) => c.kind === 'certification' && c.trade && c.trade.ticket === t.key)) continue;
      const later = OBTAIN_LATER_RE.test(s) && !/\bcurrently\b/i.test(s);
      push({ kind: 'certification', label: t.label, value: t.label.toLowerCase(), gate: false, importance: later ? 'preferred' : importance, sentence: s, trade: { ticket: t.key, ...(later ? { obtainLater: true } : {}) } });
    }
    // a CDL a hauling job names without the word ("Must have Class A")
    if (ctx.driving && !has((c) => c.trade && c.trade.licence === 'cdl')) {
      const m = s.match(/\b(?:must\s+have|requires?|need)\s+(?:a\s+)?(?:valid\s+)?class\s+([AB])\b(?!\s+or\s+class\s+c)/i) || s.trim().match(/^class\s+([AB])(?:\s+(?:CDL|licen[sc]e))?\.?$/i);
      if (m) push({ kind: 'certification', label: `Class ${m[1].toUpperCase()} CDL`, value: `class ${m[1].toLowerCase()} cdl`, gate: true, importance: 'required', sentence: s, trade: { licence: 'cdl', cls: m[1].toUpperCase() } });
    }
    const it = scheduleItems(s);
    if (Object.keys(it).length) { Object.assign(sched.items, Object.fromEntries(Object.entries(it).filter(([k]) => !(k in sched.items)))); if (!sched.sentence) sched.sentence = s; }
  }
  // rotations / travel / long hours are often stated outside a requirement block ("What to expect", "Shift is a 10 on and 4
  // off schedule")
  for (const r of allRows) {
    const s = String(r.sentence || '');
    const it = scheduleItems(s);
    if (Object.keys(it).length) { for (const [k, v] of Object.entries(it)) if (!(k in sched.items)) sched.items[k] = v; if (!sched.sentence) sched.sentence = s; }
    if (ctx.driving && !has((c) => c.trade && c.trade.licence === 'cdl')) {
      const m = s.match(/\b(?:must\s+have|requires?|need)\s+(?:a\s+)?(?:valid\s+)?class\s+([AB])\b(?!\s+or\s+class\s+c)/i) || s.trim().match(/^class\s+([AB])(?:\s+(?:CDL|licen[sc]e))?\.?$/i);
      if (m) push({ kind: 'certification', label: `Class ${m[1].toUpperCase()} CDL`, value: `class ${m[1].toLowerCase()} cdl`, gate: true, importance: 'required', sentence: s, trade: { licence: 'cdl', cls: m[1].toUpperCase() } });
    }
    if (/\bdrug\s+(?:and\s+alcohol\s+)?(?:tests?|screen\w*|testing)\b/i.test(s) && !has((c) => c.trade && c.trade.readiness === 'drug')) push({ kind: 'background', label: 'drug test', value: 'drug test', gate: false, importance: 'required', sentence: s, trade: { readiness: 'drug' } });
    if (SECOND_CHANCE_RE.test(s) && !has((c) => c.trade && c.trade.readiness === 'second_chance')) push({ kind: 'background', label: 'second-chance employer', value: 'second chance', gate: false, importance: 'required', sentence: s, trade: { readiness: 'second_chance' } });
  }
  const labels = scheduleLabel(sched.items);
  if (labels.length) push({ kind: 'schedule', label: labels.join(', '), value: `trade:${labels.join('|')}`, items: labels, gate: false, importance: 'required', sentence: sched.sentence, trade: { schedule: sched.items } });
  // an Indeed screener line ("Mechanical knowledge: 1 year (Required)", "Roustabout: 2 years (Preferred)")
  for (const line of String(text || '').split('\n')) {
    const m = line.match(SCREENER_RE);
    if (!m) continue;
    const field = m[1].trim().toLowerCase();
    const y = Number(m[2]);
    if (has((c) => c.kind === 'years' && String(c.sentence || '').includes(m[1]))) continue;
    const importance = m[3] === 'Required' ? 'required' : 'preferred';
    push({ kind: 'years', label: `${y}+ year${y === 1 ? '' : 's'} of ${field}${/experience|knowledge/.test(field) ? '' : ' experience'}`, value: y, management: false, field, alternatives: [{ degree: 0, years: y, management: false, field, from: line.trim() }], gate: false, importance, sentence: line.trim(), trade: { screener: true, ...(/mechanic/i.test(field) ? { mechanical: true } : {}) } });
  }
}

// ── Judging against the résumé ──────────────────────────────────────────────────────────────────────────────────
// a résumé line that states a mechanical act on a mechanical object (R24): "Changed oil, filters and hydraulic hoses on farm
// equipment", "Rebuilt the engine on a 2004 Chevy Silverado" — never "mechanically inclined"
const MECH_ACT_RE = /\b(?:repair\w*|rebuil\w*|maintain\w*|maintenance|diagnos\w*|replac\w*|servic\w*|overhaul\w*|troubleshoot\w*|fix\w*|chang\w*\s+(?:the\s+)?(?:oil|filters?|brakes?|tires?|belts?|hoses?)|oil\s+changes?|tune[- ]?ups?|preventive\s+maintenance|PMCS|weld\w*|sharpen\w*|install\w*)\b/i;
const MECH_OBJ_RE = /\b(?:engines?|motors?|pumps?|hydraulic\w*|vehicles?|trucks?|trailers?|tractors?|balers?|swathers?|combines?|equipment|machinery|machines?|generators?|mowers?|blades?|brakes?|transmissions?|compressors?|valves?|hitch(?:es)?|gates?|forklifts?|cars?|silverado|chevy|ford|diesel|oil|filters?|hoses?|belts?|tires?|axles?|bearings?|gearbox\w*|carburet\w*|hvac|furnaces?|condensers?|wiring|circuits?|pipes?|fittings?|fixtures?|faucets?|toilets?|water\s+heaters?)\b/i;
export function mechanicalLines(resumeText) {
  return lineList(resumeText).filter((l) => !LIST_HEAD_RE.test(l) && MECH_ACT_RE.test(l) && MECH_OBJ_RE.test(l) && !/\b(?:mechanically\s+inclined|mechanical\s+aptitude)\b/i.test(l));
}
// named tools on a doing line or a list (R25)
const TOOL_RE = /\b(?:grinders?|sawz?all|saw-?zall|impact(?:\s+(?:drivers?|wrench(?:es)?|guns?))?|(?:pipe\s+|torque\s+)?wrench(?:es)?|torch(?:es)?|chainsaws?|circular\s+saws?|saws?|drills?|hammers?|sledge\w*|pry\s*bars?|levels?|tape\s+measures?|trimmers?|edgers?|blowers?|nail\s+guns?|pliers|screwdrivers?|sockets?|ratchets?|jacks?|hoists?|winch(?:es)?|jackhammers?|shovels?|picks?|post\s+hole\s+diggers?|welders?|welding\s+machines?|multimeters?|meters?|crimpers?|benders?|threaders?|pipe\s+cutters?|cutters?|concrete\s+finishing\s+tools)\b/i;
const GENERIC_TOOL_RE = /\b(?:hand\s+tools|power\s+tools|common\s+tools)\b/i;
// equipment a posting asks someone to operate (R22, R23)
const EQUIPMENT = [
  ['forklift', /\bforklifts?\b|\bfork\s*lifts?\b|\breach\s+trucks?\b/i], ['skid steer', /\bskid\s*-?\s*steers?\b|\bbobcats?\b/i], ['telehandler', /\btelehandlers?\b|\bteleporters?\b|\blulls?\b/i],
  ['manlift', /\bman\s*lifts?\b|\baerial\s+lifts?\b|\bboom\s+lifts?\b|\bscissor\s+lifts?\b/i], ['backhoe', /\bbackhoes?\b/i], ['excavator', /\b(?:mini[- ]?)?excavators?\b|\btrackhoes?\b/i],
  ['trencher', /\btrenchers?\b/i], ['auger', /\baugers?\b/i], ['bucket truck', /\bbucket\s+trucks?\b/i], ['digger derrick', /\bdigger\s+derricks?\b/i], ['crane', /\bcranes?\b/i],
  ['tractor', /\btractors?\b/i], ['loader', /\b(?:front[- ]end\s+|wheel\s+)?loaders?\b/i], ['dozer', /\b(?:bull)?dozers?\b/i], ['plate compactor', /\bplate\s+compactors?\b|\bcompactors?\b|\brollers?\b/i],
  ['pallet jack', /\bpallet\s+jacks?\b/i], ['iron roughneck', /\biron\s+roughnecks?\b/i], ['tongs', /\btongs\b/i], ['mud pump', /\bmud\s+pumps?\b/i], ['frac pump', /\bfrac\s+pumps?\b|\bblenders?\b|\bhydration\s+units?\b|\bsand\s+silos?\b/i],
  ['transfer pump', /\btransfer\s+pumps?\b/i], ['generator', /\bgenerators?\b/i], ['truck with trailer', /\bgrain\s+trucks?\b|\b(?:cargo|dump|flatbed|box)\s+trucks?\b|\btrucks?\s+(?:and|with)\s+trailers?\b|\bM10\d{2}\b/i],
];
const OPERATED_RE = /\b(?:operat\w*|ran|run|running|drove|drive|driving|driven|used|use|using|certified\s+on|run(?:ning)?)\b/i;
const AROUND_RE = /\b(?:assist\w*|help\w*|worked\s+(?:around|with|alongside|near)|spott\w*|signal\w*|around|support\w*)\b/i;
const OPERATE_ASK_RE = /\b(?:operat\w*|run(?:ning)?|use|using|drive|driving|experience\s+(?:with|operating|running))\b/i;
function equipmentIn(text) { return EQUIPMENT.filter(([, re]) => re.test(text)).map(([name]) => name); }
function equipmentLine(resumeText, name) {
  const re = (EQUIPMENT.find(([n]) => n === name) || [])[1];
  if (!re) return null;
  const lines = lineList(resumeText).filter((l) => re.test(l));
  const operated = lines.find((l) => !LIST_HEAD_RE.test(l) && OPERATED_RE.test(l) && !AROUND_RE.test(l.slice(0, Math.max(0, l.search(re)))));
  if (operated) return { line: operated, how: 'operated' };
  const cert = lines.find((l) => /\bcertif\w*|\bcard\b|\blicen[sc]/i.test(l));
  if (cert) return { line: cert, how: 'operated' };
  const around = lines.find((l) => !LIST_HEAD_RE.test(l));
  if (around) return { line: around, how: 'around' };
  const listed = lines.find((l) => LIST_HEAD_RE.test(l) || /,/.test(l));
  return listed ? { line: listed, how: 'listed' } : null;
}

// physical proof (R20, R21): a named load, outdoor / weather work, heights, long shifts
const LIFT_LINE_RE = /\b(?:lift\w*|carr(?:y|ied|ying)|load\w*|haul\w*|mov(?:e|ed|ing)|bundles?|bales?|boxes?)\b[^.\n]{0,60}?\b(\d{2,3})\s*\+?\s*(?:lbs?\.?|pounds?)\b/i;
const OUTDOOR_LINE_RE = /\b(?:outdoors?|outside|all\s+(?:kinds\s+of\s+)?weather|summer\s+heat|heat|summers?|winters?|cold|rain|snow|in\s+the\s+field|field\s+exercises?|convoys?)\b/i;
const HEIGHT_LINE_RE = /\b(?:heights?|roofs?|ladders?|scaffold\w*|fall\s+protection|harness|aerial|elevated)\b/i;
const LONG_DAY_RE = /\b(\d{1,2})[- ]hour\s+(?:days?|shifts?|tours?|nights?|routes?|night\s+shifts?)\b/i;
const LONG_WEEK_RE = /\b(\d{2,3})(?:\s*(?:-|–|to)\s*(\d{2,3}))?\s*(?:\+\s*)?hours?\s+(?:a|per|each)?\s*weeks?\b|\b(\d{2,3})(?:\s*(?:-|–|to)\s*(\d{2,3}))?\s+hour\s+weeks?\b/i;
function bestLift(resumeText) {
  let best = null;
  for (const l of lineList(resumeText)) { const m = l.match(LIFT_LINE_RE); if (m && !LIST_HEAD_RE.test(l)) { const n = Number(m[1]); if (!best || n > best.n) best = { n, line: l }; } }
  return best;
}
const doingLine = (resumeText, re) => lineList(resumeText).find((l) => re.test(l) && !LIST_HEAD_RE.test(l) && !/^(?:summary|objective)\b/i.test(l) && /\b[a-z]+(?:ed|ing)\b|\b(?:ran|drove|run|carry|lift|work|tore|led|did|cut|dug|set|hung)\b/i.test(l)) || null;
function longDay(resumeText, need = 10) {
  for (const l of lineList(resumeText)) {
    const d = l.match(LONG_DAY_RE);
    if (d && Number(d[1]) >= Math.min(need, 12) && Number(d[1]) <= 24) return { line: l, hours: Number(d[1]) };
  }
  return null;
}
function longWeek(resumeText, need = 50) {
  for (const l of lineList(resumeText)) {
    const w = l.match(LONG_WEEK_RE);
    const h = w ? Math.max(Number(w[1] || w[3]) || 0, Number(w[2] || w[4]) || 0) : 0;
    if (h >= Math.min(need, 55) && h <= 120) return { line: l, hours: h };
    if (/\b(?:overtime|doubles?|double\s+shifts?)\b/i.test(l) && !LIST_HEAD_RE.test(l)) return { line: l, hours: null };
  }
  return null;
}
/** What the résumé's lines show of a set of physical / long-hours items: { shown: [{item, line}], partly: [{item, line, why}], open: [item] }. */
export function physicalProof(items, resumeText) {
  const shown = [], partly = [], open = [];
  for (const raw of items) {
    const item = String(raw);
    const lift = item.match(/\blift\w*\s+(?:up\s+to\s+)?(\d{2,3})/i) || item.match(/\b(\d{2,3})\s*(?:-|–)?\s*(\d{2,3})?\s*(?:lbs?|pounds?)\b/i);
    if (lift) {
      const need = Math.max(Number(lift[1]) || 0, Number(lift[2]) || 0);
      const b = bestLift(resumeText);
      if (b && b.n >= need) shown.push({ item, line: b.line });
      else if (b) partly.push({ item, line: b.line, why: `you show ${b.n} lbs; they ask up to ${need}` });
      else open.push(item);
      continue;
    }
    if (/outdoor|weather|heat|cold/i.test(item)) { const l = doingLine(resumeText, OUTDOOR_LINE_RE); if (l) shown.push({ item, line: l }); else open.push(item); continue; }
    if (/height|ladder|climb/i.test(item)) { const l = doingLine(resumeText, HEIGHT_LINE_RE); if (l) shown.push({ item, line: l }); else open.push(item); continue; }
    const hd = item.match(/(\d{1,2}(?:\.\d)?)[- ]hour/i);
    if (hd || /full\s+shift|long\s+hours|extended\s+(?:periods|hours)/i.test(item)) { const l = longDay(resumeText, hd ? Number(hd[1]) : 10); if (l) shown.push({ item, line: l.line }); else open.push(item); continue; }
    const hw = item.match(/up\s+to\s+(\d{2,3})\s+hours\s+a\s+week|(\d{2,3})\s+hours/i);
    if (hw || /7-day/i.test(item)) { const l = longWeek(resumeText, hw ? Number(hw[1] || hw[2]) : 60) || longDay(resumeText, 12); if (l) shown.push({ item, line: l.line }); else open.push(item); continue; }
    open.push(item);
  }
  return { shown, partly, open };
}

// work history (R12, R13)
const BACKGROUNDS = [
  ['farming / ranching', /\b(?:farm\w*|ranch\w*|harvest\w*|agricultur\w*|dairy|feedlot|cattle|livestock|FFA)\b/i],
  ['construction', /\b(?:construction|laborer|concrete|framing|framer|roof\w*|carpent\w*|drywall|demolition|site\s+work|paving|masonry|habitat\s+for\s+humanity)\b/i],
  ['heavy equipment', /\b(?:heavy\s+equipment|equipment\s+operator|skid\s*steer|excavator|backhoe|dozer|loader)\b/i],
  ['military service', /\b(?:U\.?S\.?\s+)?(?:army|navy|marines?|marine\s+corps|air\s+force|coast\s+guard|national\s+guard|military|MOS|\d{2}[A-Z]\b|sergeant|corporal|specialist\s+\(E-\d\))\b/i],
  ['oilfield', /\b(?:oil\s*field|oilfield|roustabout|floorhand|roughneck|rig\b|frac\b|well\s+servic\w*)\b/i],
  ['a trade', /\b(?:welder|welding|electrician|plumb\w*|hvac|mechanic|machinist|millwright|pipefitter|apprentice|diesel)\b/i],
  ['outdoor labor', /\b(?:landscap\w*|lawn\s+care|lawn\s+service|groundskeep\w*|tree\s+(?:service|trimm\w*)|outdoor)\b/i],
  ['mechanical / shop work', /\b(?:mechanic|shop|auto\s+(?:shop|repair)|diesel|maintenance\s+tech\w*|tire\s+tech|lube\s+tech)\b/i],
];
const ASKED_BACKGROUNDS = [
  ['farming / ranching', /\bfarm\w*|\branch\w*|\bagricultur\w*/i], ['construction', /\bconstruction\b/i], ['heavy equipment', /\bheavy\s+equipment\b/i], ['military service', /\bmilitary\b|\bveterans?\b|\barmed\s+forces\b/i],
  ['oilfield', /\boil\s*field|\boilfield|\boil\s*(?:&|and)\s*gas\b/i], ['a trade', /\bother\s+trades?\b|\ba\s+trade\b|\btrades?\s+(?:experience|work)\b/i], ['outdoor labor', /\boutdoor\s+(?:labor|work)\b/i], ['mechanical / shop work', /\bmechanical\s+or\s+shop\b|\bshop\s+experience\b|\bmechanical\s+(?:or|and)\s+shop\b/i],
];
function roleBackgrounds(role) {
  const head = `${role.title || ''} ${role.header || ''}`;
  return BACKGROUNDS.filter(([, re]) => re.test(head)).map(([name]) => name);
}
const fmtMonths = (m) => { const y = Math.floor(m / 12), r = m % 12; const ys = y ? `${y} year${y === 1 ? '' : 's'}` : ''; const rs = r ? `${r} month${r === 1 ? '' : 's'}` : ''; return [ys, rs].filter(Boolean).join(' ') || '0 months'; };
const headerLine = (role) => String(role.header || role.title || '').trim();
/** The longest single job (R12): { months, role } or null. */
export function longestJob(profile) {
  const rs = ((profile && profile.roles) || []).filter((r) => r.months && r.title && !/\bvolunteer\b/i.test(`${r.title} ${r.header}`));
  return rs.length ? rs.reduce((a, b) => (b.months > a.months ? b : a)) : null;
}
function historyVerdict(needMonths, profile) {
  const best = longestJob(profile);
  if (best && best.months >= needMonths) return { status: 'shown', line: headerLine(best), why: `${fmtMonths(best.months)} at one job (${best.title}, ${best.span})` };
  const total = Math.round((Number(profile && profile.totalYears) || 0) * 12);
  if (best && total >= needMonths) return { status: 'partly', line: headerLine(best), why: `your jobs add up to ${fmtMonths(total)}, but the longest is ${fmtMonths(best.months)}`, missing: `${fmtMonths(needMonths)} at one job` };
  return { status: 'not_shown', missing: `${fmtMonths(needMonths)} of steady work` };
}
function relatedVerdict(asked, needMonths, profile) {
  const hits = ((profile && profile.roles) || []).map((r) => ({ r, bg: roleBackgrounds(r).filter((b) => asked.includes(b)) })).filter((x) => x.bg.length && x.r.title);
  if (!hits.length) return null;
  const best = hits.reduce((a, b) => ((b.r.months || 0) > (a.r.months || 0) ? b : a));
  const months = best.r.months || 0;
  const why = `${best.bg[0].replace(/^a trade$/, 'trade work')}: ${best.r.title}${best.r.span ? ` (${best.r.span})` : ''}${months ? `, ${fmtMonths(months)}` : ''}`;
  if (!needMonths || months >= needMonths) return { status: 'shown', line: headerLine(best.r), why };
  return { status: 'partly', line: headerLine(best.r), why, missing: `${fmtMonths(needMonths)} of it` };
}

/** Grade a trade-tagged constraint (evaluateConstraints hook). Returns the row's fields, or null for the general path. */
export function gradeTradeConstraint(c, { text, profile }) {
  const t = c.trade;
  if (!t) return null;
  const lines = lineList(text);
  const name = String(c.label || '');
  if (t.readiness) {
    const msg = t.readiness === 'drug' ? `They drug-test before hiring${/random/i.test(c.sentence || '') ? ' and at random' : ''}. This never goes on a résumé — it is here so nothing surprises you.`
      : t.readiness === 'second_chance' ? 'This employer says people with a criminal record are encouraged to apply. Nothing about it goes on a résumé.'
      : 'They run a background check before hiring. This never goes on a résumé.';
    return { status: 'ask', grade: 'cannot_tell', caps: false, factor: 1, gate: false, note: true, claimable: false, readiness: t.readiness, message: msg, sentence: msg };
  }
  if (t.record) {
    const l = lines.find((x) => /\bclean\s+(?:driving\s+)?record\b|\bno\s+(?:accidents|tickets|violations)\b|\bzero\s+accidents\b/i.test(x));
    const yrs = t.years ? `at least ${t.years} years of clean driving` : 'a clean driving record (MVR)';
    if (l) { const m = `They ask for ${yrs}; your résumé says "${l.replace(/^[•\-*]\s*/, '')}".`; return { status: 'met', grade: 'met', caps: false, factor: 1, gate: false, line: l, why: 'This line shows it.', message: m, sentence: m }; }
    const m = `They check for ${yrs}. Résumés don't list it — say so only if it is true; violations never go on a résumé.`;
    return { status: 'ask', grade: 'cannot_tell', caps: false, factor: 1, gate: false, question: t.years ? `Have you had a driver's license for at least ${t.years} years with no major violations?` : 'Would your driving record (MVR) be considered clean, with no major violations in the last 3 years?', message: m, sentence: m };
  }
  if (t.licence === 'driver') {
    const l = lines.find((x) => DRIVER_LICENCE_RE.test(x) || /\bclass\s+[ABC]\b/i.test(x) && /licen[sc]e/i.test(x));
    if (l) { const m = `They ask for a valid driver's license; your résumé lists "${l.replace(/^[•\-*]\s*/, '')}".`; return { status: 'met', grade: 'met', caps: false, factor: 1, gate: false, line: l, why: 'This line shows it.', message: m, sentence: m }; }
    const m = "They ask for a valid driver's license — résumés rarely list one. Say so if you have it.";
    return { status: c.importance === 'required' ? 'unmet' : 'ask', grade: 'cannot_tell', caps: false, factor: 1, gate: false, byNature: true, question: "Do you hold a valid driver's license? Which state?", message: m, sentence: m };
  }
  if (t.licence === 'cdl' || t.licence === 'endorsement') {
    if (t.obtainLater) { const m = `They have new hires get ${name.replace(/^an?\s+/i, 'a ')} after starting (${(String(c.sentence || '').match(OBTAIN_LATER_RE) || ['after hire'])[0]}) — you don't need it to apply.`; return { status: 'ask', grade: 'cannot_tell', caps: false, factor: 1, gate: false, question: 'Do you hold a CDL or a CDL learner\'s permit already?', message: m, sentence: m }; }
    const no = lines.find((x) => /\bno\s+CDL\b|\bnon[- ]CDL\b/i.test(x));
    const permit = lines.find((x) => CDL_RE.test(x) && /\bpermit\b|\bCLP\b|\blearner/i.test(x));
    const held = lines.find((x) => CDL_RE.test(x) && !/\bno\s+CDL\b|\bnon[- ]CDL\b/i.test(x) && !/\bpermit\b|\bCLP\b|\blearner/i.test(x) && (t.licence !== 'cdl' || !t.cls || cdlClass(x) === t.cls || (t.cls === 'B' && cdlClass(x) === 'A')));
    const pref = c.importance && c.importance !== 'required';
    const q = 'Do you hold a CDL? Which class and endorsements?';
    if (held && t.licence === 'cdl') { const m = `They ask for ${name}; your résumé lists "${held.replace(/^[•\-*]\s*/, '')}".`; return { status: 'met', grade: 'met', caps: false, factor: 1, line: held, why: 'This line shows it.', message: m, sentence: m }; }
    if (t.licence === 'endorsement') {
      const words = String(c.label || '').toLowerCase().match(/hazmat|tanker|doubles|passenger|air\s+brakes?|\b[hnptx]\b/g) || [];
      const res = words.map(endorsementRe).filter(Boolean);
      const l = lines.find((x) => CDL_RE.test(x) && res.length === words.length && res.every((re) => re.test(x)));
      if (l) { const m = `Your résumé lists "${l.replace(/^[•\-*]\s*/, '')}".`; return { status: 'met', grade: 'met', caps: false, factor: 1, line: l, why: 'This line shows it.', message: m, sentence: m }; }
      const m = pref ? `Preferred, not required: ${name}. Say which endorsements you hold, if any.` : `They ask for ${name}; your résumé does not list it.`;
      return { status: pref ? 'ask' : 'unmet', grade: 'not_shown', caps: false, factor: pref ? 0.97 : 0.8, namedMissing: true, question: q, message: m, sentence: m };
    }
    if (permit) { const m = `They ask for ${name}; you list a CDL learner's permit — a permit is not the license.`; return { status: pref ? 'ask' : 'unmet', grade: 'partly', caps: false, factor: pref ? 0.97 : 0.75, line: permit, question: q, message: m, sentence: m }; }
    if (pref) { const m = `Preferred, not required: ${name}. Say so if you hold one.`; return { status: 'ask', grade: 'not_shown', caps: false, factor: 0.97, gate: false, namedMissing: true, question: q, message: m, sentence: m }; }
    const m = no ? `Requires ${/^[AEIOU]/i.test(name) ? 'an' : 'a'} ${name}; your résumé says you do not hold a CDL.` : `Requires ${/^[AEIOU]/i.test(name) ? 'an' : 'a'} ${name}; your résumé does not list one.`;
    return { status: 'unmet', grade: 'not_shown', caps: !!no, factor: 0.5, gate: true, question: no ? undefined : q, message: m, sentence: m };
  }
  if (t.ticket) {
    const tk = TICKETS.find((k) => k.key === t.ticket);
    const l = tk ? lines.find((x) => tk.held.test(x) && !/\b(?:regulations?|standards?|compliance|guidelines|monitors?)\b/i.test(x.replace(tk.held, ''))) : null;
    if (l) { const m = `They ask for ${name}; your résumé lists "${l.replace(/^[•\-*]\s*/, '')}".`; return { status: 'met', grade: 'met', caps: false, factor: 1, gate: false, line: l, why: 'This line shows it.', message: m, sentence: m }; }
    const q = `Do you hold ${/^(?:[aeiou]|H2S|OSHA|IADC|EPA|RigPass)/i.test(name) ? 'an' : 'a'} ${name}?`;
    if (t.obtainLater) { const m = `They have new hires get ${name} on the job (${(String(c.sentence || '').match(OBTAIN_LATER_RE) || ['after hire'])[0]}) — you don't need it to apply.`; return { status: 'ask', grade: 'cannot_tell', caps: false, factor: 1, gate: false, question: q, message: m, sentence: m }; }
    if (c.importance && c.importance !== 'required') { const m = `Preferred, not required: ${name}. It is not on your résumé — say so if you hold it.`; return { status: 'ask', grade: 'not_shown', caps: false, factor: 0.97, gate: false, namedMissing: true, question: q, message: m, sentence: m }; }
    const m = `They ask for ${name}; your résumé does not list it.`;
    return { status: 'unmet', grade: 'not_shown', caps: false, factor: 0.85, gate: false, question: q, message: m, sentence: m };
  }
  if (t.pursue) {
    const m = `They want someone working toward ${/^an?\s/i.test(name) ? name : `a ${name}`} — you don't need to hold it to apply.`;
    return { status: 'ask', grade: 'cannot_tell', caps: false, factor: 1, gate: false, message: m, sentence: m };
  }
  if (t.history) {
    const v = historyVerdict(t.history.months, profile);
    const m = v.status === 'shown' ? `They ask for ${fmtMonths(t.history.months)} of steady work; your résumé shows ${v.why}.` : v.status === 'partly' ? `They ask for ${fmtMonths(t.history.months)} at one job; ${v.why}.` : `They ask for ${fmtMonths(t.history.months)} of steady work; your résumé shows no dated job that long.`;
    return { status: v.status === 'shown' ? 'met' : 'unmet', grade: v.status === 'shown' ? 'met' : v.status, caps: false, factor: v.status === 'shown' ? 1 : v.status === 'partly' ? 0.9 : 0.8, gate: false, ...(v.line ? { line: v.line, why: v.why } : {}), message: m, sentence: m };
  }
  if (t.screener && t.mechanical) {
    const need = Math.round((Number(c.value) || 1) * 12);
    const mech = ((profile && profile.roles) || []).filter((r) => (r.bullets || []).some((b) => MECH_ACT_RE.test(b) && MECH_OBJ_RE.test(b)));
    const months = mech.reduce((s, r) => s + (r.months || 0), 0);
    const any = mechanicalLines(text);
    if (mech.length && months >= need) { const r = mech[0]; const l = (r.bullets || []).find((b) => MECH_ACT_RE.test(b) && MECH_OBJ_RE.test(b)); const m = `They ask for ${c.value}+ year of mechanical work; your résumé shows it at ${r.title} (${fmtMonths(months)}): "${String(l).replace(/^[•\-*]\s*/, '')}".`; return { status: 'met', grade: 'met', caps: false, factor: 1, line: l, why: m, message: m, sentence: m }; }
    if (any.length) { const m = `They ask for ${c.value}+ year of mechanical work; your résumé shows mechanical work ("${any[0].replace(/^[•\-*]\s*/, '')}") but not for that long in a dated job.`; return { status: 'unmet', grade: 'partly', caps: false, factor: 0.85, line: any[0], message: m, sentence: m }; }
    const m = `They ask for ${c.value}+ year of mechanical work; no line on your résumé shows repairing or maintaining engines, vehicles or equipment.`;
    return { status: 'unmet', grade: 'not_shown', caps: false, factor: c.importance === 'required' ? 0.75 : 0.95, message: m, sentence: m };
  }
  if (t.schedule) {
    const it = t.schedule;
    const proof = physicalProof([it.hoursDay ? `${it.hoursDayText || it.hoursDay}-hour days` : null, it.hoursWeek ? `up to ${it.hoursWeek} hours a week` : null, it.sevenDays ? '7-day weeks' : null].filter(Boolean), text);
    const avail = lines.find((x) => /^availab\w*|\bavailable\s+for\b/i.test(x) && /\brotation|\btravel|\b\d{1,2}\s*\/\s*\d{1,2}\b|\bon\s+call\b/i.test(x));
    const asks = [it.rotation ? (it.rotation === 'a rotation schedule' ? 'work the rotation' : `work a ${it.rotation} rotation`) : null, it.travel ? 'travel and be away from home' : null].filter(Boolean);
    const shownLines = proof.shown.map((p) => p.line);
    const allShown = !proof.open.length && !proof.partly.length && (!asks.length || !!avail);
    const said = shownLines.length ? ` Your résumé shows long hours: "${shownLines[0].replace(/^[•\-*]\s*/, '')}".` : '';
    const intro = it.rotation || it.hoursDay || it.hoursWeek || it.sevenDays ? `This job runs ${c.label}` : 'This job means travel and time away from home';
    const m = allShown ? `${intro}; your résumé covers it.${said}` : `${intro}.${said}${asks.length ? ` Only you can say whether you can ${asks.join(' and ')}.` : proof.open.length ? ' Say so if you have worked hours like that.' : ''}`;
    const q = it.rotation && it.rotation !== 'a rotation schedule' ? `Can you work a ${it.rotation.replace(' days on / ', '-days-on / ').replace(' days off', '-days-off')} rotation${it.travel ? ', away from home' : ''}?` : it.rotation ? `Can you work a rotation schedule${it.travel ? ' away from home' : ''}?` : it.travel ? 'Can you travel and work away from home?' : `Have you regularly worked ${it.hoursDay ? `${it.hoursDay}-hour days` : 'long hours'}?`;
    return { status: allShown ? 'met' : 'ask', grade: allShown ? 'met' : 'cannot_tell', caps: false, factor: 1, gate: false, ...(shownLines.length ? { line: shownLines[0], why: 'This line shows the long hours.' } : avail ? { line: avail, why: 'Your availability line covers it.' } : {}), question: allShown ? undefined : q, message: m, sentence: m };
  }
  return null;
}

/** Physical constraint rows proven by concrete résumé lines (R20) — evaluateConstraints hook for a trade posting. */
export function gradeTradePhysical(c, { text }) {
  const items = (c.items && c.items.length ? c.items : [c.label]).filter(Boolean);
  const p = physicalProof(items, text);
  if (!p.shown.length && !p.partly.length) {
    // R20: never "Able to lift 50 lbs" with no job attached — the person says where they did it
    const m = `Physical requirement: ${c.label}. Only you can say — if you did work like that at a job, add it to that job in your own words (what you lifted, where you worked outdoors).`;
    const lift = (c.items || []).find((x) => /^lift\s/.test(x));
    return { status: 'ask', grade: 'cannot_tell', caps: false, factor: 1, gate: false, question: lift ? `At which job did you regularly ${lift.replace(/^lift\s+/, 'lift about ')}? What did you lift?` : undefined, message: m, sentence: m };
  }
  const quote = (x) => `"${String(x).replace(/^[•\-*]\s*/, '')}"`;
  const shownBits = p.shown.map((x) => `${x.item} (${quote(x.line)})`);
  if (!p.open.length && !p.partly.length) { const m = `Physical requirement: ${c.label}. Your résumé shows it: ${shownBits.join('; ')}.`; return { status: 'met', grade: 'met', caps: false, factor: 1, gate: false, line: p.shown[0].line, why: 'This line shows it.', message: m, sentence: m }; }
  const m = `Physical requirement: ${c.label}.${shownBits.length ? ` Your résumé shows ${shownBits.join('; ')}.` : ''}${p.partly.length ? ` ${p.partly.map((x) => `${x.item}: ${x.why} (${quote(x.line)})`).join('; ')}.` : ''}${p.open.length ? ` Only you can say: ${p.open.join(', ')}.` : ''}`;
  return { status: 'ask', grade: p.partly.length ? 'partly' : 'cannot_tell', caps: false, factor: 1, gate: false, ...(p.shown[0] || p.partly[0] ? { line: (p.shown[0] || p.partly[0]).line } : {}), message: m, sentence: m };
}

// ── The statement pass ───────────────────────────────────────────────────────────────────────────────────────────
const MECH_ASK_RE = /\bmechanical(?:ly)?\s+(?:aptitude|knowledge|abilit\w*|skills?|inclin\w*|minded|background|experience)\b|\bmechanically\s+inclined\b|\bknowledge\s+of\s+machines\s+and\s+tools\b/i;
// The fixed pattern for each endorsement word the label can carry (a lookup, never a pattern built from posting text).
const ENDORSEMENT_RES = { hazmat: /\bhazmat/i, tanker: /\btanker/i, doubles: /\bdoubles/i, passenger: /\bpassenger/i, air: /\bair\s+brakes?/i, h: /\bh\b/i, n: /\bn\b/i, p: /\bp\b/i, t: /\bt\b/i, x: /\bx\b/i };
function endorsementRe(w) { return ENDORSEMENT_RES[/^air/.test(w) ? 'air' : w] || null; }
const CONDITIONS_LINE_RE = /\b(?:exposure|exposed|sounds?|noise|noisy|smells?|odou?rs?|fumes|dust)\b/i;
const TOOLS_ASK_RE = /\b(?:hand\s+(?:and\s+power\s+)?tools|power\s+tools|heavy-duty\s+handheld|long-handled\s+tools|common\s+hand\s+and\s+power\s+tools)\b/i;
const HISTORY_ASK_RE = /\b(?:stable|steady|committed|consistent|verifiable)\s+(?:(?:related|work)\s+)?(?:work\s+)?history\b|\bwork\s+history\b|\bposition\s+of\s+responsibility\b/i;
const RELATED_ASK_RE = /\b(?:related\s+work\s+history|experience\s+is\s+helpful|helpful\s+but\s+not\s+required|preferred\s+but\s+not\s+(?:mandatory|required)|outdoor\s+work\s+experience|or\s+military\s+service)\b/i;
const MANUAL_RE = /\bthrow\s+gears\b|\b(?:10|13|18)[- ]speed\b|\bmanual\s+transmissions?\b/i;
const MONTHS_AS_RE = /\b(\d{1,2}|one|two|three|six|twelve|eighteen)\s*(?:\(\d+\)\s*)?\+?\s*(months?|years?)['’]?\s+(?:of\s+)?(?:previous\s+|prior\s+)?experience\s+(?:as\s+an?|working\s+(?:as|in)\s+an?)\s+([a-z][a-z /-]{2,40}?)(?=[,.;()]|\s+(?:within|in\s+the|position)|$)/i;
const lc = (t) => String(t || '').charAt(0).toLowerCase() + String(t || '').slice(1);
const bare = (l) => String(l || '').replace(/^[•\-*]\s*/, '');

function setRow(r, status, evidence, missing, extra = {}) {
  const next = { ...r, status, evidence, missing };
  delete next.candidate;
  if (status !== 'cannot_tell') delete next.ask;
  return Object.assign(next, extra);
}

/**
 * The trade pass over the judged statements (runOptimizer, after statementVerdicts, before the person's answers): the
 * lines a résumé can prove are judged on the lines that state the act; what only the person can say carries a plain
 * question; a drug test / background check is a readiness note. Returns new statement objects (inputs untouched).
 */
export function tradeStatements(statements, constraints, { resumeText = '', profile = null, ctx = null, jobText = '' } = {}) {
  if (!ctx) return statements;
  const consBy = new Map();
  for (const c of constraints || []) if (c.statementId) consBy.set(c.statementId, [...(consBy.get(c.statementId) || []), c]);
  // an experienced-hire track ("Minimum Qualifications for new to Patterson-UTI (Experienced):") beside a new-to-industry
  // track: its lines are one way in, not a requirement for a beginner
  const track = experiencedTrack(jobText);
  // a duty of an entry posting (it trains beginners, or it is an apprentice / helper / trainee rung) that the résumé does not
  // show is what the job teaches — neither shown nor held against the person
  // (never in a posting that itself asks for time in the job — "3+ years as an Electrician", "6 months' previous experience as
  // a welder helper": that job does not take beginners, whatever its title says)
  const inTrack = (t) => !!track && track.lines.some((l) => l.includes(String(t || '').slice(0, 40)) || String(t || '').includes(l.slice(0, 40)));
  const asksTime = (constraints || []).some((c) => c.kind === 'years' && c.gate && c.importance === 'required' && !c.trade && !inTrack(c.posting_quote)) || (statements || []).some((s) => s.importance === 'required' && MONTHS_AS_RE.test(String(s.text || '')) && !inTrack(s.text));
  const beginners = ctx.entry && !asksTime;
  const taught = (r) => (beginners && r.kind === 'duty' && r.status === 'not_shown' && !r.track ? { ...r, trained: true, note: 'The job teaches this — the posting takes beginners.' } : r);
  const firstLine = String(jobText || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const same = (a, b) => String(a || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === String(b || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return (statements || []).map((st) => taught(judgeTrade(st)));
  function judgeTrade(st) {
    if (st.kind === 'promise') return st;
    const text = String(st.text || '');
    // the posting's own title read as a line ("Operator I - Water Transfer") is not a requirement
    if (firstLine && same(text, firstLine)) return { ...st, display: false };
    const cons = consBy.get(st.id) || [];
    const tradeCons = cons.filter((c) => c.trade);
    // the experienced track
    if (inTrack(text)) {
      if (/^for\s+new\s+to\b/i.test(text)) return { ...st, display: false, track: 'experienced' };
      return { ...st, importance: 'preferred', track: 'experienced', note: 'This is the experienced-hire track; the posting has a separate track for people new to the industry.' };
    }
    if (/^for\s+new\s+to\b/i.test(text) && text.split(/\s+/).length <= 6) return { ...st, display: false };
    // a readiness note: drug / alcohol testing, a background check (R31, R32) — shown, never asked as a résumé fact
    if (DRUG_RE.test(text) && /\btest\w*|\bscreen\w*/i.test(text) && !MECH_ASK_RE.test(text) && text.split(/\s+/).length <= 45) {
      return setRow(st, 'cannot_tell', [], [], { readiness: true, claimable: false, ask: { kind: 'readiness', text: lc(text), note: 'They test before hiring. This never goes on a résumé — it is here so nothing surprises you.' } });
    }
    // a constraint the trade reader graded (licence, ticket, record, history, schedule): the statement follows its row
    const g = tradeCons.find((c) => c.trade && !c.trade.readiness);
    if (g) {
      const status = g.grade === 'met' ? 'shown' : g.grade === 'partly' ? 'partly' : g.grade === 'not_shown' ? 'not_shown' : 'cannot_tell';
      if (status === 'shown') return setRow(st, 'shown', g.line ? [{ line: g.line, why: g.why || g.message }] : [{ why: g.message }], []);
      if (status === 'partly') return setRow(st, 'partly', g.line ? [{ line: g.line, why: g.why || g.message }] : [], [String(g.label || text)]);
      if (status === 'not_shown') return setRow(st, 'not_shown', [], [String(g.label || text)], g.question ? { question: g.question } : {});
      return setRow(st, 'cannot_tell', [], [], { ask: { kind: g.kind === 'schedule' ? 'schedule' : g.kind === 'certification' ? 'certification' : st.ask?.kind || 'trait', text: lc(text), ...(g.question ? { question: g.question } : {}) } });
    }
    if (tradeCons.some((c) => c.trade && c.trade.readiness)) return setRow(st, 'cannot_tell', [], [], { readiness: true, claimable: false, ask: { kind: 'readiness', text: lc(text), note: 'This never goes on a résumé — it is here so nothing surprises you.' } });
    // a duty the posting says comes after training ("Once trained direct traffic in work zones")
    if (beginners && /^once\s+trained\b/i.test(text)) return { ...st, status: 'not_shown', evidence: [], missing: [], trained: true, note: 'The job teaches this — the posting takes beginners.' };
    // R6: years of clean driving ("Have at least 2 years of clean driving experience") — asked, never counted from dates
    if (/\bclean\s+driving\b|\bdriving\s+record\b|\bMVR\b/i.test(text) && !cons.some((c) => c.kind === 'certification' && !c.trade)) {
      const y = text.match(/\b(\d{1,2}|one|two|three)\s+years?\b/i);
      return setRow(st, 'cannot_tell', [], [], { ask: { kind: 'eligibility', text: lc(text), question: y ? `Have you had a driver's license for at least ${num(y[1])} years with no major violations?` : 'Would your driving record (MVR) be considered clean, with no major violations in the last 3 years?' } });
    }
    // R40: English is asked, never listed on a résumé; a commitment / attitude line is the person's to say
    if (/\b(?:speak|read|write|comprehend|communicat\w*)\b[^.]{0,40}\bEnglish\b|\bEnglish\b[^.]{0,20}\b(?:speak|read|write)\w*/i.test(text) && text.split(/\s+/).length <= 30) {
      return setRow(st, 'cannot_tell', [], [], { ask: { kind: 'language', text: lc(text), question: 'Can you speak, read and write English?' } });
    }
    if (/^(?:a\s+)?(?:strong\s+)?(?:commitment|respect|dedication)\s+(?:to|for)\b|\bsafety[- ]minded\b|^willingness\s+to\s+(?:work|learn)\b/i.test(text) && text.split(/\s+/).length <= 14) {
      return setRow(st, 'cannot_tell', [], [], { ask: { kind: 'trait', text: lc(text) } });
    }
    // R16: travel / time away from home is the person's to say
    if (TRAVEL_RE.test(text) || /^travel\s+may\s+vary\b|\bwork\s+may(?:be)?\s+(?:be\s+)?required\s+across\b|\bmaybe\s+required\s+across\b/i.test(text)) {
      return setRow(st, 'cannot_tell', [], [], { ask: { kind: 'schedule', text: lc(text), question: rotationQuestion(text) || 'Can you travel and work away from home?' } });
    }
    // R13: a related background named by the posting — a job title counts here (and only here)
    const askedBg = ASKED_BACKGROUNDS.filter(([, re]) => re.test(text)).map(([n]) => n);
    if (askedBg.length >= 2 && (RELATED_ASK_RE.test(text) || HISTORY_ASK_RE.test(text) || /\bexperience\b/i.test(text))) {
      const mm = text.match(/\b(\d{1,2}|one|two|three|six|twelve)\s*(?:\(\d+\)\s*)?(months?|years?)\b/i);
      const need = mm ? (num(mm[1]) || 0) * (/year/i.test(mm[2]) ? 12 : 1) : 0;
      const v = relatedVerdict(askedBg, need, profile);
      if (v) return setRow(st, v.status, [{ line: v.line, why: v.why }], v.missing ? [v.missing] : []);
      return st.status === 'shown' && !(st.evidence || []).some((e) => e.line && BACKGROUNDS.some(([, re]) => re.test(e.line))) ? setRow(st, 'not_shown', [], [`work in ${askedBg.slice(0, 3).join(', ')}`]) : st;
    }
    // R12: steady work history
    if (HISTORY_ASK_RE.test(text) && !cons.some((c) => c.kind === 'years' && !c.trade)) {
      const mm = text.match(/\b(\d{1,2}|one|two|three|six|twelve)\s*(?:\(\d+\)\s*)?(months?|years?)\b/i);
      const need = mm ? (num(mm[1]) || 1) * (/year/i.test(mm[2]) ? 12 : 1) : 12;
      const v = historyVerdict(need, profile);
      return setRow(st, v.status, v.line ? [{ line: v.line, why: v.why }] : [], v.missing ? [v.missing] : []);
    }
    // R38-shaped: "6 months' previous experience as a welder helper" — months in that job, from the dated roles
    const asM = text.match(MONTHS_AS_RE);
    if (asM) {
      const need = (num(asM[1]) || 1) * (/year/i.test(asM[2]) ? 12 : 1);
      const words = asM[3].toLowerCase().split(/[\s/]+/).filter((w) => w.length > 2 && !/^(?:the|and|or)$/.test(w));
      // a word stem compared as text (whole-word start), never compiled into a pattern from the posting's words
      const stemAt = (title, stem) => { const t = String(title).toLowerCase(); let i = t.indexOf(stem); while (i >= 0) { if (i === 0 || !/[a-z0-9]/.test(t[i - 1])) return true; i = t.indexOf(stem, i + 1); } return false; };
      const same = ((profile && profile.roles) || []).filter((r) => r.title && words.every((w) => stemAt(r.title, w.slice(0, Math.max(4, w.length - 2)))));
      const months = same.reduce((s, r) => s + (r.months || 0), 0);
      if (same.length && months >= need) return setRow(st, 'shown', [{ line: headerLine(same[0]), why: `${fmtMonths(months)} as ${same[0].title}` }], []);
      if (same.length) return setRow(st, 'partly', [{ line: headerLine(same[0]), why: `${fmtMonths(months)} as ${same[0].title}` }], [`${fmtMonths(need)} as ${asM[3].trim()}`]);
      return setRow(st, 'not_shown', [], [`${fmtMonths(need)} as ${asM[3].trim()}`]);
    }
    // R24: mechanical aptitude needs a mechanical act on a mechanical object
    if (MECH_ASK_RE.test(text)) {
      const ml = mechanicalLines(resumeText);
      if (ml.length) return setRow(st, 'shown', [{ line: ml[0], why: 'a repair or maintenance job you did' }], []);
      return setRow(st, 'not_shown', [], ['a line where you repaired or maintained engines, vehicles, pumps or equipment'], { question: 'Have you repaired or maintained engines, vehicles, pumps or farm equipment, at a job or on your own? What exactly?' });
    }
    // R4: a manual-transmission truck
    if (MANUAL_RE.test(text)) {
      const l = lineList(resumeText).find((x) => /\b(?:manual|stick|10|13|18)[- ]?(?:speed|shift|transmission)\b|\bthrow\s+gears\b/i.test(x));
      if (l) return setRow(st, 'shown', [{ line: l, why: 'shows it' }], []);
      return setRow(st, 'not_shown', [], ['driving a manual-transmission truck'], { question: 'Have you driven a manual-transmission truck? Which (10/13/18-speed)?' });
    }
    // R22 / R23: equipment the posting asks someone to operate
    const eq = equipmentIn(text);
    if (eq.length && OPERATE_ASK_RE.test(text)) {
      const found = eq.map((n) => ({ n, hit: equipmentLine(resumeText, n) }));
      const operated = found.filter((x) => x.hit && x.hit.how === 'operated');
      const around = found.filter((x) => x.hit && x.hit.how !== 'operated');
      const missing = found.filter((x) => !x.hit || x.hit.how !== 'operated').map((x) => x.n);
      if (operated.length && (!missing.length || /\b(?:such\s+as|e\.g\.|including|like)\b|,/.test(text))) return setRow(st, operated.length === eq.length ? 'shown' : 'partly', operated.map((x) => ({ line: x.hit.line, why: `you operated a ${x.n}` })).slice(0, 2), operated.length === eq.length ? [] : missing);
      if (operated.length) return setRow(st, 'partly', operated.map((x) => ({ line: x.hit.line, why: `you operated a ${x.n}` })).slice(0, 2), missing);
      if (around.length) return setRow(st, 'partly', [{ line: around[0].hit.line, why: around[0].hit.how === 'listed' ? `you list ${around[0].n} — no job line says you operated it` : `you worked around a ${around[0].n} — the posting asks to operate it` }], missing, { question: `Have you operated ${/^[aeiou]/i.test(missing[0]) ? 'an' : 'a'} ${missing[0]}? At which job?` });
      return setRow(st, 'not_shown', [], missing, { question: `Have you operated ${/^[aeiou]/i.test(missing[0]) ? 'an' : 'a'} ${missing[0]}? At which job?` });
    }
    // R25: hand and power tools — named tools on the résumé. A work-conditions line that only mentions tools ("Exposure
    // to smells associated with sewer and water, sounds associated with power tools") asks nothing of the applicant:
    // no résumé line can show it, so it is left as the judge read it.
    if (TOOLS_ASK_RE.test(text) && !CONDITIONS_LINE_RE.test(text)) {
      const lines = lineList(resumeText);
      const doing = lines.find((l) => !LIST_HEAD_RE.test(l) && TOOL_RE.test(l) && /\b[a-z]+ed\b|\b(?:ran|run|used|use|cut|dug|hung)\b/i.test(l));
      if (doing) return setRow(st, 'shown', [{ line: doing, why: `names the tools you used` }], []);
      const listed = lines.find((l) => TOOL_RE.test(l) || GENERIC_TOOL_RE.test(l));
      if (listed) return setRow(st, 'partly', [{ line: listed, why: 'your skills list names tools — no job line shows you using them' }], ['a job line that names the tools you used']);
      return st.status === 'shown' ? st : setRow(st, 'not_shown', [], ['the tools you have used, by name']);
    }
    // R20 / R21: physical demands and long hours, shown only by concrete lines
    if (st.status === 'cannot_tell' && st.ask && (st.ask.kind === 'physical' || st.ask.kind === 'schedule')) {
      const items = physicalItems(text);
      if (items.length) {
        const p = physicalProof(items, resumeText);
        if (p.shown.length && !p.open.length && !p.partly.length) return setRow(st, 'shown', p.shown.slice(0, 2).map((x) => ({ line: x.line, why: `shows ${x.item}` })), []);
        if (p.shown.length || p.partly.length) return setRow(st, 'partly', [...p.shown, ...p.partly].slice(0, 2).map((x) => ({ line: x.line, why: x.why || `shows ${x.item}` })), [...p.partly.map((x) => x.item), ...p.open]);
      }
      const q = rotationQuestion(text);
      if (q) return { ...st, ask: { ...st.ask, question: q } };
    }
    // a physical demand the judge called not shown ("Ability to stand and walk … up to 12 hours", "comfortable working at
    // heights"): proven by a concrete line, else it is something only the person can say — never a gap in the résumé
    if (st.status === 'not_shown' && PHYS_ASK_RE.test(text) && !/(?:experience|years?|certif\w*|licen[sc]e)/i.test(text)) {
      const items = physicalItems(text);
      const p = items.length ? physicalProof(items, resumeText) : { shown: [], partly: [], open: [] };
      if (p.shown.length && !p.open.length && !p.partly.length) return setRow(st, 'shown', p.shown.slice(0, 2).map((x) => ({ line: x.line, why: `shows ${x.item}` })), []);
      if (p.shown.length || p.partly.length) return setRow(st, 'partly', [...p.shown, ...p.partly].slice(0, 2).map((x) => ({ line: x.line, why: x.why || `shows ${x.item}` })), [...p.partly.map((x) => x.item), ...p.open]);
      return setRow(st, 'cannot_tell', [], [], { ask: { kind: 'physical', text: lc(text) } });
    }
    return st;
  }
}
const PHYS_ASK_RE = /(?:stand(?:ing)?|walk(?:ing)?|lift(?:ing)?|carry(?:ing)?|heights?|climb\w*|outdoors?|all\s+weather|weather\s+conditions|stay\s+alert|on\s+(?:your|their)\s+feet)/i;
function rotationQuestion(text) {
  const it = scheduleItems(text);
  if (it.rotation) return it.rotation === 'a rotation schedule' ? `Can you work a rotation schedule${it.travel ? ' away from home' : ''}?` : `Can you work a ${it.rotation.replace(' days on / ', '-days-on / ').replace(' days off', '-days-off')} rotation${it.travel ? ', away from home' : ''}?`;
  if (it.travel) return 'Can you travel and work away from home?';
  return null;
}
// the physical / long-hours items a statement names
function physicalItems(text) {
  const out = [];
  const lift = text.match(/\b(?:lift\w*|carr\w*|heavy\s+lifting)[^.;]{0,40}?(\d{2,3})(?:\s*(?:-|–)\s*(\d{2,3}))?\s*(?:lbs?\.?|pounds?)/i) || text.match(/\b(\d{2,3})\s*(?:-|–)\s*(\d{2,3})\s*lbs\b/i);
  if (lift) out.push(`lift ${Math.max(Number(lift[1]) || 0, Number(lift[2]) || 0)} lbs`);
  if (/\boutdoors?\b|\ball\s+(?:kinds\s+of\s+)?weather\b|\bweather\s+conditions\b|\bheat\b|\bcold\b/i.test(text)) out.push('outdoor work in all weather');
  if (/\bheights?\b|\bladders?\b|\belevated\b/i.test(text)) out.push('heights / ladders');
  const hd = text.match(/\b(?:up\s+to\s+)?(\d{1,2}(?:\.\d)?)\s*(?:hours?|-hour)\b(?![^.]{0,12}\bweek)/i);
  if (hd && Number(hd[1]) >= 10 && /\b(?:stand|alert|shift|tour|day|work)\w*/i.test(text)) out.push(`${hd[1]}-hour days`);
  const hw = text.match(/\b(\d{2,3})(?:\.0)?\s*(?:-|–)?\s*(\d{2,3})?(?:\.0)?\s*hours?\s+(?:per|a)\s+week\b/i);
  if (hw && Math.max(Number(hw[1]) || 0, Number(hw[2]) || 0) >= 50) out.push(`up to ${Math.max(Number(hw[1]) || 0, Number(hw[2]) || 0)} hours a week`);
  // bending, stooping, kneeling cannot be shown by a résumé line: such a statement stays a question
  if (/\bbend|\bstoop|\bkneel|\bcrawl|\btwist|\bsquat|\bbalanc/i.test(text) && !out.length) return [];
  return out;
}
function experiencedTrack(jobText) {
  const lines = String(jobText || '').split('\n').map((l) => l.trim());
  const start = lines.findIndex((l) => /\bminimum\s+qualifications?\b[^:]{0,60}\(\s*exp\w*\s*\)/i.test(l) || /\bqualifications?\s+for\s+experienced\b/i.test(l));
  if (start < 0 || !lines.some((l) => /\bnew\s+to\s+(?:the\s+)?industry\b|\bno\s+(?:prior\s+)?experience\b|\bentry[- ]level\b/i.test(l))) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/\bminimum\s+qualifications?\s+for\s+new\s+to\s+(?:the\s+)?industry\b/i.test(lines[i])) break;
    out.push(lines[i].replace(/^[•*\-]\s*/, ''));
  }
  return { lines: out.filter(Boolean) };
}

// ── The headline (R38 and readiness) ────────────────────────────────────────────────────────────────────────────
/**
 * What the verdict says first for a trade posting: { flag, readiness } (either may be null).
 *   flag — R38: a posting titled trainee / apprentice / helper / entry level that states a hard minimum (years, months in a
 *          job, a license held now), said plainly at the top;
 *   readiness — an entry posting: what it screens a beginner on (license, rotation, physical work, tickets) that only the
 *          person can say, and what the résumé already shows of it (lines from THIS résumé).
 */
export function tradeHeadline({ ctx, jobTitle = '', constraints = [], statements = [] }) {
  if (!ctx) return null;
  const titled = /\b(?:trainee|apprentice\w*|helper|entry[- ]level)\b/i.test(String(jobTitle || ''));
  let flag = null;
  if (titled) {
    const yrs = constraints.find((c) => c.kind === 'years' && c.gate && c.importance === 'required' && !c.trade);
    const months = statements.find((s) => s.importance === 'required' && MONTHS_AS_RE.test(String(s.text || '')));
    const lic = constraints.find((c) => c.kind === 'certification' && c.importance === 'required' && !(c.trade && (c.trade.licence === 'driver' || c.trade.obtainLater || c.trade.pursue)) && /licen[sc]|identification\s+card|registration|CDL/i.test(`${c.label} ${c.posting_quote || ''}`) && !/\bdriver/i.test(String(c.label)));
    const t = String(jobTitle).replace(/\s*\([^)]*\)/g, '').trim();
    const what = yrs ? `${String(yrs.label).replace(/^(\d+)\+ years?/, '$1+ years')}` : months ? lc(String(months.text).replace(/[.;]$/, '')) : lic ? `${/^[AEIOU]/i.test(lic.label) ? 'an' : 'a'} ${lic.label} now` : null;
    if (what) flag = `This “${t}” posting asks for ${what} — it is not written for someone with no experience.`;
  }
  let readiness = null;
  if (ctx.entry && !flag) {
    const asks = [];
    for (const c of constraints) {
      if (!c.trade || c.grade === 'met' || c.trade.readiness || c.trade.obtainLater) continue;
      if (c.trade.licence === 'driver') asks.push("a valid driver's license");
      else if (c.trade.licence === 'cdl' && c.importance === 'required') asks.push(c.label);
      else if (c.trade.schedule && (c.trade.schedule.rotation || c.trade.schedule.travel)) asks.push(c.trade.schedule.rotation && c.trade.schedule.rotation !== 'a rotation schedule' ? `the ${c.trade.schedule.rotation} rotation` : c.trade.schedule.rotation ? 'the rotation' : 'travel');
      else if (c.trade.record) asks.push('a clean driving record');
    }
    // what the résumé already shows of it: steady work (said as counted from its dates), else a concrete line, quoted
    const hist = constraints.find((c) => c.trade && c.trade.history && c.grade === 'met' && c.why);
    const phys = statements.filter((s) => s.status === 'shown' && s.display !== false && (s.evidence || []).some((e) => e.line && /^shows\s/.test(String(e.why || ''))));
    const shows = [hist ? hist.why : null, phys.length ? `"${bare(phys[0].evidence.find((e) => e.line).line)}"` : null].filter(Boolean);
    const a = [...new Set(asks)].slice(0, 3);
    if (a.length) readiness = `This job trains beginners: it screens on ${a.length === 1 ? a[0] : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`} — say so if true${shows.length ? `; your résumé already shows ${shows.join(' and ')}` : ''}.`;
    // (when the sentence before it already lists what the posting screens on, only the second half is said)
    var readinessShort = `This job trains beginners${shows.length ? `; your résumé already shows ${shows.join(' and ')}` : ''}.`;
  }
  return flag || readiness ? { flag, readiness, readinessShort: readiness ? readinessShort : null } : null;
}
