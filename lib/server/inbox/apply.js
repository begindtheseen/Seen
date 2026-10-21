// Inbox Autopilot — what one classified email changes in the user's tracker. Pure, no I/O.
//
//   planChange(cls, apps, { at }) → { action, appId, row, patch, share, reason }
//     action: create | update | none | unplaced | ignore
//
// The tracker's own data model (CLAUDE.md "Application Data Model" + api/user-sync.js add_application) is
// the contract: status ∈ active|ghosted|hired|rejected|withdrawn, stage ∈ STAGES or 'Rejected', events are
// { id, type, date(ms), source, confidence }. Email events carry source 'email', confidence 'high' — the
// employer's own email is the strongest evidence Seen ever gets — and data.vendor.
//
// Rules:
//   - Never move a card backwards: a stage only rises; a hired/withdrawn card is never reopened.
//   - An interview email reopens a card the user had marked ghosted (they did reply after all).
//   - The same event from email twice within 3 days is one event (two reminder emails, one interview).
//   - A rejection, offer or interview may be added to the company's grade — but only when the user taps
//     yes (share: the outcome to offer them). Nothing is filed for them.

import { nameKey } from '../../jobs/boardFinder.js';

export const STAGES = ['Applied', 'Viewed', 'Phone Screen', 'Interview', 'Final Round', 'Offer'];
const EVENT = { application_received: 'application_submitted', interview: 'interview_received', assessment: 'assessment_received', rejection: 'rejected', offer: 'offer_received' };
const SHARE = { rejection: 'rejected', offer: 'offer', interview: 'interview' };
const DAY = 86400e3;
const ROLE_STOP = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'at', 'in', 'to', '-', 'i', 'ii', 'iii', 'iv', 'sr', 'jr']);

function sameCompany(a, b) {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "chipotle" vs "chipotle mexican grill": one name is the other plus more words.
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 4 && l.startsWith(s + ' ');
}

function roleWords(r) {
  return new Set(String(r || '').toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w && !ROLE_STOP.has(w)));
}

/** Word overlap of two job titles, 0..1 (Jaccard). Unknown on either side → null. */
export function roleSimilarity(a, b) {
  const x = roleWords(a), y = roleWords(b);
  if (!x.size || !y.size) return null;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}

function appliedMs(app) {
  const t = Date.parse(app.applied_at || app.created_at || '');
  return Number.isFinite(t) ? t : 0;
}

/** The user's application this email is about, or null. */
export function findApplication(apps, company, role) {
  const same = (apps || []).filter((a) => sameCompany(a.company_name ?? a.company, company));
  if (!same.length) return null;
  const scored = same.map((a) => {
    const sim = roleSimilarity(a.role, role);
    return { a, sim, active: a.status === 'active' || a.status === 'ghosted' ? 1 : 0, at: appliedMs(a) };
  });
  // A clearly different job at the same company is a different application.
  const plausible = scored.filter((s) => s.sim == null || s.sim >= 0.34);
  if (!plausible.length) return null;
  plausible.sort((p, q) => ((q.sim ?? 0.5) - (p.sim ?? 0.5)) || (q.active - p.active) || (q.at - p.at));
  return plausible[0].a;
}

function readEvents(app) {
  let ev = app && app.events;
  if (typeof ev === 'string') { try { ev = JSON.parse(ev); } catch { ev = []; } }
  return Array.isArray(ev) ? ev : [];
}

function eventId(at, type) { return `em_${Math.floor(at / 1000).toString(36)}_${type.slice(0, 6)}`; }

export function planChange(cls, apps, { at = Date.now() } = {}) {
  const kind = cls && cls.kind;
  if (!EVENT[kind]) return { action: 'ignore', reason: `kind ${kind || 'none'}` };
  if (!cls.company) return { action: 'unplaced', reason: 'no company in the email' };
  const type = EVENT[kind];
  const evt = { id: eventId(at, type), type, date: at, source: 'email', confidence: 'high', data: { vendor: cls.vendor || null } };
  const share = SHARE[kind] || null;

  const app = findApplication(apps, cls.company, cls.role);
  if (!app) {
    const status = kind === 'rejection' ? 'rejected' : 'active';
    const stage = kind === 'rejection' ? 'Rejected' : kind === 'offer' ? 'Offer' : kind === 'interview' ? (cls.stage || 'Interview') : 'Applied';
    const events = kind === 'application_received' ? [evt]
      : [{ id: eventId(at, 'submit') + 'i', type: 'application_submitted', date: at, source: 'inferred', confidence: 'low' }, evt];
    return {
      action: 'create',
      row: { company_name: cls.company.slice(0, 120), role: (cls.role || '').slice(0, 120), city: '', platform: (cls.vendor || 'Email').slice(0, 40), status, stage, applied_at: new Date(at).toISOString(), events },
      share,
      reason: 'no matching application',
    };
  }

  const events = readEvents(app);
  if (events.some((e) => e && e.type === type && e.source === 'email' && Math.abs((Number(e.date) || 0) - at) < 3 * DAY)) {
    return { action: 'none', appId: app.id, reason: 'already recorded from email' };
  }
  if (kind === 'application_received' && events.some((e) => e && e.type === 'application_submitted')) {
    return { action: 'none', appId: app.id, reason: 'already tracked' };
  }
  if (app.status === 'hired' || app.status === 'withdrawn') return { action: 'none', appId: app.id, reason: `card is ${app.status}` };

  const patch = { events: [...events, evt].slice(-50) };
  const curIdx = STAGES.indexOf(app.stage);
  const raise = (s) => { if (STAGES.indexOf(s) > curIdx) patch.stage = s; };
  if (kind === 'interview') {
    raise(cls.stage || 'Interview');
    if (app.status === 'ghosted') patch.status = 'active';
  } else if (kind === 'offer') {
    if (app.status === 'active' || app.status === 'ghosted') { raise('Offer'); patch.status = 'active'; }
  } else if (kind === 'rejection') {
    if (app.status === 'active' || app.status === 'ghosted') { patch.status = 'rejected'; patch.stage = 'Rejected'; }
  }
  return { action: 'update', appId: app.id, patch, share: app.status === 'rejected' && kind === 'rejection' ? null : share, reason: 'matched' };
}
