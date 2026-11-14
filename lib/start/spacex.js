// /start/spacex — "Getting hired at SpaceX". A COMPANY guide: the page renders from this module only, so every figure
// on it carries a source and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-14 (session scratchpad research/spacex.md) and its
// pull of SpaceX's own job board (research/data/spacex.json, 2,758 U.S. postings read 2026-11-14 14:31 UTC); every
// posting quoted below was re-read in that pull, word for word.
// FACT-CHECKED 2026-11-14 15:31 UTC against a fresh pull of boards-api.greenhouse.io/v1/boards/spacex/jobs?content=true
// (byte-identical to the research pull) and /spacexglobal. Every count on the page was recomputed from that pull:
//   • "hands-on postings" = titles matching technician|welder|machinist|inspector|associate|operator|electrician|rigger|
//     inventory|material handler|material transfer|warehouse|food service|security officer|hvac|plumber|paint|cook|
//     barista|porter|chef|attendant|driver|crane|ironworker|boilermaker|millwright|fitter|lineman|mechanic|clerk|
//     carpenter|custodian|dishwasher, minus engineer|manager|director|supervisor|superintendent|policy|analyst|designer|
//     sourcing|programmer|planner|R&D|counsel|recruit|scientist|buyer|accountant|coordinator → 435 postings. (The
//     research's 441 mixed in directors, managers and a policy associate and left out cooks and drivers; its "about 25
//     diploma-only" counted postings that also ask a certification, 6 months' experience or "experience with hand tools".
//     Only 6 ask for the diploma alone.)
//   • the export rule is on all 2,758 postings of the main board, but NOT on the 60 U.S. Starlink door-to-door sales
//     postings on the second board (spacexglobal), which ask only for authorization to work in the U.S.;
//   • the 2023 Justice Department case is sourced to the OCAHO dismissal order (justice.gov) and the federal court filing,
//     the Akoustis purchase to the SEC exhibit of Akoustis's own press release (May 15, 2025).
// Rules this module keeps:
//   • only items the research marked VERIFIED (SpaceX's own postings, its SEC prospectus, OSHA's injury data, the
//     FTC, two news reports on the 2023 Justice Department case);
//   • FIRST-HAND items only as `firstHand: true`, where two or more accounts agree; a single account is never used
//     (the one technician-interview account and the "hands-on assessment" question are left out);
//   • nothing UNVERIFIED or CONFLICTING: no pay for Starbase, Bastrop, McGregor or Cape Canaveral (none is posted),
//     no universal drug-test policy, no time-to-offer, no round count for technicians, no "60-hour weeks", no
//     "5 × 12" or "4x10" schedules, no tuition aid (none is stated), no SpaceX-specific recruiting scam;
//   • no IPO, share price, valuation or merger talk: none of it helps anyone get hired. The prospectus is used only
//     for what it says about hiring (headcount, the engineering acceptance rate, export authorizations);
//   • the export ("U.S. person") rule is quoted exactly as the postings word it;
//   • no hype about the mission, no guarantees, no exclamation marks; experience asks, long shifts and injury rates
//     are said plainly.
//
// Shape: `sources` (every reference behind the page, kept here and NEVER printed as citations — the links reach
// readers only through the grouped "Additional resources" menu, `resources` below), entries
// `{ text, src: [sourceKey…], firstHand? }`, the listings filter config (`listings`, lib/start/listingFilters.js; a
// company guide sets `employer`) and the page's openable menu rows (`menu`, rendered by components/start/Guide.tsx).
// Pure data; relative imports only so `node --test` runs it as is.

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

const posting = (id) => `https://boards.greenhouse.io/spacex/jobs/${id}`

/** @type {Record<string, Source>} */
export const sources = {
  'sx-board': {
    label: 'SpaceX job board (Greenhouse), all U.S. postings (the address forwards to spacex.com/careers)',
    url: 'https://boards.greenhouse.io/spacex',
    date: '2026-11-14', note: 'read',
  },
  'sx-global': {
    label: 'SpaceX second job board (Greenhouse, spacexglobal): jobs abroad and U.S. Starlink field sales',
    url: 'https://boards.greenhouse.io/spacexglobal',
    date: '2026-11-14', note: 'read',
  },
  'sx-fieldsales': { label: 'SpaceX posting 8934176002, Field Sales Representative (Starlink), Denver, CO', url: 'https://job-boards.greenhouse.io/spacexglobal/jobs/8934176002', date: '2026-11-09', note: 'posted' },
  'sx-assembly': { label: 'SpaceX posting 8927729002, Assembly Technician (Starship), Hawthorne, CA', url: posting('8927729002'), date: '2026-11-02', note: 'posted' },
  'sx-starlink-entry': { label: 'SpaceX posting 8647897002, Starlink Production Technician – Entry Level, Redmond, WA', url: posting('8647897002'), date: '2026-07-23', note: 'posted' },
  'sx-pcba': { label: 'SpaceX posting 8657538002, Entry-Level Production Technician, PCBA, Redmond, WA', url: posting('8657538002'), date: '2026-07-30', note: 'posted' },
  'sx-aviation': { label: 'SpaceX posting 8928271002, Starlink Aviation Production Technician (Entry Level, Temporary), Woodinville, WA', url: posting('8928271002'), date: '2026-11-04', note: 'posted' },
  'sx-machining': { label: 'SpaceX posting 8700616002, Machining Technician (Starlink) – Entry Level, Woodinville, WA', url: posting('8700616002'), date: '2026-08-12', note: 'posted' },
  'sx-bastrop-assoc': { label: 'SpaceX posting 8697970002, Starlink Production Associate, Bastrop, TX', url: posting('8697970002'), date: '2026-08-11', note: 'posted' },
  'sx-warehouse': { label: 'SpaceX posting 8697995002, Warehouse Associate (Starlink), Bastrop, TX', url: posting('8697995002'), date: '2026-08-11', note: 'posted' },
  'sx-akoustis': { label: 'SpaceX posting 8626973002, Production Associate (Starlink/Akoustis), Canandaigua, NY', url: posting('8626973002'), date: '2026-07-09', note: 'posted' },
  'sx-composites': { label: 'SpaceX posting 8815859002, Composites Lamination Technician, Hawthorne, CA', url: posting('8815859002'), date: '2026-09-16', note: 'posted' },
  'sx-tig-hawthorne': { label: 'SpaceX posting 8565833002, TIG Welder (Starship), Hawthorne, CA', url: posting('8565833002'), date: '2026-05-27', note: 'posted' },
  'sx-tig-starbase': { label: 'SpaceX posting 8718807002, TIG Welder (Starship), Starbase, TX', url: posting('8718807002'), date: '2026-08-17', note: 'posted' },
  'sx-apprentice-welder': { label: 'SpaceX posting 8880245002, Apprentice Welder, McGregor, TX', url: posting('8880245002'), date: '2026-10-13', note: 'posted' },
  'sx-qi': { label: 'SpaceX posting 8613004002, Quality Inspector (Falcon & Dragon), Hawthorne, CA', url: posting('8613004002'), date: '2026-06-30', note: 'posted' },
  'sx-nde-trainee': { label: 'SpaceX posting 8731136002, NDE Inspector Trainee (Starship) – Temporary, Starbase, TX', url: posting('8731136002'), date: '2026-08-19', note: 'posted' },
  'sx-pad': { label: 'SpaceX posting 8761378002, Launch Pad Technician – Multiple Shifts, Vandenberg, CA', url: posting('8761378002'), date: '2026-09-02', note: 'posted' },
  'sx-gse': { label: 'SpaceX posting 8924830002, Fabrication Technician (ground support equipment), Starbase, TX', url: posting('8924830002'), date: '2026-10-30', note: 'posted' },
  'sx-electrician': { label: 'SpaceX posting 8817884002, Electrician (Starship) – Temporary, Starbase, TX', url: posting('8817884002'), date: '2026-09-17', note: 'posted' },
  'sx-hvac': { label: 'SpaceX posting 8765632002, HVAC Technician (Facilities) – 1st Shift, Hawthorne, CA', url: posting('8765632002'), date: '2026-08-31', note: 'posted' },
  'sx-food': { label: 'SpaceX posting 8825676002, Food Service Attendant, Hawthorne, CA', url: posting('8825676002'), date: '2026-09-19', note: 'posted' },
  'sx-security': { label: 'SpaceX posting 8910176002, Security Officer 3, Hawthorne, CA', url: posting('8910176002'), date: '2026-10-22', note: 'posted' },
  'sec-424b4': {
    label: 'SpaceX final prospectus filed with the SEC (Form 424B4)',
    url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/spaceexplorationtechnologi.htm',
    date: '2026-06-12', note: 'filed',
  },
  'osha-ita': {
    label: 'OSHA, establishment-specific injury and illness data (Form 300A summaries, calendar years 2024 and 2025)',
    url: 'https://www.osha.gov/Establishment-Specific-Injury-and-Illness-Data',
    date: '2026-08-31', note: 'data through',
  },
  'ftc-text': {
    label: 'Federal Trade Commission consumer alert, That job offer text is probably a scam',
    url: 'https://www.consumer.ftc.gov/consumer-alerts/2026/04/job-offer-text-probably-scam',
    date: '2026-04-30', note: 'published',
  },
  'opb-doj': {
    label: 'OPB (NPR), The Justice Department is suing SpaceX for allegedly not hiring refugees and asylees',
    url: 'https://www.opb.org/article/2023/08/25/the-justice-department-is-suing-spacex-for-allegedly-not-hiring-refugees-and-asylees/',
    date: '2023-08-25', note: 'published',
  },
  'ocaho-dismissal': {
    label: 'Justice Department, Office of the Chief Administrative Hearing Officer, United States v. SpaceX, Order Confirming Dismissal (18 OCAHO no. 1499b)',
    url: 'https://www.justice.gov/d9/2025-02/1499b.pdf',
    date: '2025-02-24', note: 'entered',
  },
  'txsd-moot': {
    label: 'U.S. District Court, S.D. Texas, SpaceX v. Bell, No. 1:23-cv-00137, unopposed motion to dismiss as moot (court filing)',
    url: 'https://storage.courtlistener.com/recap/gov.uscourts.txsd.1934705/gov.uscourts.txsd.1934705.51.0.pdf',
    date: '2025-02-28', note: 'filed',
  },
  'sec-akoustis': {
    label: 'Akoustis Technologies press release filed with the SEC (Form 8-K, Exhibit 99.1), sale of assets to SpaceX subsidiary Tune Holdings',
    url: 'https://www.sec.gov/Archives/edgar/data/1584754/000121390025044032/ea024225601ex99-1_atech.htm',
    date: '2025-05-15', note: 'filed',
  },
  // First-hand accounts (r/recruitinghell, r/SpaceXLounge, read through the Arctic Shift archive). Used only where two
  // or more accounts agree, and rendered as what people say, never as fact.
  'r-1ki3f94': { label: 'r/recruitinghell, "SpaceX flew me out to Florida then cancelled the 3 positions I interviewed for"', url: 'https://www.reddit.com/r/recruitinghell/comments/1ki3f94/', date: '2025-05-08', note: 'thread' },
  'r-1re0qph': { label: 'r/recruitinghell, "My SpaceX Interview Experience"', url: 'https://www.reddit.com/r/recruitinghell/comments/1re0qph/', date: '2026-02-25', note: 'thread' },
  'r-1vezudj': { label: 'r/SpaceXLounge, "Technician to Engineer possibility?"', url: 'https://www.reddit.com/r/SpaceXLounge/comments/1vezudj/', date: '2026-08-04', note: 'thread' },
}

export const guide = {
  path: '/start/spacex',
  title: 'Getting hired at SpaceX',
  crumbLabel: 'SpaceX',
  eyebrow: 'Company guide',
  // The one-sentence answer under the h1 (the page's first screen). No figure here: figures live in the tiles.
  answer: { text: 'Most of SpaceX’s hands-on jobs ask for a high-school diploma, not a degree, but nearly all of them also want hands-on experience, U.S.-person status and long shifts. Here is what each role asks for, what it pays where pay is posted, and what is open now.', src: ['sx-board'] },
  metaDescription: 'How people get hired at SpaceX: technician, welding, inspection, launch-pad and facilities jobs that ask for a diploma, the experience they want, the U.S.-person rule, posted pay by level, shifts by site, and open SpaceX roles now.',
  asOf: '2026-11-14',
}

// The three readings in the hero: each restates a sourced fact below, with the same sources.
export const tiles = [
  { label: 'Starting pay, where posted', value: '$23–$27', text: 'an hour: the most common Level 1 range on SpaceX’s hourly factory postings', src: ['sx-board', 'sx-assembly'] },
  { label: 'Diploma, not degree', value: '419 of 435', text: 'hands-on postings on November 14, 2026 asked for a high-school diploma; most also asked for a year or more of experience', src: ['sx-board'] },
  { label: 'U.S. person required', value: '2,758 of 2,758', text: 'postings on its main job board: citizen, national, green card holder, refugee or asylee', src: ['sx-board'] },
]

// 1. The jobs that do not ask for a degree: a name, one line, and the posted figures as chips.
export const noDegree = {
  intro: { text: 'Of the 435 production, welding, machining, inspection, facilities, warehouse, food-service, security and similar hands-on postings on SpaceX’s main board on November 14, 2026, 419 asked for a high-school diploma or equivalency certificate, not a degree.', src: ['sx-board'] },
  catch: { text: 'The catch: 407 of those 419 also ask for experience, most often 1 year or more; on some, a trade certificate or a finished training program can stand in. Only 6 ask for the diploma alone.', src: ['sx-board'] },
  catchDetail: { text: 'Among the 419, the least experience asked is under a year on 6 postings, 1 year on 179, 2 years on 108, 3 years on 65 and 4 years or more on 40; 6 more ask for an inspection certification instead. The diploma-alone postings include the Starlink Production Associate in Bastrop, TX, the Production Associate in Canandaigua, NY and the NDE Inspector Trainee at Starbase, TX.', src: ['sx-board', 'sx-bastrop-assoc', 'sx-akoustis', 'sx-nde-trainee'] },
}

export const roleCards = [
  {
    name: 'Production associate', aka: 'Starlink lines in Bastrop, TX and Canandaigua, NY',
    body: { text: 'One of the lightest asks on the board: a high-school diploma or equivalency certificate and nothing else. Bastrop runs 12½-hour day or night shifts; Canandaigua starts on weekday hours, with 12-hour shifts planned for 2027.', src: ['sx-bastrop-assoc', 'sx-akoustis'] },
    chips: [{ text: '$20.00/hr Level I, Canandaigua', src: ['sx-akoustis'] }],
  },
  {
    name: 'Production technician', aka: 'Also assembly, integration, electronics',
    body: { text: 'Builds and tests hardware. Hawthorne’s Assembly Technician (Starship) asks for 1 year in fabrication, assembly or testing; Redmond’s entry-level PCBA job takes 1 year of hands-on work or a finished vocational or technical program.', src: ['sx-assembly', 'sx-pcba'] },
    chips: [{ text: '$23.00–$27.00/hr Level 1, Hawthorne', src: ['sx-assembly'] }, { text: '$22.00–$26.50/hr Level 1, Redmond', src: ['sx-pcba'] }],
  },
  {
    name: 'Welder', aka: 'TIG, orbital, structural, pipe',
    body: { text: 'TIG welders need 1 year of TIG welding or a welding certificate from an accredited program, and some roles require passing a weld test per AWS D17.1 (a welding standard). The Apprentice Welder posting at McGregor, TX asks for a 2-year technical school certification or an associate’s degree, plus 2 years of welding experience, which a college welding program can count toward.', src: ['sx-tig-hawthorne', 'sx-tig-starbase', 'sx-apprentice-welder'] },
    chips: [{ text: '$23.00–$27.00/hr Level 1, Hawthorne', src: ['sx-tig-hawthorne'] }],
  },
  {
    name: 'Machining technician', aka: 'Also CNC machinist, deburr',
    body: { text: 'The entry-level Starlink machining job in Woodinville, WA asks for 1 year with precision tools and 10-hour shifts.', src: ['sx-machining'] },
    chips: [{ text: '$22.00–$26.50/hr Level 1, Woodinville', src: ['sx-machining'] }],
  },
  {
    name: 'Quality inspector', aka: 'Also NDE inspector',
    body: { text: 'Hawthorne’s Quality Inspector (Falcon & Dragon) asks for 2 years of inspection work. The NDE Inspector Trainee at Starbase is temporary and asks only for a diploma.', src: ['sx-qi', 'sx-nde-trainee'] },
    chips: [{ text: '$26.00–$32.00/hr Level 1, Hawthorne', src: ['sx-qi'] }],
  },
  {
    name: 'Launch pad technician', aka: 'Starbase, Cape Canaveral, Vandenberg',
    body: { text: 'Works the launch and test sites. Vandenberg’s posting asks for 2 years with power tools and a Space Force background check for base access.', src: ['sx-pad'] },
    chips: [{ text: '$23.00–$29.75/hr Level 1, Vandenberg', src: ['sx-pad'] }],
  },
  {
    name: 'Facilities and construction', aka: 'HVAC, electrician, plumbing, crane',
    body: { text: 'Keeps the sites running. Hawthorne’s HVAC Technician asks for 3 years with HVAC, plumbing, mechanical or electrical systems; Starbase also posts temporary electrician jobs with no experience asked.', src: ['sx-hvac', 'sx-electrician'] },
    chips: [{ text: '$23.00–$32.50/hr Level 1, HVAC, Hawthorne', src: ['sx-hvac'] }],
  },
  {
    name: 'Warehouse, food service, security', aka: null,
    body: { text: 'Bastrop’s Warehouse Associate asks for 1 year of inventory control; Hawthorne’s Food Service Attendant asks for 2 years in food prep, customer service or food-service support; Security Officer 3 asks for 5 years of military, police or security work plus 1 year of protection or emergency-response work.', src: ['sx-warehouse', 'sx-food', 'sx-security'] },
    chips: [{ text: '$22.00/hr Level 1, food service, Hawthorne', src: ['sx-food'] }, { text: '$28.00/hr Level 1, security, Hawthorne', src: ['sx-security'] }],
  },
]

export const engineering = { text: 'Engineering is far more selective: SpaceX’s prospectus says it accepted under 2% of its engineering applicants in 2025. That figure covers engineers only; SpaceX gives no figure for technicians.', src: ['sec-424b4'] }

// 2. What every posting asks for, as a checklist.
export const asks = {
  intro: { text: 'What SpaceX’s own postings asked for on November 14, 2026.', src: ['sx-board'] },
  items: [
    { name: 'U.S.-person status', text: 'Every posting on its main board: a U.S. citizen or national, a green card holder, a refugee or an asylee, or someone eligible for authorization from the U.S. Department of State. The Starlink door-to-door sales jobs on its second board ask only for authorization to work in the U.S.', src: ['sx-board', 'sx-global', 'sx-fieldsales'] },
    { name: 'A high-school diploma', text: 'Or an equivalency certificate: the basic education line on most hands-on postings.', src: ['sx-board'] },
    { name: 'Hands-on experience, usually', text: 'Most often 1 year or more in the same kind of work. A finished vocational program counts on some postings.', src: ['sx-board', 'sx-pcba'] },
    { name: 'Long shifts, overtime and weekends', text: 'Hawthorne: 5:00 AM to 3:30 PM. Starbase: 6 AM to 6 PM or 6 PM to 6 AM. Most hands-on postings add overtime and weekends as needed.', src: ['sx-assembly', 'sx-electrician', 'sx-board'] },
    { name: 'Lifting and heights', text: 'Lifting 25 lbs is the most common line. About half of Starbase’s hands-on postings add pushing up to 75 lbs and working at heights up to 500 ft.', src: ['sx-board', 'sx-gse'] },
    { name: 'Base access checks at launch sites', text: 'Most Cape Canaveral and Vandenberg postings ask you to pass an Air Force or Space Force background check.', src: ['sx-board', 'sx-pad'] },
    { name: 'Drug tests on some roles', text: 'Some postings state pre-employment and random drug and alcohol testing; security jobs add a psychological test and a fitness test. The postings do not say every role is tested.', src: ['sx-board', 'sx-security'] },
  ],
  itarQuote: { text: '"To conform to U.S. Government export regulations, applicant must be a (i) U.S. citizen or national, (ii) U.S. lawful, permanent resident (aka green card holder), (iii) Refugee under 8 U.S.C. § 1157, or (iv) Asylee under 8 U.S.C. § 1158, or be eligible to obtain the required authorizations from the U.S. Department of State."', src: ['sx-board'] },
  itarWhy: { text: 'SpaceX’s prospectus says it must get export authorizations to export or share controlled goods, technology or software with foreign persons, "including foreign person employees."', src: ['sec-424b4'] },
  itarHistory: { text: 'In 2023 the Justice Department alleged SpaceX had discouraged and refused to hire asylees and refugees. SpaceX challenged the case in federal court, and the department dismissed it in February 2025 without any ruling on the claims. Today’s postings name refugees and asylees as eligible.', src: ['opb-doj', 'txsd-moot', 'ocaho-dismissal', 'sx-board'] },
}

// 3. Posted pay, by level (California, Washington, New York, Maryland and D.C. postings; Texas and Florida hands-on post none).
export const payIntro = { text: 'SpaceX shows pay by level on nearly all of its California, Washington state, New York, Maryland and Washington, D.C. postings; Level 1 is the entry level, and a new hire’s level is set "on a case-by-case basis." Its Texas and Florida hands-on postings show no pay, so there is none posted for those jobs at Starbase, Bastrop, McGregor or Cape Canaveral.', src: ['sx-board', 'sx-assembly'] }
export const payRows = [
  { role: 'Assembly Technician (Starship)', site: 'Hawthorne, CA', first: '$23.00–$27.00', third: '$31.00–$38.00', src: ['sx-assembly'] },
  { role: 'TIG Welder (Starship)', site: 'Hawthorne, CA', first: '$23.00–$27.00', third: '$31.00–$38.00', src: ['sx-tig-hawthorne'] },
  { role: 'Composites Lamination Technician', site: 'Hawthorne, CA', first: '$22.00–$24.50', third: '$28.50–$35.00', src: ['sx-composites'] },
  { role: 'Quality Inspector (Falcon & Dragon)', site: 'Hawthorne, CA', first: '$26.00–$32.00', third: '$35.00–$44.00', src: ['sx-qi'] },
  { role: 'HVAC Technician (Facilities)', site: 'Hawthorne, CA', first: '$23.00–$32.50', third: '$41.00–$51.00', src: ['sx-hvac'] },
  { role: 'Launch Pad Technician', site: 'Vandenberg, CA', first: '$23.00–$29.75', third: '$34.00–$41.75', src: ['sx-pad'] },
  { role: 'Starlink Production Technician, Entry Level', site: 'Redmond, WA', first: '$22.00–$26.50', third: '$29.50–$37.00', src: ['sx-starlink-entry'] },
  { role: 'Machining Technician (Starlink), Entry Level', site: 'Woodinville, WA', first: '$22.00–$26.50', third: '$29.50–$37.00', src: ['sx-machining'] },
  { role: 'Starlink Aviation Production Technician (temporary)', site: 'Woodinville, WA', first: '$23.00–$29.00', third: null, src: ['sx-aviation'] },
  { role: 'Production Associate (Akoustis)', site: 'Canandaigua, NY', first: '$20.00', third: null, src: ['sx-akoustis'] },
  { role: 'Food Service Attendant', site: 'Hawthorne, CA', first: '$22.00', third: '$24.00', src: ['sx-food'] },
]
export const payNote = { text: 'Hourly pay as posted on November 14, 2026. Only the Canandaigua postings state a shift differential: 15% on night shifts.', src: ['sx-board', 'sx-akoustis'] }
export const benefits = [
  { text: 'Postings that show pay also list medical, vision and dental coverage, a 401(k), paid parental leave, "3 weeks of paid vacation" (accrued) and "10 or more paid holidays per year."', src: ['sx-board'] },
  { text: 'Stock is a maybe, not a promise: postings say you "may also be eligible for long-term incentives, in the form of company stock or long-term cash awards," and the same sentence offers, again as a maybe, buying stock at a discount through an Employee Stock Purchase Plan.', src: ['sx-board', 'sx-starlink-entry'] },
  { text: 'None of its postings mentions tuition help.', src: ['sx-board'] },
]

// 4. Where the hands-on jobs are, with each site's shift pattern as its postings state it.
export const siteIntro = { text: 'SpaceX says it had over 22,000 full-time employees worldwide as of March 31, 2026. Most hands-on openings sit at a few sites.', src: ['sec-424b4', 'sx-board'] }
export const siteRows = [
  { site: 'Starbase, TX', open: '118', staff: '3,528', shifts: '6 AM–6 PM or 6 PM–6 AM; all shifts, overtime and weekends', src: ['sx-board', 'osha-ita', 'sx-electrician'] },
  { site: 'Hawthorne, CA', open: '111', staff: '7,577', shifts: 'Most often 5:00 AM–3:30 PM or 3:30 PM–2:00 AM', src: ['sx-board', 'osha-ita', 'sx-assembly'] },
  { site: 'Bastrop, TX (Starlink)', open: '57', staff: '1,486', shifts: '5 AM–5:30 PM or 5 PM–5:30 AM, three or four days a week', src: ['sx-board', 'osha-ita', 'sx-bastrop-assoc'] },
  { site: 'McGregor, TX (test site)', open: '28', staff: '638', shifts: 'Most often 1:30 PM–12:30 AM', src: ['sx-board', 'osha-ita'] },
  { site: 'Cape Canaveral, FL', open: '28', staff: '1,984', shifts: 'Most often 6:00 PM–6:30 AM or 6:00 AM–6:30 PM; some 6:00 AM–4:30 PM', src: ['sx-board', 'osha-ita'] },
  { site: 'Redmond, WA (Starlink)', open: '26', staff: '1,980', shifts: 'Often 5:00 AM–3:30 PM or 3:30 PM–2:00 AM', src: ['sx-board', 'osha-ita', 'sx-starlink-entry'] },
  { site: 'Woodinville, WA (Starlink)', open: '22', staff: null, shifts: '6:00 AM–4:30 PM or 4:00 PM–2:30 AM, 10-hour shifts', src: ['sx-board', 'sx-machining'] },
  { site: 'Vandenberg, CA', open: '14', staff: '484', shifts: 'Among others, 5 AM–5 PM or 5 PM–5 AM, Sun–Wed or Wed–Sat', src: ['sx-board', 'osha-ita', 'sx-pad'] },
  { site: 'Canandaigua, NY (Akoustis)', open: '8', staff: null, shifts: '12-hour shifts, or weekdays 8 AM–5 PM', src: ['sx-board', 'sx-akoustis'] },
]
export const siteNote = { text: 'Openings are hands-on postings on SpaceX’s board on November 14, 2026, and change daily. Staff is each site’s average number of employees in 2025, from SpaceX’s own OSHA filings. Canandaigua is Akoustis, an RF-filter maker whose assets a SpaceX subsidiary bought in a court-approved sale in May 2025; its postings say Akoustis "is now operating as a wholly owned subsidiary of SpaceX."', src: ['sx-board', 'osha-ita', 'sx-akoustis', 'sec-akoustis'] }

// 5. How hiring works: the company's own words, then what applicants say (two or more accounts agreeing).
export const process = { text: 'SpaceX’s own recruiting postings describe phone screens, then onsite interviews; once a candidate is approved for hire, background checks start along with the offer.', src: ['sx-board'] }
export const peopleSay = [
  { step: 'Phone screens first', text: 'Both describe about three phone calls before an onsite.', src: ['r-1ki3f94', 'r-1re0qph'], firstHand: true },
  { step: 'Then an onsite day', text: 'A technical presentation, then several one-on-one interviews; both also mention a written test.', src: ['r-1ki3f94', 'r-1re0qph'], firstHand: true },
  { step: 'An opening can close mid-process', text: 'Both describe a position closing after a good onsite, for lack of approval or headcount.', src: ['r-1ki3f94', 'r-1re0qph'], firstHand: true },
]
export const movingUp = { text: 'Commenters say a technician can move into engineering, but over years, not months.', src: ['r-1vezudj'], firstHand: true }

// 6. Watch out.
export const beforeYouApply = [
  { text: 'Injury rates are highest at Starbase and Bastrop. SpaceX’s own OSHA filings work out to 3.01 recordable injuries or illnesses per 100 full-time workers at Starbase and 2.67 at Bastrop in 2025, against about 0.7 for all filers in each site’s industry.', src: ['osha-ita'] },
  { text: 'Most hands-on postings ask for overtime and weekends as needed, on top of shifts of 10 to 12½ hours.', src: ['sx-board', 'sx-assembly', 'sx-electrician'] },
  { text: 'No pay is posted for hands-on jobs at Starbase, Bastrop, McGregor or Cape Canaveral; California and Washington ranges are not a promise for Texas or Florida.', src: ['sx-board'] },
]
export const scams = [
  { text: 'Real SpaceX postings sit on its Greenhouse boards, boards.greenhouse.io/spacex (which forwards to spacex.com/careers) and boards.greenhouse.io/spacexglobal. Apply there.', src: ['sx-board', 'sx-global'] },
  { text: 'Never pay for a job. The FTC: "Never pay to get paid or get a job."', src: ['ftc-text'] },
  { text: 'The FTC warns that a job offer by text is probably a scam. A real offer follows real interviews.', src: ['ftc-text', 'sx-board'] },
]
export const injuryRows = [
  { site: 'Starbase, TX', rate: '3.01 in 2025, 4.27 in 2024', src: ['osha-ita'] },
  { site: 'Bastrop, TX', rate: '2.67 in 2025, 3.49 in 2024', src: ['osha-ita'] },
  { site: 'McGregor, TX', rate: '2.17 in 2025, 2.48 in 2024', src: ['osha-ita'] },
  { site: 'Cape Canaveral, FL', rate: '2.19 in 2025, 1.58 in 2024', src: ['osha-ita'] },
  { site: 'Vandenberg, CA', rate: '2.05 in 2025, 2.99 in 2024', src: ['osha-ita'] },
  { site: 'Hawthorne, CA', rate: '1.47 in 2025, 1.43 in 2024', src: ['osha-ita'] },
  { site: 'Redmond, WA', rate: '1.38 in 2025, 1.11 in 2024', src: ['osha-ita'] },
]
export const injuryNote = { text: 'Recordable injuries or illnesses per 100 full-time workers a year, worked out from each site’s OSHA Form 300A summary. For comparison, all filers in 2025: 0.70 in guided missile and space vehicle manufacturing (Starbase, Hawthorne; 0.61 in 2024), 0.69 in wireless equipment manufacturing (Bastrop, Redmond) and 2.04 in charter air freight (Cape Canaveral, Vandenberg), SpaceX’s own sites included.', src: ['osha-ita'] }

// FAQ — visible on the page and mirrored in FAQPage JSON-LD (only Q&As shown on the page).
export const faq = [
  {
    q: 'Can I get hired at SpaceX without a degree?',
    a: { text: 'Yes, for most hands-on jobs: 419 of 435 production, welding, machining, inspection, facilities and similar postings on November 14, 2026 asked for a high-school diploma or equivalency certificate. Most of them also asked for 1 year or more of experience.', src: ['sx-board'] },
  },
  {
    q: 'Do I have to be a U.S. citizen?',
    a: { text: 'No. To meet export rules, every posting on SpaceX’s main board also accepts a national, a green card holder, a refugee or an asylee, or someone eligible for authorization from the Department of State. Its Starlink door-to-door sales jobs ask only for legal authorization to work in the country.', src: ['sx-board', 'sx-global', 'sx-fieldsales'] },
  },
  {
    q: 'How much do SpaceX technicians make to start?',
    a: { text: 'Where pay is posted, Level 1 on hourly factory jobs is most often $23.00–$27.00 an hour in Hawthorne and starts from $22.00 in Redmond and Woodinville. Texas and Florida hands-on postings show no pay.', src: ['sx-board', 'sx-assembly', 'sx-starlink-entry'] },
  },
  {
    q: 'What are the hours like?',
    a: { text: 'Long. Hawthorne shifts run 10½ hours, Starbase shifts 12 and Bastrop shifts 12½, by day or night. Most hands-on postings add overtime and weekends as needed.', src: ['sx-assembly', 'sx-electrician', 'sx-bastrop-assoc', 'sx-board'] },
  },
  {
    q: 'Does SpaceX drug test?',
    a: { text: 'Some postings state pre-employment and random drug and alcohol testing, and security jobs add a psychological test. The postings do not say every role is tested.', src: ['sx-board', 'sx-security'] },
  },
]


// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// A company guide: every position runs role searches and `employer` keeps only SpaceX's rows (its Greenhouse boards
// `spacex` / `spacexglobal` are stored as company "SpaceX"; xAI rows arrive as "SpaceXSI" and are left out, as is
// "Space Kinetic"). Searches were checked on seenjobs.io 2026-11-14: a company word inside a role query
// ("spacex technician") finds nothing, so positions search role words and the employer gate does the rest. Generic
// titles nationwide ("warehouse associate") are drowned by other employers, so each position leads with titles
// SpaceX itself uses (tig welder, launch pad technician, material flow technician). A plain SpaceX title usually asks
// for a year or more of experience, so entry needs a marker (Entry Level, Apprentice, Trainee). "All hands-on roles" deals
// the rows out position by position (one employer, so the two-per-employer cap cannot spread them) and leaves new-grad
// engineering to its own chip.
export const listings = {
  defaultRadius: '100',
  radii: ['25', '50', '100', '250'],
  levelMode: 'entryNeedsMarker',
  levelLabels: { any: 'Any level', entry: 'Entry level / trainee', experienced: 'Experienced' },
  levelWords: { entry: 'entry-level', experienced: 'experienced' },
  employer: '^\\s*(space\\s?-?x|space exploration technologies(?: corp\\.?| corporation)?|akoustis(?: technologies)?(?:,? inc\\.?)?)\\s*$',
  exclude: '\\b(recruiter|sourcer|recruiting)\\b',
  positions: [
    { id: 'all', label: 'All hands-on roles', noun: 'SpaceX hands-on', mix: 'positions', queries: ['production technician', 'tig welder', 'quality inspector', 'launch pad technician', 'facilities technician', 'material flow technician'], seeAll: 'spacex' },
    { id: 'production', label: 'Production technician', noun: 'SpaceX production technician', queries: ['production technician', 'assembly technician', 'production associate'], match: '(production|assembly|manufacturing|integration|electronics|pcb\\w*|harness|composites?|lamination|paint)\\b.*\\b(technician|associate)|production associate|\\bassociate\\b.*production' },
    { id: 'welding', label: 'Welding and machining', noun: 'SpaceX welding and machining', queries: ['tig welder', 'structural welder', 'cnc machinist'], match: 'weld|machinist|machining|deburr|fabrication technician', seeAll: 'tig welder' },
    { id: 'quality', label: 'Quality and inspection', noun: 'SpaceX quality and inspection', queries: ['quality inspector', 'nde inspector'], match: 'inspect|\\bnde\\b|\\bcmm\\b|quality technician' },
    { id: 'launch', label: 'Launch and test', noun: 'SpaceX launch and test', queries: ['launch pad technician', 'test technician', 'integration technician'], match: 'launch|\\bpad\\b|\\bgse\\b|test technician|integration technician', seeAll: 'launch pad technician' },
    { id: 'facilities', label: 'Facilities and trades', noun: 'SpaceX facilities', queries: ['facilities technician', 'hvac technician', 'electrician'], match: 'facilit|hvac|electrician|plumb|crane|construction|ironworker|boilermaker|controls technician|maintenance technician', seeAll: 'facilities technician' },
    { id: 'warehouse', label: 'Warehouse and logistics', noun: 'SpaceX warehouse and logistics', queries: ['material flow technician', 'warehouse associate', 'inventory specialist'], match: 'warehouse|inventory|material (?:flow|transfer|handler)|receiving|shipping|logistics', seeAll: 'material flow technician' },
    { id: 'new-grad', label: 'New grad engineer', noun: 'SpaceX new grad engineer', queries: ['new graduate engineer'], match: 'new grad', seeAll: 'new graduate engineer' },
  ],
}

// ── The page's openable rows (components/start/Guide.tsx renders each block type) ─────────────────────────────────
export const menu = [
  {
    id: 'jobs-without-a-degree', title: 'Jobs without a degree', summary: 'Hands-on roles, and the experience they ask',
    blocks: [
      { type: 'text', entry: noDegree.intro },
      { type: 'callout', entry: noDegree.catch },
      { type: 'cards', items: roleCards.map((c) => ({ name: c.name, aka: c.aka, body: c.body, chips: c.chips })) },
      { type: 'more', title: 'How much experience they ask, and engineering', blocks: [
        { type: 'text', entry: noDegree.catchDetail },
        { type: 'text', entry: engineering },
      ] },
    ],
  },
  {
    id: 'what-spacex-asks', title: 'What SpaceX asks for', summary: 'U.S.-person rule, shifts, lifting, tests',
    blocks: [
      { type: 'text', entry: asks.intro },
      { type: 'checklist', items: asks.items, cols: true },
      { type: 'more', title: 'The U.S.-person rule, word for word', blocks: [
        { type: 'callout', entry: asks.itarQuote },
        { type: 'text', entry: asks.itarWhy },
        { type: 'text', entry: asks.itarHistory },
      ] },
    ],
  },
  {
    id: 'pay', title: 'Pay', summary: 'Posted ranges by level, and where none',
    blocks: [
      { type: 'text', entry: payIntro },
      { type: 'table', caption: 'Hourly pay by level on SpaceX postings', columns: [{ key: 'role', label: 'Role' }, { key: 'site', label: 'Site' }, { key: 'first', label: 'Entry level, hourly', num: true }, { key: 'third', label: 'Third level, hourly', num: true }], rows: payRows },
      { type: 'note', entry: payNote },
      { type: 'more', title: 'Benefits and stock', blocks: [{ type: 'notes', items: benefits }] },
    ],
  },
  {
    id: 'where-it-hires', title: 'Where it hires', summary: 'Sites, open roles and shift patterns',
    blocks: [
      { type: 'text', entry: siteIntro },
      { type: 'table', caption: 'SpaceX sites with hands-on openings', columns: [{ key: 'site', label: 'Site' }, { key: 'open', label: 'Hands-on openings', num: true }, { key: 'staff', label: 'Staff', num: true }, { key: 'shifts', label: 'Shifts on its postings' }], rows: siteRows },
      { type: 'note', entry: siteNote },
    ],
  },
  {
    id: 'how-hiring-works', title: 'How hiring works', summary: 'Screens, interviews, and moving up',
    blocks: [
      { type: 'text', entry: process },
      { type: 'text', plain: 'What two applicants for technical, non-technician roles say. Both accounts agree on each of these.' },
      { type: 'steps', items: peopleSay },
      { type: 'text', entry: movingUp, lead: 'From a forum discussion about moving up:' },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a SpaceX posting' },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Injury rates, hours, pay gaps and scams',
    blocks: [
      { type: 'notesGrid', groups: [
        { label: 'Before you apply', items: beforeYouApply, icon: 'dot' },
        { label: 'Scams', items: scams, icon: 'x' },
      ] },
      { type: 'more', title: 'Injury rates by site', blocks: [
        { type: 'table', caption: 'Recordable injury rates at SpaceX sites', columns: [{ key: 'site', label: 'Site' }, { key: 'rate', label: 'Recordable injury rate', num: true }], rows: injuryRows },
        { type: 'text', entry: injuryNote },
      ] },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'Degrees, citizenship, pay, hours, drug tests', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links (no numbers, closed by default) ────────────
export const resourcesSummary = 'SpaceX job board, postings, records'
export const resources = [
  { title: 'SpaceX job boards', items: [
    { key: 'sx-board', name: 'SpaceX careers on Greenhouse' },
    { key: 'sx-global', name: 'SpaceX second board: jobs abroad and Starlink field sales' },
  ] },
  { title: 'Postings on this page', items: [
    { key: 'sx-bastrop-assoc', name: 'Starlink Production Associate, Bastrop, TX' },
    { key: 'sx-akoustis', name: 'Production Associate (Akoustis), Canandaigua, NY' },
    { key: 'sx-assembly', name: 'Assembly Technician (Starship), Hawthorne, CA' },
    { key: 'sx-starlink-entry', name: 'Starlink Production Technician, Entry Level, Redmond, WA' },
    { key: 'sx-pcba', name: 'Entry-Level Production Technician, PCBA, Redmond, WA' },
    { key: 'sx-aviation', name: 'Starlink Aviation Production Technician, Woodinville, WA' },
    { key: 'sx-machining', name: 'Machining Technician (Starlink), Entry Level, Woodinville, WA' },
    { key: 'sx-composites', name: 'Composites Lamination Technician, Hawthorne, CA' },
    { key: 'sx-tig-hawthorne', name: 'TIG Welder (Starship), Hawthorne, CA' },
    { key: 'sx-tig-starbase', name: 'TIG Welder (Starship), Starbase, TX' },
    { key: 'sx-apprentice-welder', name: 'Apprentice Welder, McGregor, TX' },
    { key: 'sx-qi', name: 'Quality Inspector (Falcon & Dragon), Hawthorne, CA' },
    { key: 'sx-nde-trainee', name: 'NDE Inspector Trainee, Starbase, TX' },
    { key: 'sx-pad', name: 'Launch Pad Technician, Vandenberg, CA' },
    { key: 'sx-gse', name: 'Fabrication Technician, Starbase, TX' },
    { key: 'sx-electrician', name: 'Electrician (Starship), Starbase, TX' },
    { key: 'sx-hvac', name: 'HVAC Technician (Facilities), Hawthorne, CA' },
    { key: 'sx-warehouse', name: 'Warehouse Associate (Starlink), Bastrop, TX' },
    { key: 'sx-food', name: 'Food Service Attendant, Hawthorne, CA' },
    { key: 'sx-security', name: 'Security Officer, Hawthorne, CA' },
    { key: 'sx-fieldsales', name: 'Field Sales Representative (Starlink), Denver, CO' },
  ] },
  { title: 'Public records', items: [
    { key: 'sec-424b4', name: 'SpaceX prospectus, Human Capital section (SEC)' },
    { key: 'osha-ita', name: 'Workplace injury data by site (OSHA)' },
    { key: 'sec-akoustis', name: 'Akoustis sells its assets to a SpaceX subsidiary (SEC filing)' },
  ] },
  { title: 'The U.S.-person rule in court', items: [
    { key: 'opb-doj', name: 'The Justice Department’s 2023 complaint over refugee and asylee hiring (OPB)' },
    { key: 'txsd-moot', name: 'SpaceX’s challenge in federal court, closed as moot (court filing)' },
    { key: 'ocaho-dismissal', name: 'The case is dismissed (Justice Department order)' },
  ] },
  { title: 'Job scams', items: [
    { key: 'ftc-text', name: 'That job offer text is probably a scam (Federal Trade Commission)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-1ki3f94', name: 'An engineering interview in Florida, and the openings cancelled' },
    { key: 'r-1re0qph', name: 'An engineering interview in Hawthorne' },
    { key: 'r-1vezudj', name: 'From technician to engineer' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
