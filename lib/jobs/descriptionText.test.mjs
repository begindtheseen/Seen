// Run: node --test lib/jobs/descriptionText.test.mjs
// Shapes are real prod rows (read-only copy, 2026-10-24): the SpaceX Greenhouse posting — mission
// opener, "CONSTRUCTION SAFETY ENGINEER As part of a team…", "RESPONSIBILITIES:", ITAR tail cut at
// the old 8,000-char cap — and the Adzuna 500-char teaser ending "fina…".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDescriptionPreview, stripDanglingEllipsis, endsCutOff, capAtSentence, paragraphs, roleSnippet, DESCRIPTION_CAP } from './descriptionText.js';
import { preferFullText } from './listingTwins.js';

const MISSION = 'SpaceX was founded under the belief that a future where humanity is out exploring the stars is fundamentally more exciting than one where we are not. Today SpaceX is actively developing the technologies to make this possible, with the ultimate goal of enabling human life on Mars.';
const GH_BODY = ' CONSTRUCTION SAFETY ENGINEER As part of a team of technicians and engineers, you will provide technical expertise and assist in the implementation of all Environmental, Health and Safety programs at the McGregor, TX rocket-engine test site. The ideal candidate is highly skilled in both environmental and occupational safety, is hands-on in a high-energy test environment, and can manage contractor and contingent-labor safety. RESPONSIBILITIES: Work closely with test engineers, stand crews, and technician teams to perform detailed safety reviews of complex test operations. Lead or assist in all aspects of incident investigations, including initial follow-up, root cause analysis, and corrective actions. BASIC QUALIFICATIONS: Bachelor\'s degree in occupational safety, engineering, or a related field. 3+ years of experience in a safety role. ITAR REQUIREMENTS: To conform to U.S. Government export regulations, applicant must be a (i) U.S. citizen or national, (ii) U.S. lawful, permanent resident (aka green card holde';
// Fill to exactly the old cap with role sentences (the real row runs 8,000 chars), keeping the ITAR tail
// — cut mid-word by the old ingest — at the very end, the way prod stored it.
const ITAR = ' ITAR REQUIREMENTS: To conform to U.S. Government export regulations, applicant must be a (i) U.S. citizen or national, (ii) U.S. lawful, permanent resident (aka green card holde';
const HEAD = MISSION + GH_BODY.slice(0, GH_BODY.indexOf(' ITAR REQUIREMENTS:'));
const FILL = ' Additional duties include supporting the test site team with daily safety walks and documentation.';
let fill = '';
while ((HEAD + fill + FILL + ITAR).length <= 8000) fill += FILL;
const gap = 8000 - (HEAD + fill + ITAR).length; // < FILL.length by construction
const GH = HEAD + fill + (gap > 2 ? ` ${'w'.repeat(gap - 2)}.` : gap === 2 ? ' .' : gap === 1 ? '.' : '') + ITAR;
const ADZ = (MISSION + ' SR. ACCOUNTANT (LATAM) RESPONSIBILITIES: Support Latin America operations in multinational environments Participate in the accounting close process to ensure timely and accurate reporting of all monthly accounting fina…').slice(0, 500);

test('isDescriptionPreview: every Adzuna row, and any short text ending in an ellipsis', () => {
  assert.equal(isDescriptionPreview({ source: 'Adzuna', description: ADZ }), true);
  assert.equal(isDescriptionPreview({ source: 'Seen', description: ADZ }), true, 'a 500-char teaser ending "…" is a preview whatever the source says');
  assert.equal(isDescriptionPreview({ source: 'Greenhouse', description: GH }), false);
  assert.equal(isDescriptionPreview({ source: 'Lever', description: 'Short but complete.' }), false);
  assert.equal(isDescriptionPreview({ source: 'Greenhouse', description: 'x'.repeat(3000) + '...' }), false, 'a long text ending in dots is not a teaser');
});

test('stripDanglingEllipsis: the ellipsis and the word it cut go; clean text is untouched', () => {
  assert.match(stripDanglingEllipsis(ADZ), /monthly accounting$/);
  assert.doesNotMatch(stripDanglingEllipsis(ADZ), /fina/);
  assert.equal(stripDanglingEllipsis('Ends cleanly.…'), 'Ends cleanly.');
  assert.equal(stripDanglingEllipsis('Ends cleanly...'), 'Ends', 'a word before dots cannot be told from a cut word');
  assert.equal(stripDanglingEllipsis('No ellipsis here'), 'No ellipsis here');
});

test('endsCutOff: a text at the cap with no terminal punctuation was cut', () => {
  assert.equal(GH.length, 8000);
  assert.match(GH, /green card holde$/);
  assert.ok(GH.startsWith('SpaceX was founded'), 'the fixture keeps its opener (filler fitted below the cap)');
  assert.equal(endsCutOff(GH), true);
  assert.equal(endsCutOff(ADZ), false, 'a teaser is short — a different problem, labelled differently');
  assert.equal(endsCutOff(GH.slice(0, 7900) + '.'), false);
  assert.equal(endsCutOff('x'.repeat(DESCRIPTION_CAP - 50)), true);
  assert.equal(endsCutOff('x'.repeat(9000)), false, 'between the caps nothing was cut by ingest');
});

test('capAtSentence: the ingest cap lands on a sentence end, never mid-word', () => {
  const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} says something useful about the role.`).join(' ');
  const capped = capAtSentence(long, 12000);
  assert.ok(capped.length <= 12000);
  assert.ok(capped.length > 12000 - 1500);
  assert.match(capped, /role\.$/);
  assert.equal(capAtSentence('short text.', 12000), 'short text.');
  const noDots = 'word '.repeat(4000);
  const c2 = capAtSentence(noDots, 12000);
  assert.ok(c2.length <= 12000 && /word$/.test(c2), 'no sentence ends → last word boundary');
});

test('paragraphs: one-line stored text splits at headings and bullets; newlines win when present', () => {
  const p = paragraphs(GH);
  assert.ok(p.length >= 8, `got ${p.length} paragraphs`);
  assert.equal(p[0].slice(0, 24), 'SpaceX was founded under');
  assert.equal(p[1], 'CONSTRUCTION SAFETY ENGINEER');
  assert.equal(p[2].slice(0, 20), 'As part of a team of');
  assert.ok(p.includes('RESPONSIBILITIES:'), p.slice(0, 8).join(' | '));
  assert.ok(p.includes('BASIC QUALIFICATIONS:'));
  assert.ok(p.includes('ITAR REQUIREMENTS:'));
  const resp = p.indexOf('RESPONSIBILITIES:');
  assert.equal(p[resp + 1].slice(0, 22), 'Work closely with test');
  assert.ok(p.every((x) => x.length <= 700), 'no paragraph is a wall');
  // Real newlines (rows ingested after 2026-10-24) are the paragraphs.
  assert.deepEqual(paragraphs('Intro line.\nRESPONSIBILITIES:\n• one\n• two'), ['Intro line.', 'RESPONSIBILITIES:', '• one', '• two']);
  // The teaser keeps its heading separate from the body.
  assert.deepEqual(paragraphs(ADZ).slice(1, 2), ['SR. ACCOUNTANT (LATAM) RESPONSIBILITIES:']);
  // Title-case section words split too; a leading Category tag is dropped.
  const t = paragraphs('Great store with a friendly team. Responsibilities: Greet guests. Requirements: Be on time.');
  assert.deepEqual(t, ['Great store with a friendly team.', 'Responsibilities: Greet guests.', 'Requirements: Be on time.']);
  assert.deepEqual(paragraphs('Category: Retail\nGreat store with a friendly team.'), ['Great store with a friendly team.']);
  assert.deepEqual(paragraphs(''), []);
});

test('roleSnippet: the first sentence about the ROLE, not the company mission', () => {
  const s = roleSnippet(GH, 'SpaceX', 'Construction Safety Engineer');
  assert.equal(s.slice(0, 47), 'As part of a team of technicians and engineers,');
  assert.ok(s.length <= 161, s);
  assert.match(s, /…$/);
  assert.doesNotMatch(s, /CONSTRUCTION SAFETY ENGINEER/);
  const a = roleSnippet(ADZ, 'SpaceX', 'Sr. Accountant (LATAM)');
  assert.equal(a.slice(0, 32), 'Support Latin America operations');
  assert.doesNotMatch(a, /fina…/, 'the teaser\'s cut word is gone');
  // Two postings with the same opener read differently on a card.
  assert.notEqual(s, a);
  // A comma-carrying heading is stripped whole.
  const c = roleSnippet(MISSION + ' ACCOUNT LEAD, STARLINK STRATEGIC CONNECTIVITY The Starlink Enterprise Account Management team serves as the point of contact for enterprise customers.', 'SpaceX', 'Account Lead, Starlink Strategic Connectivity');
  assert.equal(c.slice(0, 23), 'The Starlink Enterprise');
  // A slug-named employer is still recognised in its own text ("…at ALO" for board "aloyoga").
  const alo = roleSnippet('WHY JOIN ALO? Mindful movement. It is at the core of why we do what we do at ALO. SALES ASSOCIATE The Sales Associate drives sales and creates an elevated guest experience on the floor every day.', 'aloyoga', 'Sales Associate');
  assert.equal(alo.slice(0, 36), 'The Sales Associate drives sales and');
  // Nothing but company sentences → falls back to the start rather than nothing.
  assert.equal(roleSnippet(MISSION, 'SpaceX', 'Engineer').slice(0, 18), 'SpaceX was founded');
  assert.equal(roleSnippet('', 'SpaceX', 'Engineer'), '');
  // Plain text without a company opener starts at the start, cut at a word.
  assert.equal(roleSnippet('Greet guests and run the register at our Phoenix store. Weekends required.', 'PLS', 'Cashier'), 'Greet guests and run the register at our Phoenix store. Weekends required.');
});

test('preferFullText: an Adzuna teaser hides behind the employer-board row of the same posting', () => {
  const full = { id: '1', company: 'SpaceX', title: 'Sr. Accountant (LATAM)', source: 'Greenhouse', description: GH };
  const teaser = { id: '2', company: 'spacex', title: 'Sr. Accountant (LATAM)', source: 'Adzuna', description: ADZ };
  const other = { id: '3', company: 'SpaceX', title: 'Welder', source: 'Adzuna', description: ADZ };
  assert.deepEqual(preferFullText([teaser, full, other]).map((j) => j.id), ['1', '3']);
  assert.deepEqual(preferFullText([teaser, other]).map((j) => j.id), ['2', '3'], 'no full-text twin → the teaser stays');
  assert.deepEqual(preferFullText([]), []);
});
