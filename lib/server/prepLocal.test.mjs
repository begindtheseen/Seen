// Interview Prep with no model (owner decision 2026-10-26): answers are the person's own résumé lines told
// out loud, and nothing in them is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { localPack, storyAnswer, firstPerson, spoken, askThem, moveQuestion, frameFor } from './prepLocal.js';
import { numbersBacked } from './interviewPrep.js';

const FX = new URL('../../scripts/eval/fixtures/', import.meta.url);
const fixtures = readdirSync(FX).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, FX), 'utf8'))).filter((f) => f.resume);

test('a from→to line is told as situation, action, result', () => {
  const s = storyAnswer('Cut shrink from 2.4% to 1.1% in 12 months by tightening the fitting-room and back-door process', { title: 'Assistant Store Manager', company: 'Desert Sun Apparel', current: true });
  assert.equal(s.situation, "At Desert Sun Apparel, where I'm an Assistant Store Manager, shrink was 2.4%.");
  assert.match(s.action, /^I tightened the fitting-room and back-door process\. \[/);
  assert.equal(s.result, 'Within 12 months, shrink was down to 1.1%.');
});

test('first person, the right tense, numbers said out loud', () => {
  assert.deepEqual(firstPerson('Build weekly schedules in Kronos for 900+ labor hours and run the cash office', { current: false }).first, 'I built weekly schedules in Kronos for more than 900 labor hours and ran the cash office');
  assert.equal(firstPerson('Named Crew Member of the Month (Aug 2023)').first, 'I was named Crew Member of the Month (Aug 2023)');
  assert.deepEqual(firstPerson('Hired and trained 22 associates in 2023; 15 were still on staff a year later', { current: true }).rest, ['Of those, 15 were still on staff a year later']);
  assert.match(firstPerson('Serve as charge nurse 2 shifts a week: make assignments, manage admissions', { current: true }).first, /2 shifts a week, where I make assignments/);
  assert.equal(spoken('Care for 5–6 patients on $4.2M volume'), 'Care for 5 to 6 patients on $4.2 million volume');
  assert.equal(firstPerson('Responsible for the front desk'), null);
});

test('every fixture: answers are real résumé lines, every number is the résumé\'s, at most two prompts each', () => {
  for (const fx of fixtures) {
    const resumeText = fx.resume.join('\n');
    const jobText = fx.job.description.join('\n');
    const p = localPack({ company: fx.job.company, role: fx.job.title, resumeText, jobText, stage: 'Interview' });
    assert.equal(p.model, false, fx.id);
    assert.ok(p.answers.length >= 3, `${fx.id}: ${p.answers.length} answers`);
    for (const a of p.answers) {
      const flat = (t) => t.replace(/\s+/g, ' ');
      // a drafted recruiter answer (why now, pay, level) is built from dates and the posting, not one line
      if (!a.script && !a.frame) assert.ok(flat(resumeText).includes(flat(a.resume_fact).replace(/^[•\-\s]+/, '')), `${fx.id}: ${a.resume_fact}`);
      const told = a.answer.replace(/\[[^\]]*\]/g, ' ');
      // every number is the résumé's — or, in a drafted pay answer, the posting's own figure
      assert.ok(numbersBacked(told.replace(/\b(\d+) to (\d+)\b/g, '$1–$2').replace(/more than (\d[\d,]*)/g, '$1+').replace(/\$(\d+(?:\.\d+)?) million/g, '$$$1M'), a.script ? `${resumeText}\n${jobText}` : resumeText), `${fx.id}: ${a.answer}`);
      // a story carries at most two blanks; a frame (no line fits the question) is three blanks to finish
      assert.ok((a.answer.match(/\[/g) || []).length <= (a.frame ? 3 : 2), `${fx.id}: ${a.answer}`);
      if (a.frame) assert.equal(a.answer.replace(/\[[^\]]*\]/g, '').trim(), '', `${fx.id}: a frame is only blanks`);
      assert.doesNotMatch(a.answer, /\bI 'm\b|\bI was was\b|\s\./, `${fx.id}: ${a.answer}`);
    }
    assert.ok(p.ask_them.length >= 3);
    assert.ok(p.questions[0].q === 'Tell me about yourself.', fx.id);
  }
});

test('what the job asks for: proof lines, honest gap answers, lapsed credentials', () => {
  const nurse = fixtures.find((f) => f.id === '05-registered-nurse');
  const p = localPack({ company: nurse.job.company, role: nurse.job.title, resumeText: nurse.resume.join('\n'), jobText: nurse.job.description.join('\n') });
  const acls = p.job_match.find((m) => /ACLS/.test(m.label));
  assert.equal(acls.status, 'expired');
  assert.match(acls.say, /renewed by \[date\]/);
  assert.ok(p.job_match.some((m) => m.status === 'shown' && m.proof));
  assert.ok(p.job_match.some((m) => m.duty && /cardiac rhythms/i.test(m.label)));
  assert.match(askThem('Registered Nurse')[0].q, /patient ratio/);
});

test('round 1 grades: the article stays, the method is kept, coordinated steps share the tense', () => {
  const ig = storyAnswer("Grew the brand's Instagram from 3,100 to 5,400 followers in 10 weeks with a Reels series on how we roast", { title: 'Marketing Intern', company: 'Coastal Coffee', current: false });
  assert.match(ig.situation, /the brand's Instagram stood at 3,100 followers\.$/);
  assert.match(ig.action, /^I used a Reels series/);
  const pick = storyAnswer('Raised pick accuracy from 97.2% to 99.6% in 9 months by re-slotting the 200 fastest-moving SKUs and auditing scans daily', { title: 'Warehouse Lead', company: 'Midwest Parcel', current: true });
  assert.match(pick.action, /^I re-slotted the 200 fastest-moving SKUs and audited scans daily\./);
});

test('round 2 grades: the question every interview asks — the step up or the move', () => {
  assert.equal(moveQuestion({ title: 'Assistant Store Manager', current: true }, 'Store Manager', [{ title: 'Assistant Store Manager' }]).q, 'What makes you ready to step up from Assistant Store Manager to Store Manager?');
  assert.equal(moveQuestion({ title: 'Registered Nurse, Medical-Surgical Unit' }, 'Registered Nurse – Telemetry (Nights)', [{ title: 'Registered Nurse, Medical-Surgical Unit' }]).q, 'Why telemetry and nights now?');
  assert.equal(moveQuestion({ title: 'HVAC Service Technician' }, 'Commercial HVAC Service Technician', [{ title: 'HVAC Service Technician' }]).q, 'Why commercial work now?');
  assert.equal(moveQuestion({ title: 'Warehouse Lead' }, 'Warehouse Lead – 2nd Shift', [{ title: 'Warehouse Lead' }]), null, 'a shift is not a move');
});

test('round 3 grades: verbs, names, the intro, the move, and honest proof', async () => {
  const { fallbackIntro } = await import('./interviewPrep.js');
  const { staleLines } = await import('./prepFacts.js');
  const { checkBullet } = await import('../resume/optimize/grammar.js');
  // "promoted" is something the person did unless "to/as/for" follows
  assert.equal(firstPerson('Promoted seasonal launches and the rewards app at the register', { current: false }).first, 'I promoted seasonal launches and the rewards app at the register');
  assert.equal(firstPerson('Promoted to Shift Lead after 8 months').first, 'I was promoted to Shift Lead after 8 months');
  // the résumé's own capitals and a plural verb; what follows ";" stays in the story
  const ig = storyAnswer('Grew Instagram followers from 2,100 to 3,400 in 7 months; best Reel reached 48,000 views', { title: 'Social Media Intern', company: 'Chicago Youth Arts Collective (nonprofit)' });
  assert.match(ig.answer, /^At Chicago Youth Arts Collective, where I was a Social Media Intern, Instagram followers stood at 2,100\./);
  assert.match(ig.result, /Instagram followers were up to 3,400\. My best Reel reached 48,000 views\.$/);
  // a name inside a line keeps its tense
  assert.match(checkBullet('Led a team of 14–18 guest service, front-end and Drive Up team members', { current: false }).text, /Drive Up/);
  // the employer Target and a job's own dates are not a plan; a real plan still is
  assert.deepEqual(staleLines('Guest Experience Team Lead — Target, Phoenix, AZ Mar 2021 – Sep 2026', Date.parse('2026-10-26')), []);
  assert.equal(staleLines('CPA candidate — sitting for REG in 2025', Date.parse('2026-10-26'))[0].kind, 'past_plan');
  // the intro: a degree just finished leads; a job still held is "also", never "before that"
  const tasha = 'Tasha Green\nEDUCATION\nBachelor of Arts, Marketing — Northeastern Illinois University, Chicago, IL May 2026\nEXPERIENCE\nSocial Media Intern — Chicago Youth Arts Collective (nonprofit), Chicago, IL Jan 2025 – Aug 2025\n• Planned and posted 4–5 pieces of content a week on Instagram, TikTok and Facebook.\n• Grew Instagram followers from 2,100 to 3,400 in 7 months; best Reel reached 48,000 views.\nBarista (part-time) — Starbucks, Chicago, IL Sep 2023 – Present\n• Trained 4 new partners on drink standards and the point-of-sale system.\n';
  const intro = fallbackIntro({ resumeText: tasha, role: 'Marketing Coordinator', company: 'Grubhub', nowMs: Date.parse('2026-10-26') });
  assert.match(intro, /^I just finished a Bachelor of Arts in Marketing at Northeastern Illinois University\./);
  assert.match(intro, /where I grew Instagram followers from 2,100 to 3,400 in 7 months, and my best Reel reached 48,000 views\./);
  assert.match(intro, /I also work as a Barista at Starbucks\./);
  assert.doesNotMatch(intro, /Before that|\(nonprofit\)/);
  // a comma names the team, a degree counts as the field
  assert.equal(moveQuestion({ title: 'Senior Backend Engineer' }, 'Backend Engineer, Core Technology', [{ title: 'Senior Backend Engineer' }]), null);
  assert.equal(moveQuestion({ title: 'Social Media Intern' }, 'Marketing Coordinator', [{ title: 'Social Media Intern' }], ['Bachelor of Arts in Marketing']), null);
});

test('round 3 grades: recruiter answers and the job-match rows', () => {
  const dev = fixtures.find((f) => /backend/i.test(f.job.title));
  if (dev) {
    const p = localPack({ company: 'Stripe', role: 'Backend Engineer, Core Technology', resumeText: dev.resume.join('\n'), jobText: 'Minimum requirements\nStrong knowledge of algorithms and data structures\nThe preferred qualifications are a bonus, not a requirement.\n', stage: 'Phone Screen' });
    assert.ok(p.questions.some((q) => /pay expectations/.test(q.q)));
    assert.ok(!p.questions.some((q) => /what hours can you work/.test(q.q)), 'a salaried role is not asked its hours');
    assert.match(p.format, /recruiter/);
    assert.ok(!p.job_match.some((m) => /bonus, not a requirement/.test(m.label)));
    assert.ok(!p.job_match.some((m) => /haven't worked with algorithms/.test(m.say || '')));
  }
});

test('round 4: a company Seen knows leads with its own process and questions; every question has an answer to finish', () => {
  const maria = fixtures.find((f) => /retail/i.test(f.id)) || fixtures[0];
  const p = localPack({ company: 'Walmart', role: 'Assistant Store Manager', resumeText: maria.resume.join('\n'), jobText: maria.job.description.join('\n'), stage: 'Interview' });
  assert.ok(p.guide && p.guide.company === 'Walmart' && p.guide.tips.length >= 3, 'the guide rides with the pack');
  assert.match(p.format, /\b(?:usually|often|expect|many applicants)\b/i, 'the format is the company\'s, hedged');
  const companyQs = p.questions.filter((q) => q.company);
  assert.ok(companyQs.length >= 3, `${companyQs.length} company questions`);
  assert.ok(p.questions.findIndex((q) => q.company) <= 6, 'company questions come early');
  // every question except the intro has an answer: a story, a drafted script, or a frame of blanks
  const answered = new Set(p.answers.map((a) => a.q));
  for (const q of p.questions) if (!/^Tell me about yourself/.test(q.q)) assert.ok(answered.has(q.q), `no answer for: ${q.q}`);
  for (const a of p.answers.filter((x) => x.frame)) assert.equal(a.answer.replace(/\[[^\]]*\]/g, '').trim(), '');
  // a phone screen says so in the format and asks the recruiter questions first
  const ps = localPack({ company: 'Walmart', role: 'Assistant Store Manager', resumeText: maria.resume.join('\n'), stage: 'Phone Screen' });
  assert.match(ps.format, /^This is a phone screen/);
  // no guide → the field's format, no company flag anywhere
  const none = localPack({ company: 'Desert Sun Apparel', role: 'Assistant Store Manager', resumeText: maria.resume.join('\n'), stage: 'Interview' });
  assert.equal(none.guide, null);
  assert.ok(!none.questions.some((q) => q.company));
});

// ── Round 5: what the four round-4 personas caught ─────────────────────────────────────────────────
const RAY = `Ray Johnson
Columbus, OH 43207 · (614) 555-0142 · ray.johnson.columbus@example.com

SUMMARY
Warehouse lead with 12 years in distribution centers. Certified forklift and reach truck operator.

EXPERIENCE
Warehouse Lead — Midwest Grocers Distribution, Groveport, OH 2017 – 2026
• Led 2nd shift team of 15 in receiving, putaway and outbound loading for 400,000 sq ft DC.
• Ran weekly cycle counts in WMS (Manhattan); held inventory accuracy at 99.6%.
• Trained and certified 40+ associates on forklift and pallet jack; zero recordable injuries in 2024.
• Cut trailer load time 18% by re-slotting fast movers near dock doors.
Forklift Operator / Inventory Clerk — Central Ohio Logistics, Obetz, OH 2014 – 2017
• Operated sit-down and reach forklifts; picked and staged 250+ pallets per shift.
Material Handler — Buckeye Paper Supply, Columbus, OH 2012 – 2014
• Loaded and unloaded trucks, picked orders, kept dock area clean and organized.

SKILLS & CERTIFICATIONS
OSHA forklift certification (sit-down, reach truck, order picker) · Manhattan WMS · RF scanning · Cycle counting · Microsoft Excel

EDUCATION
High School Diploma — Marion-Franklin High School, Columbus, OH`;
const AMZ = `Warehouse Lead at Amazon
Pay: $22.50 — $24.00 per hour
What you'll do
• Support the Area Manager with daily shift plans, labor tracking and end-of-shift reporting.
• Monitor rate, quality and inventory accuracy on your process path; remove barriers.
Basic qualifications
• High school diploma or equivalent
• 1+ years of warehouse experience
• Experience with a warehouse management system
• Basic computer skills (email, spreadsheets, WMS)
Preferred qualifications
• Experience training associates
• Powered industrial truck (PIT) experience: forklift, order picker or reach truck
• Experience in a Lean / continuous-improvement environment`;

test('round 5: a story needs a real word in common; a principle cue alone never carries one; conflict and mistake questions are the person\'s own lines', () => {
  const p = localPack({ company: 'Amazon', role: 'Warehouse Lead', resumeText: RAY, jobText: AMZ, stage: 'Interview', nowMs: Date.parse('2026-10-27T12:00:00Z') });
  const by = (re) => p.answers.find((a) => re.test(a.q));
  // Dive Deep used to be built on the training line; Deliver Results on cycle counts (Ray, round 4)
  for (const a of p.answers.filter((x) => x.company)) {
    if (/details other people had skipped|tough deadline|disagreed|mistake/i.test(a.q)) assert.ok(a.frame && !a.resume_fact, `${a.q} → ${a.resume_fact}`);
  }
  // one line does not answer three different questions on the strength of "shift" and "team"
  const facts = p.answers.filter((a) => a.resume_fact).map((a) => a.resume_fact);
  assert.ok(facts.filter((f) => /Led 2nd shift team/.test(f)).length <= 1, facts.join('\n'));
  // a scenario in the present tense asks what you would do
  assert.match(frameFor('Your shift is behind the plan with two hours left. What do you do?'), /^\[What you would do in the first few minutes/);
  assert.match(frameFor('What hours can you work, and are weekends a problem?'), /^\[The days and hours you can work/);
  // the company's questions lead, right after the openers
  assert.ok(p.questions.findIndex((q) => q.company) <= 3, p.questions.slice(0, 5).map((q) => q.q).join(' | '));
  // pay: the posting's own band, whole, with its em dash (Dev: "$166,000" for a $166,000 — $225,000 band)
  assert.equal(p.posting_pay, '$22.50 — $24.00 per hour');
  assert.match(by(/pay expectations/i).answer, /^The posting lists \$22\.50 — \$24\.00 per hour, and that range works for me\./);
  // what the job asks for: WMS, logistics and the computer skills ARE on the résumé (Ray, round 4)
  for (const m of p.job_match) if (/warehouse management system|wms|computer skills|logistics/i.test(m.label)) assert.equal(m.status, 'shown', m.label);
  assert.equal(p.job_match.find((m) => /^training$/i.test(m.label))?.status, 'shown');
  // "2017 – 2026" with no month, written in 2026: current, never "ended in June 2026"
  // the title held is the title applied for: no "ready for a Warehouse Lead role" to a Warehouse Lead (round 5)
  assert.match(by(/looking for a new job/i).answer, /^I've been a Warehouse Lead at Midwest Grocers Distribution since 2017, and I'm looking for the same role/);
  // the posting's PIT line meets the OSHA forklift certification: a forklift row, and the intro says it (round 5, Ray)
  assert.equal(p.job_match.find((m) => /^forklift$/i.test(m.label))?.status, 'shown');
  assert.match(p.intro, /I hold an OSHA forklift certification\./);
  // "Monitor rate, quality and inventory accuracy" is shown by "held inventory accuracy at 99.6%"
  assert.equal(p.job_match.find((m) => /inventory accuracy/i.test(m.label))?.status, 'shown');
  // a company question nobody's line answers still carries a hint at the line most likely to hold the story
  assert.ok(p.answers.some((a) => a.company && a.frame && a.hint), 'a hint under at least one company frame');
  assert.match(p.intro, /^I'm a Warehouse Lead at Midwest Grocers Distribution/);
  // a range from OTHER employers is coaching beside the blank, never the person's words (Maria, round 4)
  const market = localPack({ company: 'Amazon', role: 'Warehouse Lead', resumeText: RAY, stage: 'Interview', pay: { unit: 'hour', low: 22, high: 23, listings: 3, scope: 'market' }, nowMs: Date.parse('2026-10-27T12:00:00Z') });
  const pay = market.answers.find((a) => /pay expectations/i.test(a.q));
  assert.doesNotMatch(pay.answer, /\$/);
  assert.match(pay.reference, /other employers on Seen pay about \$22–\$23 an hour/);
  // "Google Slides" is not listed on a résumé that says Google Analytics
  const tasha = localPack({ company: 'Grubhub', role: 'Marketing Coordinator', resumeText: 'Tasha Green\nChicago, IL\n\nEXPERIENCE\nSocial Media Intern — Chicago Youth Arts Collective 2025\n• Grew Instagram followers from 2,100 to 3,400 in 7 months.\n\nSKILLS\nGoogle Analytics · Google Workspace · Canva', jobText: 'Marketing Coordinator at Grubhub\nRequirements\n• Google Slides\n• HubSpot\n• Email marketing', stage: 'Phone Screen' });
  assert.notEqual(tasha.job_match.find((m) => /google slides/i.test(m.label))?.status, 'stated');
});

test('round 5: a coding exercise is practised, not answered; the staples survive a rebuild cap', () => {
  const dev = `Dev Patel\nAustin, TX\n\nEXPERIENCE\nSenior Backend Engineer — Ledgerline Jan 2021 – Jul 2026\n• Built idempotent payment-orchestration APIs (gRPC/REST) across Stripe, Adyen and an ACH processor.\n• Cut p99 latency from 180ms to 70ms on the payouts service.\nSoftware Engineer — H-E-B Digital 2018 – 2020\n• Built Go microservices for curbside order slotting serving more than 300 stores.\n\nSKILLS\nGo · Python · Postgres · Kafka`;
  const p = localPack({ company: 'Stripe', role: 'Backend Engineer', resumeText: dev, stage: 'Phone Screen', nowMs: Date.parse('2026-10-27T12:00:00Z') });
  const ex = p.answers.filter((a) => a.exercise);
  assert.ok(ex.length >= 1, 'Stripe\'s bug squash is an exercise');
  for (const a of ex) { assert.equal(a.answer, ''); assert.match(a.practice, /keyboard/); }
  for (const q of ['Why are you looking for a new job now?', 'What are your pay expectations?', 'What do you know about Stripe?']) assert.ok(p.questions.some((x) => x.q === q), `${q} kept`);
  assert.ok(p.questions.length <= 20);
});


// ── round 5 (Maria, 2026-10-27): the Ross prep ──
const MARIA_R = `Maria Lopez
Phoenix, AZ 85033 | (602) 555-0147 | maria.lopez.az@example.com
SUMMARY
Retail team lead with 9 years at Target leading teams of up to 18, running front-end and guest service operations,
scheduling, and training. Strong in customer service, conflict resolution, cash handling, inventory, and hitting
sales and service goals. Bilingual English/Spanish.
EXPERIENCE
Guest Experience Team Lead — Target, Phoenix, AZ Mar 2021 – Sep 2026
• Led a team of 14–18 guest service, front-end and Drive Up team members across all shifts.
• Raised guest satisfaction survey scores from 78% to 91% over 18 months by retraining on service standards.
• Built weekly schedules for 40+ hours of coverage; cut overtime 22% while meeting peak-season staffing.
• Handled escalated guest complaints, refunds and exchanges; resolved 95% without a manager.
• Trained 30+ new hires on POS, cash handling, loss prevention and Drive Up order flow.
Front End Team Lead — Target, Phoenix, AZ Jun 2018 – Mar 2021
• Ran front-end operations for a store doing $38M annually; managed cash office reconciliation daily.
• Grew Target Circle card sign-ups 35% year over year by coaching cashiers on the ask.
• Scheduled breaks and lane coverage for 20+ cashiers during holiday peaks.
Guest Service Team Member / Cashier — Target, Glendale, AZ Oct 2017 – Jun 2018
• Processed returns, exchanges and 200+ transactions per shift with accurate cash handling.
Customer Service Representative — Cox Communications (contract via Kelly Services), Phoenix, AZ
Feb 2016 – Sep 2017
• Answered 60–80 inbound calls per day on billing and service issues; kept 4.6/5 quality score.
SKILLS
Team leadership, scheduling, customer service, conflict resolution, POS systems, cash handling, inventory, loss
prevention, training and onboarding, Microsoft Excel, Workday, bilingual English/Spanish
EDUCATION
Phoenix College — Coursework toward A.A.S. Business Management (2014–2016)
Carl Hayden High School, Phoenix, AZ — Diploma, 2010`;
const ROSS = `Assistant Store Manager - Merchandise (Ross Dress for Less) - Phoenix, AZ
As an Assistant Store Manager, you will help lead the store team to deliver a great shopping experience. You will drive sales and profitability, oversee merchandise processing and the sales floor, and coach and develop associates.
Responsibilities:
- Lead, train and develop associates; hold the team accountable to standards and goals.
- Drive store sales through effective merchandise presentation, replenishment and fitting room / front end operations.
- Oversee receiving and processing of freight; ensure merchandise gets to the floor quickly.
- Manage payroll and scheduling to business needs; control shrink and follow loss prevention programs.
- Resolve customer concerns and model great customer service.
- Open and close the store; act as manager on duty.
Qualifications:
- 2+ years of retail supervisory or management experience.
- Strong leadership, communication and problem-solving skills.
- Experience with scheduling, payroll budgets, inventory and shrink control.
- Able to work a flexible schedule including nights, weekends and holidays.
- Able to lift up to 50 lbs and stand for extended periods.`;

test('round 5, Maria: with Ross\'s own questions on the card, "one thing you did well at Cox Communications" is gone — story or not', () => {
  const p = localPack({ company: 'Ross Stores', role: 'Assistant Store Manager - Merchandise', resumeText: MARIA_R, jobText: ROSS, stage: 'Interview' });
  assert.ok(p.answers.some((a) => a.company), 'the Ross guide questions are on the card');
  assert.ok(!p.answers.some((a) => /^Walk me through one thing you did well at/.test(a.q)), p.answers.map((a) => a.q).join(' | '));
  assert.ok(!(p.questions || []).some((q) => /^Walk me through one thing you did well at/.test(q.q)));
});

test('round 5, Maria: every requirement the posting states is a row — payroll (a real gap) and receiving are not cut by the cap', () => {
  const p = localPack({ company: 'Ross Stores', role: 'Assistant Store Manager - Merchandise', resumeText: MARIA_R, jobText: ROSS, stage: 'Interview' });
  const labels = p.job_match.map((r) => r.label.toLowerCase());
  assert.ok(labels.some((l) => /payroll/.test(l)), labels.join(' | '));
  assert.ok(labels.some((l) => /receiving/.test(l)), labels.join(' | '));
  assert.ok(labels.some((l) => /loss prevention/.test(l)), labels.join(' | '));
  const payroll = p.job_match.find((r) => /payroll/i.test(r.label));
  assert.equal(payroll.status, 'gap');
  assert.ok(p.job_match.length <= 16);
});

// ── round 6 (2026-10-27) ──
const TASHA_R = readFileSync(new URL('../fixtures/personas/tasha.txt', import.meta.url), 'utf8');
const TOPSTEP_R = readFileSync(new URL('../fixtures/personas/tasha-topstep-jd.txt', import.meta.url), 'utf8');

test('round 6, Tasha: the intro names the certification, not its issuer', () => {
  const p = localPack({ company: 'Grubhub', role: 'Marketing Coordinator', resumeText: TASHA_R, jobText: TOPSTEP_R, stage: 'Phone Screen' });
  assert.match(p.intro, /I hold a Social Media Marketing certification from HubSpot Academy\./, p.intro);
  assert.ok(!/I'm certified:/.test(p.intro), p.intro);
});

test('round 6, Tasha: "how do you know if it worked" is built on the line that pulled the numbers', () => {
  const p = localPack({ company: 'Grubhub', role: 'Marketing Coordinator', resumeText: TASHA_R, jobText: TOPSTEP_R, stage: 'Phone Screen' });
  const a = p.answers.find((x) => /How do you decide what to post or send/.test(x.q));
  assert.ok(a, 'the method question is on the card');
  assert.match(a.resume_fact || '', /Instagram Insights/, a.resume_fact || '(frame)');
});

test('round 6, Tasha: a requirement pasted after the legal block is read — Google Analytics gets a row', () => {
  const jobText = `${TOPSTEP_R}\n- Experience with Google Analytics and weekly reporting on campaign performance is required.`;
  const p = localPack({ company: 'Grubhub', role: 'Marketing Coordinator', resumeText: TASHA_R, jobText, stage: 'Phone Screen' });
  const row = p.job_match.find((r) => /google analytics/i.test(r.label));
  assert.ok(row, p.job_match.map((r) => r.label).join(' | '));
  assert.notEqual(row.status, 'gap', JSON.stringify(row));
});

test('round 6, Ray: the forklift row is proved by the line that drove one, not the line that trained others', () => {
  const p = localPack({ company: 'Amazon', role: 'Warehouse Lead', resumeText: RAY, jobText: AMZ, stage: 'Interview' });
  const row = p.job_match.find((r) => /^forklift$/i.test(r.label) || /powered industrial truck/i.test(r.label));
  assert.ok(row, p.job_match.map((r) => r.label).join(' | '));
  assert.match(row.proof || '', /Operated sit-down and reach forklifts/, JSON.stringify(row));
  assert.ok(!p.answers.some((a) => /^Tell me about your experience with forklift\.?$/i.test(a.q) && /^Trained/.test(a.resume_fact || '')));
});

test('round 6, Maria: a line hints at one question, and never at "What is your availability"', () => {
  const p = localPack({ company: 'Ross Stores', role: 'Assistant Store Manager - Merchandise', resumeText: MARIA_R, jobText: ROSS, stage: 'Interview' });
  const hinted = p.answers.filter((a) => a.hint);
  assert.equal(new Set(hinted.map((a) => a.hint)).size, hinted.length, 'one line per hint');
  assert.ok(!p.answers.some((a) => /availability/i.test(a.q) && a.hint), 'availability is not a story a line holds');
  assert.equal(p.ask_them.filter((a) => /90 days/.test(a.q)).length, 1, p.ask_them.map((a) => a.q).join(' | '));
  const bilingual = localPack({ company: 'Ross Stores', role: 'Assistant Store Manager - Merchandise', resumeText: MARIA_R, jobText: `${ROSS}\n- Bilingual English/Spanish a plus.`, stage: 'Interview' });
  assert.ok(bilingual.job_match.some((r) => /bilingual/i.test(r.label) && r.status === 'shown'), bilingual.job_match.map((r) => r.label).join(' | '));
});

test('round 6, Dev: the security row is proved by a security line, never by "SLOs that took incidents from 7 to 1"', () => {
  const DEV_R = readFileSync(new URL('../fixtures/personas/dev.txt', import.meta.url), 'utf8');
  const DBX = readFileSync(new URL('../fixtures/personas/dev-databricks-jd.txt', import.meta.url), 'utf8');
  const p = localPack({ company: 'Databricks', role: 'Senior Software Engineer - Backend', resumeText: DEV_R, jobText: DBX, stage: 'Phone Screen' });
  const row = p.job_match.find((r) => /sensitive data|security/i.test(r.label));
  assert.ok(row, p.job_match.map((r) => r.label).join(' | '));
  assert.equal(row.status, 'shown');
  assert.match(row.proof || '', /row-level security|SOC 2|audit-log/i, JSON.stringify(row));
  assert.ok(!/on-call/.test(row.proof || ''), row.proof);
});

test('round 7, Tasha: "email marketing", "email testing" and "email deliverability" are three rows, not one', () => {
  const p = localPack({ company: 'Grubhub', role: 'Marketing Coordinator', resumeText: TASHA_R, jobText: TOPSTEP_R, stage: 'Phone Screen' });
  const labels = p.job_match.map((r) => r.label.toLowerCase());
  for (const want of ['email marketing', 'email testing', 'email deliverability']) assert.ok(labels.some((l) => l.includes(want)), `${want} missing: ${labels.join(' | ')}`);
});
