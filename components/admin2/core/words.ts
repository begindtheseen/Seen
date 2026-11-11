// One plural rule for the admin's sentences ("1 report" / "2 reports"; "1 group of duplicate names").
// Nouns are written PLURAL in specs ("stale listings", "duplicate copies", "listings nobody saved"); the singular is
// derived from the head noun — the first word that is a plural — unless a spec gives its own `one`.

/** "duplicate copies" → "duplicate copy", "listings nobody saved" → "listing nobody saved". Pure. */
export function singularNoun(noun: string): string {
  const words = noun.split(' ')
  const i = words.findIndex((w) => /[a-z]{2,}(?:ies|[^s]s)$/i.test(w) && !/(?:ss|us|is)$/i.test(w))
  if (i < 0) return noun
  const w = words[i]
  words[i] = /ies$/i.test(w) ? w.slice(0, -3) + 'y' : /(?:ches|shes|xes|zes)$/i.test(w) ? w.slice(0, -2) : w.slice(0, -1)
  return words.join(' ')
}

/** "1 report", "2 reports", "1,040 reports". `one` overrides the derived singular. Pure. */
export function counted(n: number, nounPlural: string, one?: string): string {
  const num = Math.round(n).toLocaleString('en-US')
  return `${num} ${Math.round(n) === 1 ? (one || singularNoun(nounPlural)) : nounPlural}`
}

/** A count still being checked (a counts read saying `checked: n of m`): never show a number that will change. */
export type Checking = { checked: number; total: number }
export const isChecking = (c?: Checking | null): c is Checking => !!c && c.checked < c.total
/** "checking 82 more…". Pure. */
export function checkingText(c: Checking): string {
  return `checking ${Math.max(0, Math.round(c.total - c.checked)).toLocaleString('en-US')} more…`
}
