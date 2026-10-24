// Curated list of major staffing/recruiting agencies for the Staffing Agency Ghost Index
// (/agencies). Seeded from lib/server/jobScore.js KNOWN_BAD's true staffing names (staffmark,
// manpower, randstad, robert half, kelly services) plus the other high-volume US agencies.
// Consulting/outsourcing firms on that list (accenture, cognizant, infosys, wipro, tcs, hcl,
// capgemini, tech mahindra) are intentionally EXCLUDED — this index is staffing agencies only.
//
// `name` is the display name. `aliases` are the exact lowercase company_scores.company_name
// spellings we match (company_scores stores names trim().toLowerCase()). Matching is EXACT by
// design — a wildcard match that grabbed the wrong company (e.g. "hays*" catching "haystack")
// would pin someone else's ghost rate on an agency's row. An unmatched spelling variant just
// shows as "no data yet", which is safe; a wrong match would be a fabrication.
export type StaffingAgency = {
  name: string
  aliases: string[]
}

export const STAFFING_AGENCIES: StaffingAgency[] = [
  { name: 'Robert Half', aliases: ['robert half', 'robert half international'] },
  { name: 'Kelly Services', aliases: ['kelly services'] },
  { name: 'Randstad', aliases: ['randstad', 'randstad usa'] },
  { name: 'ManpowerGroup', aliases: ['manpowergroup', 'manpower', 'manpower group'] },
  { name: 'Adecco', aliases: ['adecco', 'adecco staffing', 'adecco usa'] },
  { name: 'Aerotek', aliases: ['aerotek'] },
  { name: 'Insight Global', aliases: ['insight global'] },
  { name: 'TEKsystems', aliases: ['teksystems', 'teksystems c/o allegis group', 'tek systems'] },
  { name: 'Apex Systems', aliases: ['apex systems'] },
  { name: 'Express Employment Professionals', aliases: ['express employment professionals', 'express employment'] },
  { name: 'PeopleReady', aliases: ['peopleready', 'people ready'] },
  { name: 'Staffmark', aliases: ['staffmark'] },
  { name: 'Spherion', aliases: ['spherion', 'spherion staffing'] },
  { name: 'Kforce', aliases: ['kforce'] },
  { name: 'Aston Carter', aliases: ['aston carter'] },
  { name: 'Beacon Hill Staffing', aliases: ['beacon hill staffing', 'beacon hill staffing group'] },
  { name: 'Collabera', aliases: ['collabera'] },
  { name: 'CyberCoders', aliases: ['cybercoders'] },
  { name: 'The Judge Group', aliases: ['the judge group', 'judge group'] },
  { name: 'Motion Recruitment', aliases: ['motion recruitment', 'motion recruitment partners'] },
  { name: 'Hays', aliases: ['hays', 'hays recruitment'] },
  { name: 'Michael Page', aliases: ['michael page', 'pagegroup'] },
  { name: 'Addison Group', aliases: ['addison group'] },
  { name: 'LaSalle Network', aliases: ['lasalle network', 'the lasalle network'] },
  { name: 'Volt Workforce Solutions', aliases: ['volt workforce solutions', 'volt information sciences'] },
  { name: 'Integrity Staffing Solutions', aliases: ['integrity staffing solutions', 'integrity staffing'] },
]

// Exact-alias lookup, same matching rule as the index: is this stored company_scores name (or a display
// name) one of the staffing agencies above? Used by the company page to add the "Is <agency> legit?"
// FAQ. Exact by design, for the reason given at the top of this file.
const AGENCY_ALIASES = new Set(STAFFING_AGENCIES.flatMap(a => [a.name.toLowerCase(), ...a.aliases]))
export function isStaffingAgency(name: string | null | undefined): boolean {
  return AGENCY_ALIASES.has(String(name ?? '').toLowerCase().trim())
}

// Which company page an Index row links to. The matched company_scores row's stored name is used only
// when it actually holds applicant reports (that page has the data) AND it makes a routable slug: a
// stored name with "/" ("teksystems c/o allegis group") encodes to "%2F", which the client router
// reads as a path separator → 404 (conversion audit 2026-10-24). Otherwise the agency's display name.
// Slug scheme = CLAUDE.md: encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-')).
export function agencyPageSlug(agencyName: string, storedName: string | null | undefined, firstPartyReports: number): string {
  const slug = (n: string) => encodeURIComponent(n.toLowerCase().trim().replace(/\s+/g, '-'))
  const stored = String(storedName ?? '').trim()
  if (stored && firstPartyReports > 0 && !stored.includes('/')) return slug(stored)
  return slug(agencyName)
}
