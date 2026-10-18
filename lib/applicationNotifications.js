// Application updates for job seekers — the notifications modal (owner request 2026-10-18).
//
// Nothing new is stored: every update is derived from the tracker data the app already loads
// (api/user-sync load → AppStore). An update is something the EMPLOYER did on Seen:
//   - moved the application (employer-sourced events written by api/employer-listings
//     syncApplicantTracker: viewed / interviewing / not selected / hired)
//   - wrote to the applicant (the application's thread, employer messages only)
//   - edited the listing after the applicant applied (jobs.edited_at)
// A message sent together with a status change (e.g. a decline with a note) is one update, not two.
// "Read" is a single last-opened timestamp per user on the device (lastSeenKey).
//
// Pure — shared by the Nav bell/modal and its test.

const STATUS_TEXT = {
  application_viewed: 'viewed your application',
  interview_received: 'moved you to interviewing',
  rejected: 'isn’t moving forward with your application',
  offer_received: 'marked you as hired 🎉',
};
const TONE = { application_viewed: 'info', interview_received: 'good', rejected: 'bad', offer_received: 'good' };
// A message within this long of a status change is the note that came with it.
const PAIR_MS = 2 * 60 * 1000;

/** localStorage key for the last time this user opened their notifications. */
export function lastSeenKey(uid) { return `seen_notif_seen_${uid || 'anon'}`; }

/**
 * apps (lib/types Application[]) → updates, newest first:
 * [{ id, at (ms), appId, company, role, kind: 'status'|'message'|'edit', tone, text, message? }]
 */
export function applicationNotifications(apps, { limit = 50 } = {}) {
  const out = [];
  for (const app of Array.isArray(apps) ? apps : []) {
    if (!app || !app.id) continue;
    const base = { appId: app.id, company: app.company || 'The employer', role: app.role || '' };
    const statusItems = [];
    for (const e of Array.isArray(app.events) ? app.events : []) {
      if (!e || e.source !== 'employer' || !STATUS_TEXT[e.type]) continue;
      const at = Number(e.date);
      if (!Number.isFinite(at)) continue;
      const item = { ...base, id: `${app.id}:s:${e.type}:${at}`, at, kind: 'status', tone: TONE[e.type], text: `${base.company} ${STATUS_TEXT[e.type]}` };
      statusItems.push(item);
      out.push(item);
    }
    for (const m of Array.isArray(app.messages) ? app.messages : []) {
      if (!m || m.from !== 'employer' || !m.text) continue;
      const at = Date.parse(m.at);
      if (!Number.isFinite(at)) continue;
      const pair = statusItems.find((s) => !s.message && Math.abs(s.at - at) <= PAIR_MS);
      if (pair) { pair.message = m.text; continue; }
      out.push({ ...base, id: `${app.id}:m:${at}`, at, kind: 'message', tone: 'info', text: `${base.company} sent you a message`, message: m.text });
    }
    const edited = app.listingEditedAt ? Date.parse(app.listingEditedAt) : NaN;
    if (Number.isFinite(edited) && edited > Number(app.appliedAt)) {
      out.push({ ...base, id: `${app.id}:e:${edited}`, at: edited, kind: 'edit', tone: 'info', text: `${base.company} edited the listing after you applied` });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** How many updates arrived after the user last opened the modal. */
export function unreadCount(items, lastSeenMs) {
  const seen = Number(lastSeenMs) || 0;
  return (Array.isArray(items) ? items : []).filter((i) => i.at > seen).length;
}
