// A prep answer's text with its [blanks], and the finished answer once the person has filled them in.
// Pure, shared by the tracker card and its tests. The blanks are the only words Seen did not take from the
// résumé or the posting; what the person types replaces them one for one.

export type AnswerPart = { text: string } | { blank: string; index: number }

/** "At X, I did Y. [What made it hard.] Z." → [{text}, {blank, index:0}, {text}] */
export function splitAnswer(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = []
  const re = /\[([^\]]+)\]/g
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  const s = String(answer || '')
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index) })
    parts.push({ blank: m[1].trim(), index: i++ })
    last = m.index + m[0].length
  }
  if (last < s.length) parts.push({ text: s.slice(last) })
  return parts
}

/** How many blanks an answer has. */
export const blankCount = (answer: string): number => splitAnswer(answer).filter(p => 'blank' in p).length

// One typed sentence, tidied: trimmed, a capital first letter, a full stop at the end — but only where the
// blank IS a sentence. A blank inside a sentence ("Hi [interviewer's name]," / "…because [the one thing]") keeps
// the person's own case and takes no stop, and the text around it keeps its line breaks (round 5, Tasha: the
// thank-you email came out as one line reading "Hi Ms. Okafor., … year.,").
function tidy(v: string, { startsSentence, endsSentence }: { startsSentence: boolean; endsSentence: boolean }): string {
  let t = String(v || '').replace(/[ \t]+/g, ' ').trim()
  if (!t) return ''
  if (startsSentence) t = t.charAt(0).toUpperCase() + t.slice(1)
  if (endsSentence && !/[.!?]$/.test(t)) t = `${t}.`
  if (!endsSentence) t = t.replace(/[.]+$/, '')
  return t
}

/**
 * The finished answer: every blank the person filled becomes their words; an unfilled blank stays as the
 * bracketed prompt. Spacing and stops are tidied so it reads as one spoken answer; line breaks in the given
 * text (an email) are kept.
 */
export function composeAnswer(answer: string, values: string[] = []): string {
  const parts = splitAnswer(answer)
  const out = parts.map((p, i) => {
    if (!('blank' in p)) return p.text
    const v = values[p.index]?.trim()
    if (!v) return `[${p.blank}]`
    const before = parts.slice(0, i).map(x => ('blank' in x ? '' : x.text)).join('')
    const after = parts.slice(i + 1).map(x => ('blank' in x ? 'X' : x.text)).join('')
    const startsSentence = /^\s*$/.test(before) || /[.!?]\s*$|\n\s*$/.test(before)
    // a sentence ends here unless the given text carries on with a lowercase word or punctuation of its own
    const endsSentence = /^\s*$/.test(after) || /^\s*\n/.test(after) || /^\s+[A-Z[]/.test(after)
    return tidy(v, { startsSentence, endsSentence })
  }).join('')
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n /g, '\n')
    .replace(/ +([.,;!?])/g, '$1')
    .replace(/([.!?])\s*([.!?])/g, '$1')
    .trim()
}

/** True when every blank has words in it. */
export function isFinished(answer: string, values: string[] = []): boolean {
  const n = blankCount(answer)
  if (!n) return true
  for (let i = 0; i < n; i++) if (!values[i]?.trim()) return false
  return true
}
