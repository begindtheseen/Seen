#!/usr/bin/env node
// Seen Pro-tools evaluation harness. See scripts/eval/README.md.
//
//   node scripts/eval/run.mjs                      deterministic tools in-process (+ cached live results)
//   node scripts/eval/run.mjs --prod --accounts F  also call the model-backed tools on seenjobs.io
//   options: --only=01-retail-manager,06-backend-engineer  --tools=fit,optimize  --base=<url>
//            --fresh (ignore the live cache)  --label=baseline  --reserve=5  --pace=15  --wait
//            --grades=<file>  --no-write
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOT = new URL('../../', import.meta.url);
const EVAL = new URL('scripts/eval/', ROOT);
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);
const onlyFx = list(args.only);
const onlyTools = list(args.tools);
const label = typeof args.label === 'string' ? args.label : 'run';
const today = new Date().toISOString().slice(0, 10);
const log = (...a) => console.log(...a);

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────
const FX_DIR = new URL('fixtures/', EVAL);
const raw = Object.fromEntries(readdirSync(FX_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => { const j = JSON.parse(readFileSync(new URL(f, FX_DIR), 'utf8')); return [j.id, j]; }));
const fixtures = Object.values(raw).filter((f) => !onlyFx || onlyFx.includes(f.id)).map((f) => {
  const resumeLines = f.resume || raw[f.resume_from].resume;
  return { ...f, resumeText: resumeLines.join('\n'), jd: f.job.description.join('\n') };
});

const T = await import(new URL('tools.mjs', EVAL).href);
const { checkRecord, CHECKS, SEVERITY } = await import(new URL('checks.mjs', EVAL).href);
const want = (tool) => !onlyTools || onlyTools.includes(tool);

// ── run ───────────────────────────────────────────────────────────────────────────────────────────
const records = [];
let prod = null;
const prodTools = ['interview_prep'];
const P = await import(new URL('prod.mjs', EVAL).href);
if (args.prod) {
  prod = new P.ProdClient({ base: typeof args.base === 'string' ? args.base : 'https://seenjobs.io', accounts: typeof args.accounts === 'string' ? args.accounts : process.env.EVAL_ACCOUNTS_FILE, fresh: !!args.fresh, reserve: Number(args.reserve ?? 5), paceMs: Number(args.pace ?? 15) * 1000, wait: !!args.wait, log });
} else {
  // cached live results only (no network): a re-run still shows the last model outputs, marked cached
  prod = new P.ProdClient({ base: typeof args.base === 'string' ? args.base : 'https://seenjobs.io', fresh: false, log });
  prod.stopped = { interview_prep: 'not run (pass --prod)', interview_prep_jobtext: 'not run (pass --prod)' };
}

for (const fx of fixtures) {
  log(`▸ ${fx.id}`);
  const recs = [];
  const parse = T.runParse(fx); if (want('parse')) recs.push(parse);
  const doc = parse.meta.doc;
  if (fx.pdf && want('parse_pdf')) recs.push(await T.runParsePdf(fx));
  if (want('fit')) recs.push(await T.runFit(fx));
  let opt = null;
  if (want('optimize') || want('humanproof')) { opt = await T.runOptimize(fx); if (want('optimize')) recs.push(opt); }
  if (want('humanproof')) recs.push(await T.runHumanProof(fx, opt));
  if (want('scanner')) recs.push(await T.runScanner(fx));
  if (want('advantage')) recs.push(await T.runAdvantage(fx));
  if (want('insights')) recs.push(await T.runInsights(fx));
  let tailor = null;
  if (doc && (want('tailor') || want('export'))) { tailor = await T.runTailor(fx, doc); if (want('tailor')) recs.push(tailor); }
  if (doc && want('ats_check') && !fx.gold.expect_no_requirements) recs.push(await T.runAtsCheck(fx, doc));
  if (doc && want('export') && !fx.gold.expect_no_requirements) recs.push(await T.runExport(fx, doc, tailor));
  if (want('interview_prep_fallback') && !fx.gold.expect_no_requirements) recs.push(await T.runPrepFallback(fx));
  // live, model-backed
  if (!fx.gold.expect_no_requirements) {
    try {
      if (want('interview_prep')) recs.push(await P.prodInterviewPrep(prod, fx));
      if (args.jobtext && want('interview_prep_jobtext')) recs.push(await P.prodInterviewPrep(prod, fx, { withJobText: true }));
    } catch (e) {
      log(`  live call failed: ${String(e.message || e).slice(0, 200)}`);
      for (const t of prodTools) if (want(t)) recs.push({ tool: t, status: 0, ms: 0, charged: 0, error: null, deferred: `live call failed: ${String(e.message || e).slice(0, 160)}`, output: {}, items: [], meta: {} });
    }
  }
  for (const r of recs) {
    r.fixture = fx.id;
    r.findings = r.deferred ? [] : checkRecord(r, fx);
    // the grade key: the output minus timings, generated ids and timestamps, so only a real content change makes a grade stale
    const VOLATILE = new Set(['ms', 'anchor', 'itemId', 'bulletId', 'built_at', 'at', 'id']);
    r.hash = createHash('sha256').update(JSON.stringify(r.output ?? null, (k, v) => (VOLATILE.has(k) ? undefined : v))).digest('hex').slice(0, 12);
    records.push(r);
    const nf = r.findings.length;
    log(`  ${r.tool.padEnd(24)} ${String(r.status).padStart(3)} ${String(r.ms).padStart(6)}ms  charged ${r.charged}  ${r.deferred ? 'DEFERRED: ' + r.deferred : nf ? nf + ' finding(s)' : 'clean'}${r.from_cache ? ' (cached)' : ''}`);
  }
}
if (T.state.unexpected.length) log('\n⚠ unexpected network calls blocked in-process:', [...new Set(T.state.unexpected)].join(', '));

// ── grades (the expert review) ────────────────────────────────────────────────────────────────────
const gradesFile = typeof args.grades === 'string' ? new URL(args.grades, `file://${process.cwd()}/`) : new URL('grades/baseline.json', EVAL);
const grades = existsSync(gradesFile) ? JSON.parse(readFileSync(gradesFile, 'utf8')) : { grades: {}, defects: [] };
for (const r of records) {
  const g = grades.grades?.[`${r.fixture}|${r.tool}`];
  if (g) { r.grade = g.grade; r.grade_note = g.note; r.grade_stale = g.hash && g.hash !== r.hash; }
}

// ── scorecard ─────────────────────────────────────────────────────────────────────────────────────
const { INVENTORY, ROOT_CAUSES, BAR } = await import(new URL('meta.mjs', EVAL).href);
const tools = [...new Set(records.map((r) => r.tool))];
const ran = (r) => !r.deferred && r.status !== 0;
const sevCount = (rs, sev) => rs.reduce((n, r) => n + r.findings.filter((f) => f.severity === sev).length, 0);
const perTool = tools.map((tool) => {
  const rs = records.filter((r) => r.tool === tool && ran(r));
  const all = records.filter((r) => r.tool === tool);
  const gs = rs.map((r) => r.grade).filter((x) => typeof x === 'number');
  const rt = rs.flatMap((r) => r.meta?.checks || []);
  const rtBullets = rt.reduce((n, c) => n + (c.bullets || 0), 0), rtMissing = rt.reduce((n, c) => n + (c.missing || []).length, 0);
  const row = {
    tool, records: all.length, ran: rs.length, deferred: all.length - rs.length,
    clean: rs.filter((r) => !r.findings.some((f) => f.severity !== 'latency')).length,
    invented: sevCount(rs, 'invented_fact'), traps: sevCount(rs, 'trap'), wrong_field: sevCount(rs, 'wrong_field'),
    misread: sevCount(rs, 'requirement_misread'), broken: sevCount(rs, 'broken_text'), charges: sevCount(rs, 'charge'),
    parse: sevCount(rs, 'parse'), errors: sevCount(rs, 'error'),
    round_trip: rtBullets ? Math.round(1000 * (rtBullets - rtMissing) / rtBullets) / 10 : null,
    pro_branded: rs.reduce((n, r) => n + r.findings.filter((f) => f.check === 'pro_branded').length, 0),
    mean_grade: gs.length ? Math.round(100 * gs.reduce((a, b) => a + b, 0) / gs.length) / 100 : null,
    min_grade: gs.length ? Math.min(...gs) : null, graded: gs.length, stale: rs.filter((r) => r.grade_stale).length,
    p50_ms: rs.length ? rs.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rs.length / 2)] : null,
    max_ms: rs.length ? Math.max(...rs.map((r) => r.ms)) : null,
  };
  const reasons = [];
  if (row.invented) reasons.push(`${row.invented} invented fact(s)`);
  if (row.traps) reasons.push(`${row.traps} trap(s)`);
  if (row.wrong_field) reasons.push(`${row.wrong_field} wrong-field`);
  if (row.broken) reasons.push(`${row.broken} broken-text`);
  if (row.charges) reasons.push(`${row.charges} charge(s) for nothing`);
  if (row.round_trip != null && row.round_trip < 100) reasons.push(`round-trip ${row.round_trip}%`);
  if (row.pro_branded) reasons.push(`${row.pro_branded} branded Pro export(s)`);
  if (row.parse) reasons.push(`${row.parse} parse defect(s)`);
  if (row.errors) reasons.push(`${row.errors} error(s)`);
  if (row.graded && row.mean_grade < BAR.mean_grade) reasons.push(`mean grade ${row.mean_grade} < ${BAR.mean_grade}`);
  if (row.graded && row.min_grade < BAR.min_grade) reasons.push(`a grade of ${row.min_grade} (< ${BAR.min_grade})`);
  if (row.stale) reasons.push(`${row.stale} stale grade(s) — re-grade`);
  if (!row.graded && rs.length) reasons.push('not graded');
  if (!rs.length) reasons.push('not run');
  row.pass = reasons.length === 0;
  row.fail_reasons = reasons;
  return row;
});

const checkNames = Object.keys(CHECKS);
const perCheck = checkNames.map((check) => {
  const applicable = records.filter((r) => ran(r) && (BAR.applies[check] ? BAR.applies[check].includes(r.tool) : true));
  const failing = applicable.filter((r) => r.findings.some((f) => f.check === check));
  return { check, severity: CHECKS[check], applicable: applicable.length, failing: failing.length, findings: failing.reduce((n, r) => n + r.findings.filter((f) => f.check === check).length, 0), pass_rate: applicable.length ? Math.round(1000 * (applicable.length - failing.length) / applicable.length) / 10 : null };
}).filter((c) => c.applicable);

let sha = 'unknown';
try { sha = execSync('git rev-parse --short HEAD', { cwd: ROOT.pathname }).toString().trim(); } catch { /* not a git checkout */ }
const summary = {
  date: today, label, sha, base: prod?.base || null, fixtures: fixtures.map((f) => f.id),
  bar: BAR, per_tool: perTool, per_check: perCheck,
  expert_defects: grades.defects || [],
  records: records.map(({ meta, ...r }) => ({ ...r, meta: { family: meta?.family, remaining: meta?.remaining, probe: meta?.probe ? { status: meta.probe.status, error: meta.probe.body?.error } : undefined, layout: meta?.layout?.method } })),
};

function mdEscape(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ⏎ '); }
const md = [];
md.push(`# Seen Pro tools — evaluation scorecard (${label}, ${today})`, '');
md.push(`Commit \`${sha}\` · ${fixtures.length} fixtures · in-process handlers for the deterministic tools · live model calls on \`${prod?.base}\` for ${prodTools.join(', ')}${args.prod ? '' : ' (from cache — pass --prod to refresh)'}.`, '');
md.push('## Inventory', '', '| Tool | Model? | Cost | Path |', '|---|---|---|---|');
for (const [t, v] of Object.entries(INVENTORY)) md.push(`| ${t} | ${v.model} | ${v.cost || ''} | ${mdEscape(v.path)} |`);
md.push('');
md.push('## Pass bar', '',`0 invented facts · 0 traps · 0 wrong-field outputs · 0 broken-text outputs · 0 charges for nothing · round-trip 100% · mean expert grade ≥ ${BAR.mean_grade} with no grade below ${BAR.min_grade}.`, '');
md.push('| Tool | Model? | Ran | Clean records | Invented | Traps | Wrong field | Misread req. | Broken text | Charges | Parse | Round-trip | Mean grade (min) | p50 / max ms | Verdict |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of perTool) md.push(`| ${r.tool} | ${INVENTORY[r.tool]?.model || '—'} | ${r.ran}/${r.records} | ${r.clean}/${r.ran} | ${r.invented} | ${r.traps} | ${r.wrong_field} | ${r.misread} | ${r.broken} | ${r.charges} | ${r.parse} | ${r.round_trip ?? '—'}${r.pro_branded ? ` (${r.pro_branded} branded Pro)` : ''} | ${r.mean_grade ?? '—'}${r.min_grade != null ? ` (${r.min_grade})` : ''}${r.stale ? ` ⚠${r.stale} stale` : ''} | ${r.p50_ms ?? '—'} / ${r.max_ms ?? '—'} | ${r.pass ? 'PASS' : 'FAIL — ' + r.fail_reasons.join('; ')} |`);
md.push('', '## Pass rate per check', '', '| Check | Class | Records checked | Failing | Findings | Pass rate |', '|---|---|---|---|---|---|');
for (const c of perCheck.sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity))) md.push(`| ${c.check} | ${c.severity} | ${c.applicable} | ${c.failing} | ${c.findings} | ${c.pass_rate}% |`);

md.push('', '## Defects, ranked (expert review + automatic checks)', '');
const sevRank = (s) => { const i = SEVERITY.indexOf(s); return i < 0 ? 99 : i; };
const exp = (grades.defects || []).slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || sevRank(a.severity) - sevRank(b.severity));
exp.forEach((d, i) => {
  md.push(`${i + 1}. **[${d.severity}${d.priority ? ' · ' + d.priority : ''}] ${d.title}** — ${d.tool}; fixtures: ${(d.fixtures || []).join(', ')}`);
  for (const ex of d.examples || []) md.push(`   - \`${ex.fixture}\`: “${mdEscape(ex.text)}”`);
  if (d.cause) md.push(`   - Root cause: ${d.cause}`);
  if (d.fix) md.push(`   - Fix: ${d.fix}`);
});

md.push('', '## Automatic findings by check × tool', '', 'Every finding is in the JSON file next to this one; root cause and fix per group.', '');
const groups = {};
for (const r of records) for (const f of r.findings) (groups[`${f.check}|${r.tool}`] ||= []).push({ fixture: r.fixture, ...f });
for (const key of Object.keys(groups).sort((a, b) => sevRank(CHECKS[a.split('|')[0]]) - sevRank(CHECKS[b.split('|')[0]]) || groups[b].length - groups[a].length)) {
  const [check, tool] = key.split('|');
  const rc = ROOT_CAUSES[key] || ROOT_CAUSES[check] || {};
  md.push(`### ${check} · ${tool} — ${groups[key].length} finding(s) [${CHECKS[check]}]`);
  if (rc.cause) md.push(`Root cause: ${rc.cause}  `);
  if (rc.fix) md.push(`Fix: ${rc.fix}`);
  md.push('');
  for (const f of groups[key]) md.push(`- \`${f.fixture}\` ${f.field}: ${mdEscape(f.detail)} — “${mdEscape(f.text.slice(0, 260))}”`);
  md.push('');
}

md.push('## Expert grades', '', '| Fixture | ' + tools.join(' | ') + ' |', '|---|' + tools.map(() => '---').join('|') + '|');
for (const fx of fixtures) md.push(`| ${fx.id} | ` + tools.map((t) => { const r = records.find((x) => x.fixture === fx.id && x.tool === t); return r ? (r.deferred ? 'deferred' : (r.grade ?? '—') + (r.grade_stale ? '⚠' : '')) : ''; }).join(' | ') + ' |');
md.push('', 'Grade notes (1 = harmful · 3 = usable, no better than free ChatGPT · 5 = worth paying for alone):', '');
for (const r of records.filter((x) => x.grade_note)) md.push(`- \`${r.fixture}\` · ${r.tool} — **${r.grade}**: ${mdEscape(r.grade_note)}`);

md.push('', '## Deferred live calls', '');
const deferred = records.filter((r) => r.deferred);
md.push(deferred.length ? deferred.map((r) => `- ${r.fixture} · ${r.tool}: ${r.deferred}`).join('\n') : 'None.');

if (!args['no-write']) {
  const OUT = new URL('results/', EVAL);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL(`${today}-${label}.json`, OUT), JSON.stringify(summary, null, 2));
  writeFileSync(new URL(`${today}-${label}.md`, OUT), md.join('\n') + '\n');
  // full outputs for reading / grading
  writeFileSync(new URL(`${today}-${label}.outputs.json`, OUT), JSON.stringify(records.map((r) => ({ fixture: r.fixture, tool: r.tool, status: r.status, charged: r.charged, hash: r.hash, output: r.output })), null, 2));
  log(`\nwrote scripts/eval/results/${today}-${label}.{md,json,outputs.json}`);
}
log('\n' + perTool.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.tool.padEnd(24)} ${r.fail_reasons.join('; ')}`).join('\n'));
process.exitCode = perTool.every((r) => r.pass) ? 0 : 1;
