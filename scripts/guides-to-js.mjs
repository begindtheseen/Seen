#!/usr/bin/env node
// Turn the hand-written company interview guides (JSON) into the JS modules api/*.js can import without a
// bundler configuration: node scripts/guides-to-js.mjs <dir-with-retail.json,services.json,tech.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/guides-to-js.mjs <dir>'); process.exit(1); }
const AUD = new Set(['all', 'hourly', 'corporate', 'tech']);
for (const g of ['retail', 'services', 'tech']) {
  let raw; try { raw = JSON.parse(readFileSync(resolve(dir, `${g}.json`), 'utf8')); } catch { console.log(g, 'no file yet — kept as is'); continue; }
  const guides = (raw.guides || []).filter((x) => Array.isArray(x.names) && x.names.length && /^(?:high|medium)$/.test(x.confidence || ''));
  for (const x of guides) {
    x.questions = (x.questions || []).filter((q) => q && q.q && q.why && (!q.audience || AUD.has(q.audience)));
    for (const k of Object.keys(x.format || {})) if (!x.format[k]) delete x.format[k];
  }
  const out = `// Generated from the hand-written ${g}.json (scripts/guides-to-js.mjs) — edit the JSON, not this file.\n// ${guides.length} companies. Every sentence is hedged and limited to what the company publishes or what is\n// consistently reported in public; see lib/server/interviewGuides.js.\nexport default ${JSON.stringify({ group: g, guides }, null, 1)};\n`;
  writeFileSync(resolve(new URL('../lib/server/guides/', import.meta.url).pathname, `${g}.js`), out);
  console.log(g, guides.length, 'guides;', (raw.skipped || []).length, 'skipped');
}
