// Template catalogue for the résumé renderers (PDF + DOCX share it; the UI lists it).
//
// Every template is ONE column, real text, standard section headings, no tables, no text boxes,
// no icons — the structure every applicant-tracking system parses correctly. They differ in
// typography and header layout only, so the ATS round-trip check (atsCheck.js) holds for all three.
//
//   classic      serif, centered header, ruled uppercase headings, company-first role lines —
//                the conservative default (law, finance, healthcare, government, trades).
//   engineering  sans-serif, compact leading, title-first role lines with dates flush right,
//                skills as labelled lines — fits a dense technical résumé on one page.
//   modern       sans-serif with ONE accent colour on the name and headings, title-first — for
//                design, marketing, product and startup roles where "current" matters.

export const TEMPLATES = Object.freeze({
  classic: Object.freeze({
    id: 'classic',
    label: 'Classic',
    tagline: 'Serif · centered header · ruled headings',
    description: 'The conservative standard: serif type, centered name, uppercase headings with a hairline rule. Parses perfectly everywhere.',
    family: 'serif',          // PDF: Times family (built-in); DOCX: Georgia
    header: 'center',
    roleLayout: 'company-first',
    accent: '#000000',
    docxFont: 'Georgia',
    sizes: { name: 20, headline: 10.5, body: 10.5, heading: 11.5, meta: 10 },
    margin: 58,
    lineGap: 2,
    bulletIndent: 14,
    headingStyle: 'rule',
  }),
  engineering: Object.freeze({
    id: 'engineering',
    label: 'Engineering',
    tagline: 'Sans-serif · compact · dates flush right',
    description: 'Dense and scannable: sans-serif type, title-first role lines with dates on the right, labelled skill lines. Fits more on one page.',
    family: 'sans',           // PDF: Helvetica family (built-in); DOCX: Arial
    header: 'left',
    roleLayout: 'title-first',
    accent: '#000000',
    docxFont: 'Arial',
    sizes: { name: 17, headline: 10, body: 10, heading: 9.5, meta: 9.5 },
    margin: 48,
    lineGap: 1.6,
    bulletIndent: 12,
    headingStyle: 'rule',
  }),
  modern: Object.freeze({
    id: 'modern',
    label: 'Modern',
    tagline: 'Sans-serif · one accent colour',
    description: 'Clean and current: a single accent colour on the name and headings, generous spacing, still one column and fully parseable.',
    family: 'embedded-sans',  // PDF: Liberation Sans (embedded, OFL); DOCX: Calibri
    header: 'left',
    roleLayout: 'title-first',
    accent: '#1f5fbf',
    docxFont: 'Calibri',
    sizes: { name: 22, headline: 11, body: 10.5, heading: 10, meta: 10 },
    margin: 54,
    lineGap: 2.2,
    bulletIndent: 13,
    headingStyle: 'bar',
  }),
});

export const DEFAULT_TEMPLATE = 'classic';

/** Resolve a template id (tolerant: unknown → classic). */
export function resolveTemplate(id) {
  const key = String(id || '').toLowerCase().trim();
  return TEMPLATES[key] || TEMPLATES[DEFAULT_TEMPLATE];
}

/** Public catalogue for the UI (no renderer internals). */
export function listTemplates() {
  return Object.values(TEMPLATES).map((t) => ({ id: t.id, label: t.label, tagline: t.tagline, description: t.description, accent: t.accent, header: t.header, roleLayout: t.roleLayout }));
}

/** Accept a user accent colour only when it is a 6-digit hex that is dark enough to print. */
export function safeAccent(hex, fallback) {
  const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 150 ? `#${m[1].toLowerCase()}` : fallback;
}
