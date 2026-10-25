// Render a fixture résumé as a PDF in the "first-line indent only" bullet style (pdfkit `indent`:
// the bullet line is indented, every wrapped line returns to the left margin) — the layout that
// turned wrapped bullet lines into fake jobs — then upload it through the real parse path.
import PDFDocument from 'pdfkit';

const SECTION_RE = /^(SUMMARY|PROFILE|OBJECTIVE|EXPERIENCE|WORK EXPERIENCE|TEACHING EXPERIENCE|PROFESSIONAL SUMMARY|EDUCATION|SKILLS|TOOLS|CERTIFICATIONS|LICENSES & CERTIFICATIONS|LICENSURE|Experience|Skills|Education)$/;
const BULLET_RE = /^\s*[•\-*]\s+/;

/** Résumé text → blocks; a bullet's continuation lines (indented, no bullet) join the bullet. */
function blocks(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { out.push({ kind: 'gap' }); continue; }
    if (BULLET_RE.test(line)) { out.push({ kind: 'bullet', text: line.replace(BULLET_RE, '') }); continue; }
    const prev = out[out.length - 1];
    if (/^\s{2,}\S/.test(raw) && prev && prev.kind === 'bullet') { prev.text += ' ' + line.trim(); continue; }
    out.push({ kind: SECTION_RE.test(line.trim()) ? 'section' : 'line', text: line.trim().replace(/\s{3,}/g, '   ') });
  }
  return out;
}

export function renderHangingIndentPdf(resumeText) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 72, right: 72 }, info: { Title: 'Resume' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 144;
    const bs = blocks(resumeText);
    let first = true;
    for (const b of bs) {
      if (b.kind === 'gap') { doc.moveDown(0.35); continue; }
      if (first) { doc.font('Helvetica-Bold').fontSize(17).text(b.text, { width: W, align: 'left' }); first = false; continue; }
      if (b.kind === 'section') { doc.moveDown(0.2); doc.font('Helvetica-Bold').fontSize(11).text(b.text.toUpperCase(), { width: W }); continue; }
      if (b.kind === 'bullet') { doc.font('Helvetica').fontSize(11).text(`•  ${b.text}`, { width: W, indent: 14, lineGap: 1 }); continue; }
      const isRole = /\b(19|20)\d\d\b/.test(b.text) && /[—|,]/.test(b.text);
      doc.font(isRole ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).text(b.text, { width: W });
    }
    doc.end();
  });
}
