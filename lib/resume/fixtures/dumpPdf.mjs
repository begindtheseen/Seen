// Dev helper: node lib/resume/fixtures/dumpPdf.mjs <file.pdf> — prints the extractor's rich lines.
import fs from 'fs';
import { extractPdfLayout } from '../extract/pdf.js';
for (const f of process.argv.slice(2)) {
  const r = await extractPdfLayout(fs.readFileSync(f));
  console.log(`\n===== ${f} ok=${r.ok} layout=${JSON.stringify(r.layout)} warnings=${JSON.stringify(r.warnings)}`);
  for (const l of r.lines) console.log(`${String(l.page)}:${l.column >= 0 ? l.column : 'F'} x=${l.x.toFixed(0).padStart(3)} sz=${l.size.toFixed(1).padStart(4)} ${l.bold ? 'B' : ' '}${l.italic ? 'I' : ' '} g=${l.gapAbove.toFixed(1)} ${l.bullet ? '• ' : '  '}${l.segments ? JSON.stringify(l.segments) : l.text}`);
}
