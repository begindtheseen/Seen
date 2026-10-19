// JSON Resume (https://jsonresume.org/schema) export + import.
//
// Seen's ResumeDoc is a superset of JSON Resume, so the mapping is lossless for everything the
// public schema can hold (basics, work, education, skills, certificates, projects, languages,
// awards/publications/volunteer/interests). What JSON Resume cannot carry (ids, provenance, the
// tailoring metadata) stays in `x-seen` so a round trip through our own export keeps it.
// Dates: JSON Resume uses ISO strings; we emit YYYY-MM (or YYYY) and read any ISO prefix.

import { normalizeDoc, splitSkillList, inferLinkKind } from '../model.js';
import { formatRange } from '../parse/dates.js';

const iso = (tok) => (tok && tok !== 'present' ? String(tok) : undefined);
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === '' || (Array.isArray(o[k]) && !o[k].length)) delete o[k]; return o; };
const KIND_TO_NETWORK = { linkedin: 'LinkedIn', github: 'GitHub', portfolio: 'Portfolio', other: 'Website' };

export function toJsonResume(docIn) {
  const d = normalizeDoc(docIn);
  const b = d.basics;
  const first = b.links[0];
  const out = {
    $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
    basics: clean({
      name: b.name, label: b.headline, email: b.email, phone: b.phone, url: first ? first.url : undefined, summary: b.summary,
      location: b.location ? clean({ city: b.location }) : undefined,
      profiles: b.links.map((l) => clean({ network: KIND_TO_NETWORK[l.kind] || 'Website', username: l.label, url: l.url })),
    }),
    work: d.experience.map((e) => clean({ name: e.company, position: e.title, location: e.location, startDate: iso(e.start), endDate: iso(e.end), summary: e.summary, highlights: e.bullets.map((x) => x.text), 'x-seen': clean({ id: e.id, employmentType: e.employmentType, dateText: e.dateText, current: e.end === 'present' || undefined }) })),
    education: d.education.map((e) => clean({ institution: e.school, area: e.field, studyType: e.degree, startDate: iso(e.start), endDate: iso(e.end), score: e.gpa, courses: e.details.map((x) => x.text), 'x-seen': clean({ id: e.id, location: e.location, dateText: e.dateText }) })),
    skills: d.skills.map((g) => clean({ name: g.label, keywords: g.items, 'x-seen': { id: g.id } })),
    certificates: d.certifications.map((c) => clean({ name: c.name || c.text, issuer: c.issuer, date: iso(c.date), 'x-seen': clean({ id: c.id, text: c.text }) })),
    projects: d.projects.map((p) => clean({ name: p.name, description: p.summary, highlights: p.bullets.map((x) => x.text), url: p.url, roles: p.role ? [p.role] : undefined, startDate: iso(p.start), endDate: iso(p.end), 'x-seen': clean({ id: p.id, dateText: p.dateText, current: p.end === 'present' || undefined }) })),
    languages: d.languages.map((l) => clean({ language: l.name, fluency: l.level, 'x-seen': { id: l.id } })),
    awards: [], publications: [], volunteer: [], interests: [],
    'x-seen': { schema: d.schema, id: d.id, kind: d.kind, sectionOrder: d.sectionOrder, extra: [], meta: d.meta },
  };
  for (const x of d.extra) {
    if (x.kind === 'awards') out.awards.push(...x.items.map((it) => ({ title: it.text })));
    else if (x.kind === 'publications') out.publications.push(...x.items.map((it) => ({ name: it.text })));
    else if (x.kind === 'volunteer') out.volunteer.push(...x.items.map((it) => ({ organization: it.text, summary: it.text })));
    else if (x.kind === 'interests') out.interests.push(...x.items.map((it) => ({ name: it.text })));
    else out['x-seen'].extra.push({ id: x.id, kind: x.kind, title: x.title, style: x.style, items: x.items.map((it) => it.text) });
  }
  for (const k of ['awards', 'publications', 'volunteer', 'interests']) if (!out[k].length) delete out[k];
  return out;
}

const tok = (s) => { const m = String(s || '').match(/^(\d{4})(?:-(\d{2}))?/); return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]) : ''; };
const arr = (v) => (Array.isArray(v) ? v : []);
// Our own export records `current`; a foreign JSON Resume marks an ongoing entry by omitting endDate.
const endTok = (e) => (e['x-seen'] && typeof e['x-seen'] === 'object' ? (e['x-seen'].current ? 'present' : tok(e.endDate)) : (e.endDate ? tok(e.endDate) : (e.startDate ? 'present' : '')));
const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** JSON Resume (any version) → ResumeDoc. Tolerates partial / foreign documents. */
export function fromJsonResume(json) {
  const j = json && typeof json === 'object' ? json : {};
  const b = j.basics && typeof j.basics === 'object' ? j.basics : {};
  const xs = j['x-seen'] && typeof j['x-seen'] === 'object' ? j['x-seen'] : {};
  const loc = b.location && typeof b.location === 'object' ? [b.location.city, b.location.region].map(str).filter(Boolean).join(', ') : str(b.location);
  const links = [];
  for (const p of arr(b.profiles)) if (p && str(p.url)) links.push({ kind: inferLinkKind(str(p.url)), url: str(p.url), label: str(p.username) });
  if (str(b.url) && !links.some((l) => l.url === str(b.url))) links.unshift({ kind: inferLinkKind(str(b.url)), url: str(b.url), label: '' });
  const doc = {
    id: xs.id, kind: xs.kind,
    basics: { name: str(b.name), headline: str(b.label), email: str(b.email), phone: str(b.phone), location: loc, links, summary: str(b.summary) },
    experience: arr(j.work).map((w) => ({ id: w['x-seen'] && w['x-seen'].id, title: str(w.position), company: str(w.name || w.company), location: str(w.location), employmentType: str(w['x-seen'] && w['x-seen'].employmentType), start: tok(w.startDate), end: endTok(w), dateText: str(w['x-seen'] && w['x-seen'].dateText), summary: str(w.summary), bullets: arr(w.highlights).map(str) })),
    education: arr(j.education).map((e) => ({ id: e['x-seen'] && e['x-seen'].id, school: str(e.institution), degree: str(e.studyType), field: str(e.area), location: str(e['x-seen'] && e['x-seen'].location), start: tok(e.startDate), end: tok(e.endDate), dateText: str(e['x-seen'] && e['x-seen'].dateText), gpa: str(e.score), details: arr(e.courses).map(str) })),
    skills: arr(j.skills).map((s) => ({ id: s['x-seen'] && s['x-seen'].id, label: str(s.name), items: arr(s.keywords).length ? arr(s.keywords).map(str) : splitSkillList(str(s.name)) })).map((g) => (arr(g.items).length && str(g.label) && g.items.join(',') === g.label ? { ...g, label: '' } : g)),
    certifications: arr(j.certificates).map((c) => ({ id: c['x-seen'] && c['x-seen'].id, name: str(c.name), issuer: str(c.issuer), date: tok(c.date), text: str(c['x-seen'] && c['x-seen'].text) || [str(c.name), str(c.issuer)].filter(Boolean).join(' — ') })),
    projects: arr(j.projects).map((p) => ({ id: p['x-seen'] && p['x-seen'].id, name: str(p.name), role: str(arr(p.roles)[0]), url: str(p.url), start: tok(p.startDate), end: endTok(p), dateText: str(p['x-seen'] && p['x-seen'].dateText), summary: str(p.description), bullets: arr(p.highlights).map(str) })),
    languages: arr(j.languages).map((l) => ({ id: l['x-seen'] && l['x-seen'].id, name: str(l.language), level: str(l.fluency) })),
    extra: [],
    sectionOrder: arr(xs.sectionOrder),
    meta: { ...(xs.meta && typeof xs.meta === 'object' ? xs.meta : {}), source: 'json-resume' },
  };
  const push = (kind, items) => { const it = items.filter(Boolean); if (it.length) doc.extra.push({ kind, title: '', items: it }); };
  push('awards', arr(j.awards).map((a) => [str(a.title), str(a.awarder), tok(a.date)].filter(Boolean).join(' — ')));
  push('publications', arr(j.publications).map((p) => [str(p.name), str(p.publisher), tok(p.releaseDate)].filter(Boolean).join(' — ')));
  push('volunteer', arr(j.volunteer).map((v) => [str(v.position), str(v.organization), formatRange(tok(v.startDate), tok(v.endDate))].filter(Boolean).join(' — ')));
  push('interests', arr(j.interests).map((i) => str(i.name)));
  for (const x of arr(xs.extra)) doc.extra.push({ id: x.id, kind: x.kind, title: x.title, style: x.style, items: arr(x.items).map(str) });
  const out = normalizeDoc(doc);
  // a foreign section order may name extras by ids we just regenerated — rebuild when it does not resolve
  if (out.sectionOrder.some((k) => k.startsWith('extra:') && !out.extra.some((x) => `extra:${x.id}` === k))) out.sectionOrder = normalizeDoc({ ...out, sectionOrder: [] }).sectionOrder;
  return out;
}
