// One tap re-files a line the parser placed on weak evidence (doc.meta.fidelity.uncertain[] — lib/resume/parse,
// "ask, don't assert"). Pure: returns a new document; the words of the line are never changed, only where it sits.
//
// Questions (uncertainQuestion) and answers (refile):
//  - a line read as PART of a job ("Safety Council, 2022 – present" under Warehouse Lead): is it a job of its own?
//      yes → its own experience entry (dates read from the line), right after that job · no → stays a line of that job
//  - a line read as a JOB: is it a job?   yes → stays · no → its entry moves, word for word, to Additional Information
//  - a line filed under another section by what it says ("Rio Salado College…" → education): is that right?
//      yes → stays · no, it's a job → its own experience entry
//  - a job with no employer: nothing to choose — the person adds it in the editor
import { normalizeDoc, newId } from '../../lib/resume/model.js'
import { findDateRange, parseDateToken, toToken } from '../../lib/resume/parse/dates.js'

const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim()
const eq = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase()
const SECTION_WORD = { education: 'Education', certifications: 'Certifications', skills: 'Skills', summary: 'Summary', projects: 'Projects', languages: 'Languages', experience: 'Experience' }

function locate(doc, line) {
  for (const e of doc.experience || []) {
    const b = (e.bullets || []).find((x) => eq(x.text, line))
    if (b) return { kind: 'bullet', role: e, bullet: b }
  }
  const entry = (doc.experience || []).find((e) => eq(e.title, line) || eq([e.title, e.company].filter(Boolean).join(', '), line) || clean(line).toLowerCase().startsWith(clean(e.title).toLowerCase() + ' ') && clean(e.title).length > 3)
  if (entry) return { kind: 'entry', role: entry }
  return null
}

/**
 * @param {object} doc
 * @param {{ line: string, placedIn: string, why: string }} u
 * @returns {null | { kind: 'part'|'job'|'section'|'note', question: string, yes: string, no: string, why: string }}
 */
export function uncertainQuestion(doc, u) {
  if (!u || !clean(u.line)) return null
  const line = clean(u.line)
  const why = clean(u.why)
  if (/no employer/i.test(why)) return { kind: 'note', question: `“${line}” has no employer on your résumé.`, yes: '', no: '', why }
  if (u.placedIn === 'experience') {
    const at = locate(doc, line)
    if (at && at.kind === 'bullet') {
      const job = [at.role.displayTitle || at.role.title, at.role.displayCompany || at.role.company].filter(Boolean).join(' at ')
      return { kind: 'part', question: `Is “${line}” a job of its own?`, yes: 'Yes, a job of its own', no: job ? `No, it's part of ${job}` : 'No, keep it where it is', why }
    }
    return { kind: 'job', question: `Is “${line}” a job?`, yes: 'Yes, a job', no: 'No — move it to Additional Information', why }
  }
  const where = SECTION_WORD[u.placedIn] || clean(u.placedIn)
  return { kind: 'section', question: `Does “${line}” belong under ${where}?`, yes: `Yes, keep it under ${where}`, no: "No — it's a job", why }
}

function entryFromLine(line) {
  const r = findDateRange(line)
  let start = '', end = '', dateText = ''
  let title = clean(line)
  if (r) { start = r.start; end = r.end; dateText = r.raw; title = clean(title.replace(r.raw, '')) }
  else { const m = line.match(/\b(?:19|20)\d{2}\b/); if (m) { const tok = parseDateToken(m[0]); if (tok && tok !== 'present') { start = toToken(tok); dateText = m[0]; title = clean(title.replace(m[0], '')) } } }
  title = title.replace(/[\s,;|–—-]+$/, '').trim()
  return { id: newId('x'), title, company: '', location: '', employmentType: '', start, end, dateText, summary: '', bullets: [] }
}

function dropUncertain(d, line) {
  if (d.meta && d.meta.fidelity && Array.isArray(d.meta.fidelity.uncertain)) d.meta.fidelity.uncertain = d.meta.fidelity.uncertain.filter((x) => !eq(x.line, line))
}

/**
 * @param {object} docIn
 * @param {{ line: string, placedIn: string, why: string }} u
 * @param {'yes'|'no'} answer
 */
export function refile(docIn, u, answer) {
  const d = normalizeDoc(JSON.parse(JSON.stringify(docIn)))
  const q = uncertainQuestion(d, u)
  const line = clean(u.line)
  dropUncertain(d, line)
  if (!q || q.kind === 'note') return d
  const moveToJob = (q.kind === 'part' && answer === 'yes') || (q.kind === 'section' && answer === 'no')
  const moveToNotes = q.kind === 'job' && answer === 'no'
  if (moveToJob) {
    const at = locate(d, line)
    let after = -1
    if (at && at.kind === 'bullet') { at.role.bullets = at.role.bullets.filter((b) => b.id !== at.bullet.id); after = d.experience.indexOf(at.role) }
    else {
      d.education = (d.education || []).filter((e) => !(clean(line).toLowerCase().startsWith(clean(e.school).toLowerCase()) && clean(e.school)))
      d.certifications = (d.certifications || []).filter((c) => !eq(c.text || c.name, line))
      for (const x of d.extra || []) x.items = x.items.filter((i) => !eq(i.text, line))
    }
    d.experience.splice(after >= 0 ? after + 1 : d.experience.length, 0, entryFromLine(line))
    if (!d.sectionOrder.includes('experience')) d.sectionOrder.unshift('experience')
  } else if (moveToNotes) {
    const at = locate(d, line)
    if (at && at.kind === 'entry') {
      d.experience = d.experience.filter((e) => e.id !== at.role.id)
      let notes = (d.extra || []).find((x) => /additional information/i.test(x.title))
      if (!notes) { notes = { id: newId('e'), kind: 'custom', title: 'Additional Information', items: [] }; d.extra.push(notes); d.sectionOrder.push(`extra:${notes.id}`) }
      notes.items.push({ id: newId('b'), text: line }, ...at.role.bullets.map((b) => ({ id: b.id, text: b.text })))
    }
  }
  return normalizeDoc(d)
}
