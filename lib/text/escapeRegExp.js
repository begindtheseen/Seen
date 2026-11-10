// The ONE regex-escape helper. Any value that did not come from a literal in this codebase (a job
// title, posting text, a résumé word, a credential mark) goes through this before `new RegExp(...)`.
// Named `escapeRegExp` on purpose: it is the form CodeQL's js/regex-injection query recognises as a
// sanitizer (the older local `escRe` helpers are not recognised by name — use this instead).
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
