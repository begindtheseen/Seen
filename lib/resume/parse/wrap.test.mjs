// Tests: wrapped bullet text never becomes a role (live on seenjobs.io 2026-10-25).
// Run: node --test lib/resume/parse/wrap.test.mjs
//
// The failing layout is the Word / pdfkit default "first-line indent" bullet: "•  text" is
// indented, and the text wraps back to the LEFT MARGIN — the header indent. The tail ("calendar.",
// "(1,800 subscribers).", "reconciliation breaks 92%.") was promoted to a role with no employer
// and no dates, and Studio rebuilt the same broken roles from the saved plain text. The fixtures
// below are the fictional test personas' own wrapped sentences, rendered into a real PDF with
// pdfkit and read back through the real extractor, then parsed three ways: rich lines, the
// extracted plain text (what profiles.resume_text stores), and serializeToText → parse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';

import { parseResume, parseExperience } from './index.js';
import { extractResumeFile } from '../extract/index.js';
import { textToLines } from '../extract/lines.js';
import { serializeToText } from '../model.js';
import { tailKind, joinWrapped, isDanglingRange } from './wrap.js';

function pdfBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}
const heading = (doc, t) => { doc.moveDown(0.6); doc.font('Helvetica-Bold').fontSize(12).text(t.toUpperCase()); doc.moveDown(0.4); };
// First-line indent only: the wrapped lines start at the left margin, under the glyph.
const bullet = (doc, t) => doc.font('Helvetica').fontSize(10).text('-  ' + t, { indent: 10 });
const role = (doc, header, dates) => { doc.moveDown(0.4); doc.font('Helvetica-Bold').fontSize(10).text(header, { continued: true }).font('Helvetica').text('    ' + dates); };

const TASHA = (doc) => {
  doc.font('Helvetica-Bold').fontSize(22).text('Tasha Green');
  doc.font('Helvetica').fontSize(10).text('Chicago, IL  |  (312) 555-0148  |  tasha.green.mktg@gmail.com');
  heading(doc, 'Education');
  doc.font('Helvetica-Bold').fontSize(10).text('Bachelor of Arts, Marketing — Northeastern Illinois University, Chicago, IL', { continued: true }).font('Helvetica').text('    May 2026');
  bullet(doc, 'Coursework: Digital Marketing, Consumer Behavior, Marketing Research, Brand Management, Business Writing.');
  heading(doc, 'Experience');
  // The header itself wraps after its dash ("… Jan 2025 –" / "Aug 2025") at this font size.
  doc.font('Helvetica-Bold').fontSize(12).text('Social Media Intern — Chicago Youth Arts Collective (nonprofit), Chicago, IL', { continued: true }).font('Helvetica').text('    Jan 2025 – Aug 2025');
  bullet(doc, 'Planned and posted 4–5 pieces of content a week on Instagram, TikTok and Facebook using a shared content calendar.');
  bullet(doc, 'Grew Instagram followers from 2,100 to 3,400 in 7 months; best Reel reached 48,000 views.');
  bullet(doc, 'Designed event flyers and fundraiser graphics in Canva; wrote captions and the monthly email newsletter (1,800 subscribers).');
  bullet(doc, 'Pulled weekly Instagram Insights and Meta Business Suite numbers into a one-page report for the program director.');
  role(doc, 'Barista (part-time) — Starbucks, Chicago, IL', 'Sep 2023 – Present');
  bullet(doc, 'Promoted seasonal launches and the rewards app at the register; store hit rewards sign-up goals 3 quarters in a row.');
  role(doc, 'Campus Ambassador — Student Activities Office, NEIU', 'Aug 2024 – May 2026');
  bullet(doc, 'Ran tabling and social posts for 10+ campus events a semester; event sign-ups grew about 30% year over year.');
  heading(doc, 'Skills');
  doc.font('Helvetica').fontSize(10).text('Canva, Instagram, TikTok, Facebook, Meta Business Suite, Later, Mailchimp, Google Analytics (basic), Microsoft Excel, Google Workspace, copywriting, content calendars, customer service, public speaking. Bilingual: English / conversational Spanish.');
};

const DEV = (doc) => {
  doc.font('Helvetica-Bold').fontSize(20).text('Dev Patel');
  doc.font('Helvetica').fontSize(10).text('Austin, TX (open to remote) | dev.patel.eng@gmail.com | (512) 555-0187');
  heading(doc, 'Summary');
  doc.font('Helvetica').fontSize(10).text('Backend engineer with 6 years building payment and ledger systems in Go, Python and PostgreSQL.');
  heading(doc, 'Experience');
  role(doc, 'Senior Backend Engineer — Ledgerline (Series B fintech), Austin, TX', 'Mar 2022 – Jul 2026');
  bullet(doc, 'Led design of a double-entry ledger service in Go on PostgreSQL handling 4M transactions/day; cut reconciliation breaks 92%.');
  bullet(doc, 'Built idempotent payment-orchestration APIs (gRPC/REST) across Stripe, Adyen and an ACH processor; p99 latency 180ms to 70ms.');
  bullet(doc, 'Migrated batch settlement jobs from cron to Kafka consumers on Kubernetes (EKS); removed a 6-hour daily settlement lag.');
  bullet(doc, 'Owned on-call for payments (1-in-5 rotation); wrote runbooks and SLOs that took monthly Sev-2 incidents from 7 to 1.');
  bullet(doc, 'Mentored 3 engineers; ran the backend interview loop (40+ interviews).');
  role(doc, 'Backend Engineer — Equitably, Remote', 'Jun 2020 – Feb 2022');
  bullet(doc, 'Wrote Python (FastAPI) services for equity grant workflows; designed Postgres schema with row-level security for 900 customer orgs.');
  bullet(doc, 'Introduced Terraform + GitHub Actions CI; deploy time 40 min to 8 min.');
  role(doc, 'Software Engineer — H-E-B Digital, Austin, TX', 'Jul 2018 – May 2020');
  bullet(doc, 'Built Go microservices for curbside order slotting serving 300+ stores; Redis caching cut DB load 60%.');
  heading(doc, 'Skills');
  doc.font('Helvetica').fontSize(10).text('Languages: Go, Python, SQL, TypeScript (working). Data: PostgreSQL, Redis, Kafka, DynamoDB, Snowflake. Practices: distributed systems, idempotency, event sourcing, observability, PCI-DSS, SOC 2.');
};

const MARIA_SKILLS = (doc) => {
  doc.font('Helvetica-Bold').fontSize(20).text('Maria Lopez');
  doc.font('Helvetica').fontSize(10).text('Phoenix, AZ 85033 | (602) 555-0147 | maria.lopez.az@example.com');
  heading(doc, 'Experience');
  role(doc, 'Guest Experience Team Lead — Target, Phoenix, AZ', 'Mar 2021 – Sep 2026');
  bullet(doc, 'Trained 30+ new hires on POS, cash handling, loss prevention and Drive Up order flow.');
  heading(doc, 'Skills');
  doc.font('Helvetica').fontSize(10).text('Team leadership, scheduling, customer service, conflict resolution, POS systems, cash handling, inventory, loss prevention, training and onboarding, Microsoft Excel, Workday, bilingual English/Spanish');
};

async function threeWays(build) {
  const ex = await extractResumeFile({ buffer: await pdfBuffer(build), fileName: 'resume.pdf', mimeType: 'application/pdf' });
  assert.equal(ex.ok, true, ex.error);
  const fromLines = parseResume({ text: ex.text, lines: ex.lines, layout: ex.layout, source: 'pdf' });
  return {
    ex,
    lines: fromLines,
    savedText: parseResume({ text: ex.text, source: 'text' }), // profiles.resume_text → Studio
    reparsed: parseResume({ text: serializeToText(fromLines), source: 'text' }),
  };
}
const roleKeys = (d) => d.experience.map((r) => `${r.title} @ ${r.company} | ${r.start}–${r.end}`);
const allBullets = (d) => d.experience.flatMap((r) => r.bullets.map((b) => b.text));
const noOrphanRoleWarnings = (d, label) => {
  const bad = d.meta.warnings.filter((w) => w.code === 'role_no_company' || w.code === 'role_no_dates' || w.code === 'role_no_title');
  assert.deepEqual(bad.map((w) => w.message), [], `${label}: no role is missing its employer/dates/title`);
};

test('the extractor really does wrap these bullets to the left margin (the fixture reproduces the bug layout)', async () => {
  const { ex } = await threeWays(TASHA);
  const tail = ex.lines.find((l) => l.text === '(1,800 subscribers).');
  const head = ex.lines.find((l) => /^Designed event flyers/.test(l.text));
  assert.ok(tail && head, 'the bullet wrapped onto its own physical line');
  assert.equal(head.bullet, true);
  assert.equal(tail.bullet, false);
  assert.ok(tail.indent < head.indent, 'the tail sits left of the bullet text, at the header indent');
});

test('Tasha: wrapped bullet tails join their bullet — three roles on every path, never "calendar." or "(1,800 subscribers)."', async () => {
  const r = await threeWays(TASHA);
  const expected = [
    'Social Media Intern @ Chicago Youth Arts Collective (nonprofit) | 2025-01–2025-08',
    'Barista @ Starbucks | 2023-09–present',
    'Campus Ambassador @ Student Activities Office, NEIU | 2024-08–2026-05',
  ];
  for (const [label, d] of [['rich lines', r.lines], ['saved plain text', r.savedText], ['serialize → parse', r.reparsed]]) {
    assert.deepEqual(roleKeys(d), expected, label);
    noOrphanRoleWarnings(d, label);
    const bullets = allBullets(d);
    assert.ok(bullets.includes('Planned and posted 4–5 pieces of content a week on Instagram, TikTok and Facebook using a shared content calendar.'), `${label}: calendar joined`);
    assert.ok(bullets.includes('Designed event flyers and fundraiser graphics in Canva; wrote captions and the monthly email newsletter (1,800 subscribers).'), `${label}: subscribers joined`);
    assert.ok(bullets.includes('Pulled weekly Instagram Insights and Meta Business Suite numbers into a one-page report for the program director.'), `${label}: director joined`);
    assert.ok(bullets.includes('Promoted seasonal launches and the rewards app at the register; store hit rewards sign-up goals 3 quarters in a row.'), `${label}: "a row." joined`);
    assert.ok(bullets.some((b) => b.endsWith('grew about 30% year over year.')), `${label}: "year." joined`);
    assert.equal(d.experience[0].bullets.length, 4, `${label}: the intern role keeps all four bullets`);
    // The school name never absorbs the coursework bullet's wrapped last word.
    assert.equal(d.education[0].school, 'Northeastern Illinois University', label);
    assert.ok(d.education[0].details.some((x) => x.text.endsWith('Brand Management, Business Writing.')), `${label}: coursework joined`);
    const skills = d.skills.flatMap((g) => g.items);
    assert.ok(skills.includes('Microsoft Excel'), `${label}: "Microsoft" / "Excel" is one skill`);
    assert.ok(!skills.includes('Excel') && !skills.includes('Microsoft'), label);
  }
});

test('Dev: semicolon-ended wrapped lines join; Kafka / on-call / mentoring bullets all survive serialize → parse', async () => {
  const r = await threeWays(DEV);
  const expected = [
    'Senior Backend Engineer @ Ledgerline (Series B fintech) | 2022-03–2026-07',
    'Backend Engineer @ Equitably | 2020-06–2022-02',
    'Software Engineer @ H-E-B Digital | 2018-07–2020-05',
  ];
  for (const [label, d] of [['rich lines', r.lines], ['saved plain text', r.savedText], ['serialize → parse', r.reparsed]]) {
    assert.deepEqual(roleKeys(d), expected, label);
    noOrphanRoleWarnings(d, label);
    const first = d.experience[0].bullets.map((b) => b.text);
    assert.equal(first.length, 5, `${label}: five bullets under the senior role`);
    assert.ok(first[0].endsWith('cut reconciliation breaks 92%.'), label);
    assert.ok(first[1].endsWith('ACH processor; p99 latency 180ms to 70ms.'), label);
    assert.ok(first.some((b) => /Kafka consumers .* daily settlement lag\.$/.test(b)), `${label}: Kafka bullet`);
    assert.ok(first.some((b) => /^Owned on-call .* from 7 to 1\.$/.test(b)), `${label}: on-call bullet`);
    assert.ok(first.some((b) => /^Mentored 3 engineers/.test(b)), `${label}: mentoring bullet`);
    assert.ok(d.experience[1].bullets[0].text.endsWith('row-level security for 900 customer orgs.'), label);
    // The contact line (with its "(open to remote)" qualifier) is not the summary.
    assert.ok(/^Backend engineer with 6 years/.test(d.basics.summary), `${label}: summary starts with the summary`);
    const groups = Object.fromEntries(d.skills.map((g) => [g.label, g.items]));
    assert.deepEqual(groups.Data, ['PostgreSQL', 'Redis', 'Kafka', 'DynamoDB', 'Snowflake'], `${label}: "… (working). Data:" splits into its own group`);
    assert.ok(groups.Practices.includes('distributed systems'), `${label}: "distributed" / "systems" is one skill`);
  }
});

test('Maria: a skill list that wraps mid-item keeps "loss prevention" one phrase (never "loss · prevention")', async () => {
  const r = await threeWays(MARIA_SKILLS);
  for (const [label, d] of [['rich lines', r.lines], ['saved plain text', r.savedText], ['serialize → parse', r.reparsed]]) {
    const skills = d.skills.flatMap((g) => g.items);
    assert.ok(skills.includes('loss prevention'), `${label}: ${JSON.stringify(skills)}`);
    assert.ok(!skills.includes('loss') && !skills.includes('prevention'), label);
    assert.ok(skills.includes('training and onboarding'), label);
    assert.ok(!/loss\s*·\s*prevention/.test(serializeToText(d)), label);
  }
});

// ── Plain text only (no geometry): the saved résumé text, typed or pasted ──
test('plain text: glyph-less tails after "•" bullets join, headers still start roles', () => {
  const text = [
    'EXPERIENCE',
    'Social Media Intern — Chicago Youth Arts Collective (nonprofit), Chicago, IL   Jan 2025 –',
    'Aug 2025',
    '• Designed event flyers and fundraiser graphics in Canva; wrote captions and the monthly email newsletter',
    '(1,800 subscribers).',
    '• Built idempotent payment-orchestration APIs (gRPC/REST) across Stripe, Adyen and an ACH processor;',
    'p99 latency 180ms to 70ms.',
    '• Ran the Q3 launch across retail and online channels for the',
    'Northeast region.',
    'Senior Analyst',
    'Acme Corp   2019 – 2021',
    '• Led migration of 40 services to Kubernetes and cut deploy time from 2 hours to 9 minutes',
    'eBay   2017 – 2019',
    'Marketplace Analyst',
    '• Built pricing dashboards',
  ].join('\n');
  const d = parseResume({ text });
  assert.deepEqual(d.experience.map((r) => [r.title, r.company, r.start, r.end]), [
    ['Social Media Intern', 'Chicago Youth Arts Collective (nonprofit)', '2025-01', '2025-08'],
    ['Senior Analyst', 'Acme Corp', '2019', '2021'],
    ['Marketplace Analyst', 'eBay', '2017', '2019'],
  ]);
  assert.deepEqual(d.experience[0].bullets.map((b) => b.text), [
    'Designed event flyers and fundraiser graphics in Canva; wrote captions and the monthly email newsletter (1,800 subscribers).',
    'Built idempotent payment-orchestration APIs (gRPC/REST) across Stripe, Adyen and an ACH processor; p99 latency 180ms to 70ms.',
    'Ran the Q3 launch across retail and online channels for the Northeast region.',
  ]);
  assert.equal(d.experience[1].bullets.length, 1);
});

test('the experience parser itself never opens a role on a wrapped tail (merger bypassed)', () => {
  // parseExperience called directly on unmerged lines: the safety net must still hold.
  const lines = textToLines([
    'Software Engineer — Ledgerline   Mar 2022 – Jul 2026',
    '• Led design of a double-entry ledger service in Go on PostgreSQL handling 4M transactions/day; cut',
    'reconciliation breaks 92%.',
    '• Designed event flyers and fundraiser graphics in Canva; wrote the monthly email newsletter',
    '(1,800 subscribers).',
    '• Promoted the rewards app; store hit sign-up goals',
    '3 quarters in a row.',
    'Data Analyst — Acme Corp   2019 – 2021',
    '• Built dashboards.',
  ].join('\n'));
  const { roles } = parseExperience(lines, { hasGeometry: false });
  assert.deepEqual(roles.map((r) => [r.title, r.company]), [['Software Engineer', 'Ledgerline'], ['Data Analyst', 'Acme Corp']]);
  assert.deepEqual(roles[0].bullets.map((b) => b.text), [
    'Led design of a double-entry ledger service in Go on PostgreSQL handling 4M transactions/day; cut reconciliation breaks 92%.',
    'Designed event flyers and fundraiser graphics in Canva; wrote the monthly email newsletter (1,800 subscribers).',
    'Promoted the rewards app; store hit sign-up goals 3 quarters in a row.',
  ]);
});

test('wrap signals: tails vs headers, hyphenation kept, no glyph invented', () => {
  for (const t of ['calendar.', '(1,800 subscribers).', 'reconciliation breaks 92%.', 'p99 latency 180ms to 70ms.', 'director.', '3 quarters in a row.']) {
    assert.equal(tailKind(t), 'strong', t);
  }
  assert.equal(tailKind('Writing.'), 'weak');
  for (const t of ['Acme Corp', 'Senior Analyst', 'eBay', '24 Hour Fitness', '7-Eleven', '(Contract)', 'Phoenix, AZ', 'Jan 2020 – Present', 'freelance', 'Starbucks — Barista', 'Victoriam Management']) {
    assert.equal(tailKind(t), null, t);
  }
  assert.equal(joinWrapped('year-over-', 'year growth'), 'year-over-year growth', 'a line-end hyphen is kept, no space');
  assert.equal(joinWrapped('cash handling, inventory, loss', 'prevention, training'), 'cash handling, inventory, loss prevention, training');
  assert.ok(!joinWrapped('loss', 'prevention').includes('·'));
  assert.equal(isDanglingRange('Social Media Intern — Collective, Chicago, IL Jan 2025 –', 'Aug 2025'), true);
  assert.equal(isDanglingRange('Reduced costs 12% –', 'Aug 2025'), false);
});
