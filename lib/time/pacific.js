// Seen runs on California time (owner decision 2026-10-21: "get rid of UTC anywhere and everywhere — we are
// in California"). Every calendar day, week, month and displayed time is America/Los_Angeles, including
// daylight saving. Servers (Vercel, Postgres) keep UTC clocks, so nothing here may use getUTC*,
// toISOString().slice(0, 10) or new Date(y, m, d) — those are the server's day, not ours.
// Works in Node and in the browser (Intl). Tests: lib/time/pacific.test.mjs.

export const PACIFIC = 'America/Los_Angeles';

const parts = (date, opts) => {
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, hourCycle: 'h23', ...opts }).formatToParts(date)) out[p.type] = p.value;
  return out;
};
const pad = (n) => String(n).padStart(2, '0');

/** { year, month (1–12), day, hour, minute, second, weekday (0 = Sunday) } on the Pacific clock. */
export function pacificParts(date = new Date()) {
  const p = parts(new Date(date), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** 'YYYY-MM-DD' — the Pacific calendar date (the day key for credits, charts, file names). */
export function pacificDate(date = new Date()) {
  const p = pacificParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
/** 'YYYY-MM' — the Pacific month. */
export const pacificMonth = (date = new Date()) => pacificDate(date).slice(0, 7);

// The UTC offset (minutes, negative west) California has at an instant.
function offsetMinutes(at) {
  const p = pacificParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}
/** The instant a Pacific calendar date ('YYYY-MM-DD') starts (midnight PT), correct across DST. */
export function pacificMidnight(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 8)); // 08:00 UTC is midnight PST; correct it for PDT below
  const off = offsetMinutes(guess);
  const t = new Date(Date.UTC(y, m - 1, d) - off * 60000);
  return pacificDate(t) === day ? t : new Date(Date.UTC(y, m - 1, d) - offsetMinutes(t) * 60000);
}
/** Midnight PT of today (or of `date`'s Pacific day), moved by `addDays` calendar days. */
export function pacificDayStart(date = new Date(), addDays = 0) {
  const p = pacificParts(date);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day + addDays));
  return pacificMidnight(`${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`);
}
/**
 * Whole California calendar days from `from` to `to` (negative when `to` is earlier). An application
 * sent at 11 PM PT is "Day 1" the next morning — a 24-hour-period count (floor((to − from) / 86400000))
 * would still say Day 0 until 11 PM, and it would bucket a day differently from the dates shown
 * beside it. Day counts on tracker cards, the dashboard and the day-7/14/30 check-ins all use this.
 */
export function pacificDaysBetween(from, to = new Date()) {
  const a = pacificParts(new Date(from)), b = pacificParts(new Date(to));
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
}
/** Monday 00:00 PT of the week containing `date`. */
export function pacificWeekStart(date = new Date()) {
  const wd = pacificParts(date).weekday; // 0 = Sunday
  return pacificDayStart(date, -((wd + 6) % 7));
}
/**
 * "Oct 21, 2026, 5:42 AM PT" (options override the parts shown).
 * @param {Date|string|number} date
 * @param {Intl.DateTimeFormatOptions} [opts]
 */
export function formatPacific(date, opts = { dateStyle: 'medium', timeStyle: 'short' }) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const s = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, ...opts }).format(d);
  return opts.timeStyle || opts.hour ? `${s} PT` : s;
}
/** The Pacific hour (0–23) — for schedules that rotate through the day. */
export const pacificHour = (date = new Date()) => pacificParts(date).hour;
/** Day of the year (1–366) on the Pacific calendar. */
export function pacificDayOfYear(date = new Date()) {
  const p = pacificParts(date);
  return Math.floor((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 0)) / 86400000);
}
