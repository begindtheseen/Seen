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

// One typed sentence, tidied: trimmed, a capital first letter, a full stop at the end.
function sentence(v: string): string {
  const t = String(v || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const cap = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?]$/.test(cap) ? cap : `${cap}.`
}

/**
 * The finished answer: every blank the person filled becomes their sentence; an unfilled blank stays as the
 * bracketed prompt. Spacing and stops are tidied so it reads as one spoken answer.
 */
export function composeAnswer(answer: string, values: string[] = []): string {
  const out = splitAnswer(answer).map(p => ('blank' in p ? (values[p.index]?.trim() ? sentence(values[p.index]) : `[${p.blank}]`) : p.text)).join('')
  return out.replace(/\s+/g, ' ').replace(/\s+([.,;!?])/g, '$1').replace(/([.!?])\s*([.!?])/g, '$1').trim()
}

/** True when every blank has words in it. */
export function isFinished(answer: string, values: string[] = []): boolean {
  const n = blankCount(answer)
  if (!n) return true
  for (let i = 0; i < n; i++) if (!values[i]?.trim()) return false
  return true
}
