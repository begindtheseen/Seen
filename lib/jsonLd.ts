// Safe serializer for embedding data inside a <script type="application/ld+json"> block.
//
// JSON.stringify does NOT escape '<', so any string value containing '</script>' (e.g. an
// attacker-chosen company name stored in company_scores) terminates the <script> element and
// the following markup executes as HTML — a stored/reflected XSS on a public, shareable page.
// Escaping '<' (plus '>' and '&' for completeness) renders the payload inert while remaining
// valid JSON-LD. Use everywhere a JSON-LD object is passed to dangerouslySetInnerHTML.
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}
