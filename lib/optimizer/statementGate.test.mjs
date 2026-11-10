// R3 — the display gate on requirement statements (statementGate.js) and the segmentation fixes behind it.
// Every rule is pinned by the real sentence that exposed it (audits in director/reports/r-reader.md "R3").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateStatement, splitRunOnStatement, statementConfidence, gluedHeading } from './statementGate.js';
import { isHeadingPhrase, splitPostingPieces, requirementSentences } from './postingSections.js';
import { cleanPastedPosting } from './pastedText.js';
import { extractJobFacts } from './extractJobFacts.js';
import { runOptimizer } from './index.js';
import { displayedRequirementCount, wholeWordsOf, compressStatement } from './statements.js';

const reasons = (t, o) => validateStatement(t, o).reasons;
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const PERSONAS = ['dev', 'maria', 'tasha', 'warehouse', 'nurse', 'electrician', 'accountant', 'admin'].map((n) => readFileSync(new URL(`../fixtures/personas/${n}.txt`, import.meta.url), 'utf8'));

test('validator: the R2 audit misses are never displayable', () => {
  assert.ok(reasons('Active Directory 2016/2019/2022 infrastructure for the Enterprise. Strong experience in PowerShell').includes('run_on'));
  assert.ok(reasons('Lead the evaluation, design', { source: 'Lead the evaluation, design, and development of Active Directory solutions.' }).includes('clipped'));
  assert.ok(reasons('Write and maintain').includes('clipped'));
  assert.ok(reasons('Analyze current Azure Active Directory environment to identify both technical').includes('clipped'));
  assert.ok(reasons('Domain expertise in the areas', { source: 'Domain expertise in the areas of payments, lending and risk.' }).includes('clipped'));
  assert.ok(reasons('And experience in Kubernetes and Terraform').includes('leftover_start'));
  assert.ok(reasons('Leaders who need complete specifications before their team can start').includes('persona'));
  assert.ok(reasons('In 2025, Creatio was named to Inc.’s Best Workplaces list, recognizing our commitment').includes('pitch'));
  assert.ok(reasons('Samsara is in full growth mode', { company: 'Samsara' }).includes('pitch'));
  assert.ok(reasons('Required Qualifications, US').includes('heading'));
  assert.ok(reasons('You Need to Know').includes('heading'));
  assert.ok(reasons('Maintain classroom, lab equipment, and training materials Qualifications Education').includes('heading'));
  assert.ok(reasons('Co-developing methodology https://www.allium.so/post/x to identify stablecoin activity').includes('url'));
  assert.ok(reasons('Attention to detail, clear written and verbal communication, and the drive').includes('clipped'));
  assert.ok(reasons('With completion of at least one of the following').includes('clipped'));
  assert.ok(reasons('Teaching load is not the core KPI, but').includes('bad_end'));
  // audit C (measured) — sub-headings, glued ALL-CAPS headings, cuts inside a figure or a word
  for (const t of ['Partner Channel Strategy', 'Sales Alignment', 'Refills & Continued Use', 'QUALITY ASSURANCE', 'Fluent in English (written and verbal) COMPENSATION',
    'PREVIOUS EXPERIENCE - 2-3 years of restaurant and/or technical support experience']) assert.ok(reasons(t).includes('heading'), t);
  for (const t of ['BS in Electrical/Computer Engineering with 2', 'Willingness and ability to travel r']) assert.ok(reasons(t).includes('clipped'), t);
});

test('validator: real requirements pass, including short ones the reader read', () => {
  for (const t of ['5+ years of commercial experience with Golang', 'High school diploma or GED', 'PostgreSQL, Redis',
    'Lift and carry up to 50 pounds', 'Represent our brand at community events', 'Experience in repairs and dry docking']) {
    assert.deepEqual(reasons(t, { kind: /Lift/.test(t) ? 'physical' : 'requirement' }), [], t);
  }
  assert.deepEqual(reasons('Inventory management', { named: true }), []);
  assert.ok(reasons('Inventory management').includes('length'));
});

test('validator: physical-section prose that names no physical demand is not physical', () => {
  assert.ok(reasons('Handle work-related stress', { kind: 'physical', source: 'Handle work-related stress' }).includes('not_physical'));
  // a requirement under the wrong heading is re-kinded, not hidden
  const r = validateStatement('Excel skills are essential since Excel is the primary application', { kind: 'physical', source: 'Excel skills are essential since Excel is the primary application for the role' });
  assert.ok(r.ok && r.reasons.includes('rekind'));
  const st = extractJobFacts('Physical Demands:\n• Handle work-related stress\n• Lift up to 50 lbs\nRequirements:\n• 3+ years of retail experience\n• Cash handling experience\n• Valid driver’s license', { jobTitle: 'Store Associate' }).statements;
  const stress = st.find((s) => /stress/.test(s.text));
  assert.ok(!stress || (stress.display === false && stress.kind !== 'physical'), JSON.stringify(stress));
  assert.equal(st.find((s) => /50 lbs/.test(s.text)).kind, 'physical');
});

test('a persona the posting does not want is never a requirement', () => {
  const f = extractJobFacts('Requirements:\n• 5+ years of engineering leadership\n• Leaders who need complete specifications before their team can start\n• Experience with Kubernetes', { jobTitle: 'Engineering Manager' });
  assert.ok(!f.statements.some((s) => /Leaders who need/.test(s.text)));
  assert.ok(!f.some((x) => x.evidence && /Leaders who need/.test(x.evidence)));
});

test('a trait line is asked, never "not shown" on a leftover word', () => {
  const job = 'Requirements:\n• Embraces emerging technologies, including AI tools, to work smarter\n• Work ethic, solid communication skills, and obsession with winning are paramount\n• 5+ years of software engineering experience';
  const out = runOptimizer({ resumeText: PERSONAS[0], jobTitle: 'Software Engineer', jobDescription: job });
  for (const s of out.statements.filter((x) => /Embraces|Work ethic/.test(x.text))) assert.ok(s.status === 'cannot_tell' || s.status === 'shown', JSON.stringify(s));
  assert.equal(out.statements.find((x) => /Work ethic/.test(x.text)).ask.kind, 'trait');
});

test('run-on repair: split at the boundary; names and titles are never cut', () => {
  assert.deepEqual(splitRunOnStatement('Proven knowledge in managing Active Directory infrastructure for the Enterprise. Strong experience in PowerShell and Microsoft Graph API is required.'),
    ['Proven knowledge in managing Active Directory infrastructure for the Enterprise.', 'Strong experience in PowerShell and Microsoft Graph API is required.']);
  assert.equal(splitRunOnStatement('Optical analysis tools such as Zemax Hands-on experience in optical design and lens systems').length, 2);
  assert.equal(splitRunOnStatement('Handle critical issues or cope with unexpected challenges Take ownership of feature releases and provide nightly builds').length, 2);
  for (const t of ['Obtain a CPR, First Aid Certification and Tuberculosis test (if you have not had one in the last year)',
    'Train, mentor, and develop Fitters and Helpers to meet Piper Fire Protection standards for safety',
    'Meet weekly with the Account Executive / Account Manager / service Executive for formal document discussions',
    'Use Salesforce daily to track leads and maintain the pipeline for all accounts in the western region today']) assert.deepEqual(splitRunOnStatement(t), [t], t);
});

test('compression: a list is never cut inside; a short remainder keeps "Experience in"', () => {
  assert.equal(compressStatement('Lead the evaluation, design, and development of Active Directory & Azure Active Directory technical requirements, solutions, and implementation roadmap to ensure functional, reliable, secure, and cost-effective technology.'),
    'Lead the evaluation, design, and development of Active Directory & Azure Active Directory technical requirements, solutions, and implementation roadmap');
  assert.equal(compressStatement('Analyze current Azure Active Directory environment to identify both technical and operational challenges while making recommendations and developing solutions for improvement.'),
    'Analyze current Azure Active Directory environment to identify both technical and operational challenges');
  assert.equal(compressStatement('Experience in repairs and dry docking is required'), 'Experience in repairs and dry docking');
  assert.equal(compressStatement('And experience in data pipelines and orchestration tools'), 'Data pipelines and orchestration tools');
  assert.equal(compressStatement('Embraces emerging technologies, including AI tools, to work smarter, solve problems, and drive better business outcomes.'), 'Embraces emerging technologies, including AI tools');
  for (const t of PERSONAS) void t;
});

test('confidence comes from structure', () => {
  assert.equal(statementConfidence({ origin: 'bullet', explicit: false, kind: 'requirements' }, 'Forklift'), 'high');
  assert.equal(statementConfidence({ origin: 'line', explicit: true, kind: 'requirements' }, 'SQL and Python'), 'high');
  assert.equal(statementConfidence({ origin: 'sentence', explicit: false, kind: 'about' }, 'You must hold a CDL'), 'medium');
  assert.equal(statementConfidence({ origin: 'sentence', explicit: false, kind: 'about' }, 'We love our customers'), 'low');
  // R4: a glued piece is medium only when it opens like a requirement item (here: a schedule condition)
  assert.equal(statementConfidence({ origin: 'glued', explicit: true, kind: 'requirements' }, 'Conventional work schedule, with 4 days per week'), 'medium');
  assert.equal(statementConfidence({ origin: 'glued', explicit: true, kind: 'requirements' }, 'Propio and client teams across many offices'), 'low');
});

test('segmentation: flat dash / plus lists, glued colons and sentences, headings at a line end', () => {
  const t = cleanPastedPosting('ABOUT THE ROLE You will build. WHAT YOU’LL DO - Ship features end to end - Build the agent runtime - Design agent experiences - Improve AI infrastructure WE’RE LOOKING FOR SOMEONE WHO - Has shipped AI products - Is proficient in TypeScript');
  assert.ok(t.split('\n').filter((l) => l.startsWith('•')).length >= 6, t);
  assert.match(cleanPastedPosting('Who we\'re looking for:We are looking for and high ROI.Develop a plan'), /for: We .* ROI\. Develop/);
  assert.ok(cleanPastedPosting('Preferred qualifications: + Experience with Workfront + experience with AI + data governance + Python').split('\n').length >= 4);
  const p = splitPostingPieces('Proven knowledge of SAML (WS-Fed, OAuth, SAML, etc.) Enterprise admin duties for the Enterprise. Strong experience in PowerShell is required.').map((x) => x.text);
  assert.ok(p.some((x) => /^Strong experience in PowerShell/.test(x)), JSON.stringify(p));
  const rows = requirementSentences('Responsibilities\n• Build services\nRequired Experience and Education:\n10+ years of relevant working experience in IT Security\n• High school diploma or equivalent Physical Requirements:\n• Lift up to 50 lbs');
  assert.equal(rows.find((r) => /10\+ years/.test(r.sentence)).kind, 'requirements');
  assert.equal(rows.find((r) => /50 lbs/.test(r.sentence)).kind, 'physical');
});

test('preferred headings are read by their words, any case, any tail (Insights r5 guard list)', () => {
  for (const h of ['Bonus Points if you have', 'BONUS POINTS IF YOU HAVE', 'Bonus points for', 'Nice to have', 'Nice to have experience', 'Preferred Attributes',
    'Preferred Skills and Qualifications', 'Preferred qualifications', 'Desired skills and experience', 'Education, Experience, Skills and Abilities Preferred']) assert.ok(isHeadingPhrase(h), h);
  for (const h of ["Bachelor's degree preferred", 'Preferred experience in retail', 'Our list of qualifications']) assert.ok(!isHeadingPhrase(h), h);
  // the 12 corpus postings Insights guarded: every line under a preferred heading is preferred; the lines its probe
  // flagged that sit under ANOTHER heading keep that heading's reading
  const NOT_PREFERRED = /4 years of service|largest collection|unlawful in Massachusetts|Eligible to obtain|Physical Requirements of this|Observe an area|Three-dimensional/;
  for (const p of fixture('preferred-headings.json')) {
    const st = extractJobFacts(p.description, { jobTitle: p.title, company: p.company }).statements;
    for (const line of p.preferred) {
      // (the guard list quotes R3's compressed texts: matched by word overlap with the whole line)
      const words = (x) => new Set(String(x).toLowerCase().match(/[a-z0-9+]{3,}/g) || []);
      const want = words(line);
      const s = st.map((y) => ({ y, n: [...want].filter((w) => words(y.source).has(w)).length / Math.max(1, want.size) })).filter((x) => x.n >= 0.75).sort((a, b) => b.n - a.n).map((x) => x.y)[0];
      if (NOT_PREFERRED.test(line)) { assert.ok(!s || s.importance !== 'preferred' || s.display === false, `${p.title}: ${line}`); continue; }
      assert.ok(s && s.importance === 'preferred', `${p.title}: ${line} → ${s ? s.importance : 'none'}`);
    }
  }
});

test('paste invariance: the displayed reading is identical across six copy forms (15 postings)', () => {
  const bullets = (t, g) => t.replace(/^\s*[•▪◦·‣*-]\s+/gm, g);
  const wrap = (t) => t.split('\n').map((line) => { const out = []; let cur = ''; for (const w of line.split(' ')) { if ((`${cur} ${w}`).length > 72 && cur) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; } if (cur) out.push(cur); return out.join('\n'); }).join('\n');
  const FORMS = {
    email: (t) => `From: R <r@example.com>\nSubject: Role\n\n${t.replace(/^/gm, '> ')}`,
    pdf_o: (t) => wrap(bullets(t, 'o ')),
    pdf_dot: (t) => wrap(bullets(t, '· ')),
    markdown: (t) => bullets(t, '- ').replace(/^([A-Z][A-Za-z ,'&/()-]{2,60}):?$/gm, '## $1'),
    board: (t) => `About the job\n\n${t}\n\n…show more\nApply\nSave`,
    paragraph: (t) => t.replace(/\s*\n+\s*/g, ' '),
  };
  const sig = (r, text) => extractJobFacts(text, { jobTitle: r.title, company: r.company }).statements.filter((s) => s.display !== false && s.kind !== 'promise').map((s) => `${s.text}|${s.importance}|${s.kind}`).sort().join('\n');
  const diffs = [];
  for (const r of fixture('paste-postings.json')) {
    const base = sig(r, r.description);
    for (const [k, fn] of Object.entries(FORMS)) if (sig(r, fn(r.description)) !== base) diffs.push(`${r.title} · ${k}`);
  }
  assert.deepEqual(diffs, []);
});

// every fixture posting × persona: the displayed reading obeys the gate; one count; whole-word `missing`
const POSTINGS = [...Object.values(fixture('statement-postings.json')), ...fixture('paste-postings.json'), ...JSON.parse(readFileSync(new URL('../fixtures/personas/postings-sample.json', import.meta.url), 'utf8'))];
test('invariants: displayed statements pass the validator; requirement_count is the displayed count; missing is whole words', () => {
  const bad = [];
  for (const p of POSTINGS) {
    const text = p.description || p.text || '';
    for (const resume of PERSONAS.slice(0, 4)) {
      const out = runOptimizer({ resumeText: resume, jobTitle: p.title, company: p.company, jobDescription: text });
      if (out.requirement_count !== displayedRequirementCount(out.statements)) bad.push(`${p.title}: count ${out.requirement_count} vs ${displayedRequirementCount(out.statements)}`);
      if (out.displayed_count + out.hidden_count !== out.statements.length) bad.push(`${p.title}: displayed+hidden`);
      for (const s of out.statements) {
        if (!['high', 'medium', 'low'].includes(s.confidence) || typeof s.display !== 'boolean') bad.push(`${p.title}: fields ${s.id}`);
        if (s.display && s.confidence === 'low') bad.push(`${p.title}: low displayed "${s.text}"`);
        if (s.display) {
          const v = validateStatement(s.text, { kind: s.kind, named: true });
          // (`clipped` needs the source line; the reader checked it at build time)
          if (v.reasons.some((x) => !['clipped', 'not_physical', 'rekind', 'pitch', 'persona', 'our'].includes(x))) bad.push(`${p.title}: "${s.text}" ${v.reasons}`);
          if (gluedHeading(s.text)) bad.push(`${p.title}: heading "${s.text}"`);
        }
        const words = new Set(String(s.text).toLowerCase().split(/[^a-z0-9+#&'’/.-]+/).filter(Boolean));
        for (const m of s.missing || []) for (const tok of String(m).toLowerCase().split(/[^a-z0-9+#&'’/.-]+/).filter((x) => x.length >= 3)) {
          if (words.has(tok)) continue;
          // a fragment: the token is part of a statement word but not the word ("ventory" of "inventory")
          if ([...words].some((w) => w !== tok && w.length > tok.length && (w.endsWith(tok) || w.startsWith(tok)) && !/^[a-z]+s$/.test(w.replace(tok, '')))) bad.push(`${p.title}: missing fragment "${m}" in "${s.text}"`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('one status per line: a statement a gate judged reads as the gate graded it (G2 seam)', () => {
  const bad = [];
  const samples = [...JSON.parse(readFileSync(new URL('../fixtures/personas/postings-sample.json', import.meta.url), 'utf8')), ...Object.values(fixture('statement-postings.json')), ...fixture('paste-postings.json').slice(0, 8)];
  for (const p of samples) for (const resume of PERSONAS) {
    const out = runOptimizer({ resumeText: resume, jobTitle: p.title, company: p.company, jobDescription: p.description || '', now: '2026-11-10' });
    for (const s of out.statements) {
      const gates = out.constraints.filter((c) => c.statementId === s.id && ['years', 'degree', 'certification', 'licence', 'license'].includes(c.kind) && c.statementStatus && c.statementStatus !== 'cannot_tell');
      if (!gates.length || s.status === 'cannot_tell') continue;
      const g = gates.every((c) => c.statementStatus === 'shown') ? 'shown' : gates.every((c) => c.statementStatus === 'not_shown') ? 'not_shown' : 'partly';
      // (a constraint read from words the statement's text does not show does not decide it)
      if (s.status !== g && gates.some((c) => new RegExp(c.kind === 'years' ? '\\d|year' : '.', 'i').test(s.text))) bad.push(`${p.title}: "${s.text}" ${s.status} vs gate ${g}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('missing entries are whole words of the statement', () => {
  assert.equal(wholeWordsOf('ventory management', 'Inventory management and scheduling'), 'Inventory management');
  assert.equal(wholeWordsOf('re a strong mentor', "You're a strong mentor"), 'strong mentor');
  assert.equal(wholeWordsOf('training mentor', 'Train, mentor, and develop Fitters'), 'Train mentor');
  assert.equal(wholeWordsOf("Master's degree", 'A bachelor degree'), "Master's degree");
});

test('linear time: 5,000 repetitions of every free-text pattern', () => {
  const units = ['Experience with ', 'and ', 'Strong ', 'A. ', 'the Enterprise. ', '(e.g. ', ', and ', 'Required Skills & ', 'WE’RE ', ' - ', ' + ', 'x.Y', 'Bonus points if you have ', 'Our list of ', 'Train Fitters ', 'https://x.y/ '];
  for (const u of units) {
    const s = u.repeat(5000);
    const t0 = Date.now();
    validateStatement(s, { source: s, kind: 'physical', company: 'Acme' });
    splitRunOnStatement(s);
    isHeadingPhrase(s.slice(0, 200));
    gluedHeading(s);
    cleanPastedPosting(s);
    compressStatement(s);
    splitPostingPieces(s.slice(0, 20000));
    assert.ok(Date.now() - t0 < 3000, `"${u}" took ${Date.now() - t0} ms`);
  }
});
