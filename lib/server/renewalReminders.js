// Pure selector for which employer perks need a renewal-reminder email (Wave 3 — completes the
// renewal loop). Given the active perks, returns the ones lapsing within `windowDays` that we have
// NOT already reminded about this period. Idempotency key = the soonest-expiring `until` value: once
// we email, we store that ISO on the row (renewal_reminded_until); a renewal (a new, later `until`)
// changes the key, so the next approaching expiry is eligible again. No I/O — the cron fetches,
// this decides, the cron sends + marks.

const DAY = 86400000;

const PERKS = [
  ['Featured placement', 'featured', 'featured_until'],
  ['Transparency Verified badge', 'verified', 'verified_until'],
  ['Sponsor slot', 'sponsor', 'sponsor_until'],
];

/**
 * @param {Array<object>} perks  employer_perks rows (company, *_until, renewal_reminded_until)
 * @param {number} nowMs
 * @param {number} windowDays  remind when a perk expires within this many days (default 7)
 * @returns {Array<{company:string, reminderKey:string, daysLeft:number, items:Array<{label:string,kind:string,until:string,daysLeft:number}>}>}
 */
export function pickRenewalReminders(perks, nowMs, windowDays = 7) {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  const win = Number.isFinite(windowDays) ? windowDays : 7;
  const out = [];
  for (const p of Array.isArray(perks) ? perks : []) {
    if (!p || !p.company) continue;
    const items = [];
    for (const [label, kind, col] of PERKS) {
      const t = Date.parse(p[col]);
      if (!Number.isFinite(t) || t <= now) continue; // skip lapsed/absent — reminder is pre-expiry
      const daysLeft = Math.ceil((t - now) / DAY);
      if (daysLeft <= win) items.push({ label, kind, until: p[col], daysLeft });
    }
    if (!items.length) continue;
    // Soonest-expiring perk drives the reminder key + headline urgency.
    items.sort((a, b) => Date.parse(a.until) - Date.parse(b.until));
    const reminderKey = items[0].until;
    if (p.renewal_reminded_until && p.renewal_reminded_until === reminderKey) continue; // already reminded this period
    out.push({ company: p.company, reminderKey, daysLeft: items[0].daysLeft, items });
  }
  return out;
}
