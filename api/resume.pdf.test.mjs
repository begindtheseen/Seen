// PDF-layout tests for the résumé export — pagination + empty-bullet safety.
//
// Run with: node --test api/resume.pdf.test.mjs
//
// These are DETERMINISTIC: we inspect the generated PDF bytes directly. We map
// each page object to its content stream, inflate the stream, and count text
// blocks (BT operators) per page. The pagination bug we fixed produced a page
// with a single stray "•" (one tiny text block) followed by a huge blank gap
// and content resuming on the NEXT page. So the core invariant is:
//   no page BEFORE the last page may be "near-empty" (have far fewer text
//   blocks than a normal content page).

import assert from 'node:assert';
import test from 'node:test';
import zlib from 'node:zlib';
import { buildResumePDF } from './resume.js';
import { buildResumeDocument } from '../lib/server/resumeAnalysis.js';

// Map every PDF page (in document order) to the count of text blocks (BT) in its
// content stream. Returns an array: textBlocksPerPage[i] for page i.
function textBlocksPerPage(pdf) {
  const s = pdf.toString('latin1');

  // 1) Collect inflated content streams keyed by their object number.
  //    Objects look like:  "<n> 0 obj ... stream\n<bytes>endstream ... endobj"
  const streamByObj = new Map();
  const objRe = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  let m;
  while ((m = objRe.exec(s)) !== null) {
    const objNum = m[1];
    const body = m[2];
    const si = body.indexOf('stream');
    if (si < 0) continue;
    let start = si + 'stream'.length;
    while (body[start] === '\r' || body[start] === '\n') start++;
    const endIdx = body.indexOf('endstream', start);
    if (endIdx < 0) continue;
    const raw = Buffer.from(body.slice(start, endIdx), 'latin1');
    let inflated = '';
    try { inflated = zlib.inflateSync(raw).toString('latin1'); }
    catch { continue; } // not a flate stream (e.g. font) — skip
    streamByObj.set(objNum, inflated);
  }

  // 2) Find page objects in order, and the content stream object each references
  //    via its /Contents <n> 0 R entry.
  const pages = [];
  const pageRe = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>\s*endobj/g;
  while ((m = pageRe.exec(s)) !== null) {
    const dict = m[2];
    if (!/\/Type\s*\/Page\b/.test(dict) || /\/Type\s*\/Pages\b/.test(dict)) continue;
    const cm = dict.match(/\/Contents\s+(\d+)\s+0\s+R/);
    pages.push(cm ? cm[1] : null);
  }

  return pages.map(objNum => {
    const stream = objNum != null ? streamByObj.get(objNum) : '';
    if (!stream) return 0;
    return (stream.match(/\bBT\b/g) || []).length;
  });
}

// A realistic LONG résumé (12 roles) that forces multiple pages.
const LONG_RESUME = (() => {
  const roles = [
    ['Instacart', 'Operations Lead', 'Mar 2022 - Present'],
    ['Aptera Motors', 'Assembly Technician', 'Jan 2021 - Feb 2022'],
    ['Chipotle Mexican Grill', 'Kitchen Manager', 'Jun 2019 - Dec 2020'],
    ['FedEx Ground', 'Package Handler', 'Aug 2017 - May 2019'],
    ["Applebee's", 'Shift Supervisor', 'Feb 2015 - Jul 2017'],
    ['Office Depot', 'Administrative Assistant', 'Mar 2013 - Jan 2015'],
    ['Target', 'Sales Floor Associate', 'Jun 2011 - Feb 2013'],
    ['UPS Store', 'Customer Service Associate', 'Jan 2010 - May 2011'],
    ['Walmart', 'Cashier', 'Aug 2008 - Dec 2009'],
    ['Starbucks', 'Barista', 'Jan 2007 - Jul 2008'],
    ['Home Depot', 'Lot Associate', 'Jun 2005 - Dec 2006'],
    ['McDonalds', 'Crew Member', 'Jan 2004 - May 2005'],
  ];
  let r = `Jordan Avery Mitchell
San Diego, CA   ·   (619) 555-0142   ·   jordan.mitchell@example.com   ·   linkedin.com/in/jordanmitchell

SUMMARY
Versatile operations and customer service professional with fifteen years of experience.

EXPERIENCE
`;
  roles.forEach(([co, title, dates], i) => {
    r += `${co} — ${title}    ${dates}\n`;
    r += `• Responsible for coordinating a team of ${20 + i} staff across multiple zones to meet demanding daily service windows on schedule\n`;
    r += `• Worked on reducing operational errors by redesigning the workflow at ${co}, cutting rework by ${10 + i} percent over two quarters\n`;
    r += `• Helped train ${15 + i} new employees on procedures, safety policy, and customer communication standards\n`;
    r += `• Handled escalated customer complaints and recovered ${90 + (i % 10)} percent of at-risk accounts through follow-up\n\n`;
  });
  r += `SKILLS: Customer Service, Scheduling, Inventory Management, Team Leadership, Food Safety

EDUCATION
San Diego City College — Associate of Arts in Business Administration, 2010
Lincoln High School — High School Diploma, 2008`;
  return r;
})();

test('empty/whitespace bullets are dropped at the document layer', () => {
  const resume = `Jane Doe
San Diego, CA  ·  jane@example.com

EXPERIENCE
Acme Corp — Engineer    Jan 2020 - Present
• Built a real shipping pipeline that moved 2 million events daily
•
•
• Led a team of five engineers to deliver on time`;
  const doc = buildResumeDocument({ resume, job: 'Engineer', company: 'Acme' });
  assert.ok(doc.experience.length >= 1, 'has an experience entry');
  for (const e of doc.experience) {
    for (const b of e.bullets) {
      assert.ok(String(b).trim().length > 0, `no empty bullet survives: "${b}"`);
      assert.ok(/[a-z0-9]/i.test(b), `bullet has real content: "${b}"`);
    }
  }
});

test('long résumé paginates with no near-empty page before the last page', async () => {
  const doc = buildResumeDocument({
    resume: LONG_RESUME,
    jobDescription: 'customer service scheduling inventory',
    job: 'Customer Service Representative',
    company: 'Acme',
  });
  const pdf = await buildResumePDF(doc, { role: 'Customer Service Representative', company: 'Acme' });

  const perPage = textBlocksPerPage(pdf);
  assert.ok(perPage.length >= 2, `spans multiple pages (got ${perPage.length})`);

  // A normal, full content page in this résumé carries many text blocks (a
  // section heading + multiple role headers + many bullets). The bug produced a
  // page with ~1 text block (a stray "•"). Assert every page EXCEPT the last
  // (which is a legitimate overflow tail) carries a healthy amount of content.
  const NEAR_EMPTY = 6; // a page with fewer than this many text blocks is suspect
  for (let i = 0; i < perPage.length - 1; i++) {
    assert.ok(
      perPage[i] >= NEAR_EMPTY,
      `page ${i + 1} of ${perPage.length} is near-empty (only ${perPage[i]} text blocks) — pagination gap regressed. perPage=${JSON.stringify(perPage)}`,
    );
  }
});

test('injecting blank bullets does not create extra or near-empty pages', async () => {
  // Build the doc, then inject empty/whitespace bullets directly into the
  // structured experience to prove the RENDERER also drops them (defense in
  // depth) and they never spawn a phantom page or stray "•".
  const clean = buildResumeDocument({
    resume: LONG_RESUME,
    job: 'Customer Service Representative',
    company: 'Acme',
  });
  const dirty = JSON.parse(JSON.stringify(clean));
  for (const e of dirty.experience) {
    e.bullets = e.bullets.flatMap(b => ['', '   ', b, '  ']);
  }

  const cleanPdf = await buildResumePDF(clean, { role: 'X' });
  const dirtyPdf = await buildResumePDF(dirty, { role: 'X' });

  const cleanPages = textBlocksPerPage(cleanPdf).length;
  const dirtyPages = textBlocksPerPage(dirtyPdf).length;
  assert.strictEqual(dirtyPages, cleanPages, `blank bullets must not add pages (clean=${cleanPages}, dirty=${dirtyPages})`);

  const perPage = textBlocksPerPage(dirtyPdf);
  const NEAR_EMPTY = 6;
  for (let i = 0; i < perPage.length - 1; i++) {
    assert.ok(perPage[i] >= NEAR_EMPTY, `page ${i + 1} near-empty after blank-bullet injection: ${JSON.stringify(perPage)}`);
  }
});

test('short résumé fits on a single page', async () => {
  const resume = `John Doe
San Diego, CA  ·  john@example.com  ·  linkedin.com/in/johndoe

SUMMARY
Backend engineer with eight years building scalable systems.

EXPERIENCE
Acme Corp — Senior Engineer    Jan 2020 - Present
• Built data pipelines processing two million events daily
• Led a team of five engineers to ship three products

Globex Inc — Engineer    Jun 2017 - Dec 2019
• Built REST APIs serving fifty thousand users

SKILLS: Python, AWS, SQL

EDUCATION
State University — B.S. in Computer Science, 2017`;
  const doc = buildResumeDocument({ resume, job: 'Senior Engineer', company: 'BigCo' });
  const pdf = await buildResumePDF(doc, { role: 'Senior Engineer', company: 'BigCo' });
  const perPage = textBlocksPerPage(pdf);
  assert.strictEqual(perPage.length, 1, `short résumé is one page (got ${perPage.length})`);
});
