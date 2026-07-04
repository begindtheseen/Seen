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
