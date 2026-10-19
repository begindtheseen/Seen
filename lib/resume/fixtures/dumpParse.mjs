// Dev helper: node lib/resume/fixtures/dumpParse.mjs <file.pdf|.docx|.txt> — prints the parsed doc.
import fs from 'fs';
import { extractResumeFile } from '../extract/index.js';
import { parseResume } from '../parse/index.js';
import { serializeToText } from '../model.js';
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  const ex = await extractResumeFile({ buffer: buf, fileName: f });
  if (!ex.ok) { console.log('EXTRACT FAIL', ex); continue; }
  const doc = parseResume({ text: ex.text, lines: ex.lines, source: ex.fileType, layout: ex.layout, fileName: f });
  const { meta, ...rest } = doc;
  console.log(`\n===== ${f}`);
  console.log(JSON.stringify({ basics: rest.basics, experience: rest.experience.map(e => ({ title: e.title, company: e.company, location: e.location, type: e.employmentType, start: e.start, end: e.end, bullets: e.bullets.length, summary: e.summary.slice(0, 60) })), education: rest.education, skills: rest.skills, certifications: rest.certifications.map(c => [c.name, c.issuer, c.date]), languages: rest.languages, extra: rest.extra.map(x => [x.title, x.items.length]), order: rest.sectionOrder, confidence: meta.confidence, warnings: meta.warnings.map(w => w.code) }, null, 1));
  if (process.env.TEXT) console.log(serializeToText(doc));
}
