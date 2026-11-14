// /start/healthcare — "Getting into healthcare without a degree". The page renders from this module only, so every
// figure on it carries a source and an as-of date (lib/start/guides.test.mjs fails on a figure without one).
//
// THE ONLY SOURCE OF FACTS is the research file compiled 2026-11-14 (session scratchpad research/healthcare.md).
// Rules this module keeps:
//   • only items the research marked VERIFIED (federal or state law, BLS / O*NET, the certifying body, the employer's
//     own page); pay is BLS May 2025, projections 2025–35;
//   • FIRST-HAND items (several accounts agreeing) only as `firstHand: true`, rendered as what people say, never as fact;
//   • nothing from the research's UNVERIFIED / CONFLICTING list: no California 160-hour CNA or 170-hour EMT course
//     (CDPH unread), no New York hours, no Florida 120-hour total, no Washington medical-assistant tiers, no Louisiana
//     or Nevada phlebotomy rule, no "only 4 states license phlebotomists", no ASCP $155 or CRCST $140 fee, no CVS exam
//     payment, no Amazon $5,250 cap, no Job Corps track list or status, no paramedic hours, no "2-year RN", no
//     sterile-processing law outside New York and Minnesota, no named school called a scam, no pay by industry;
//   • only paths that need no degree (CNA, phlebotomy, medical assistant, pharmacy tech, EMT, patient care tech, home
//     health aide, sterile processing); nursing is named once, as the next step;
//   • every median here sits below the all-occupations median and the page says so plainly. No hype, no guarantees,
//     no exclamation marks.
//
// Shape: `sources` (every reference behind the page, kept here and never printed as citations — readers reach the
// links through the grouped "Additional resources" menu, `resources` below), entries `{ text, src, firstHand? }`, the
// listings filter config (`listings`) and the openable menu rows (`menu`).

import { blockEntries } from './entries.js'

/** @typedef {{ label: string, url: string, date: string, note?: string }} Source */

/** @type {Record<string, Source>} */
export const sources = {
  'bls-cna': { label: 'U.S. Bureau of Labor Statistics, Occupational Outlook Handbook: Nursing Assistants and Orderlies (May 2025 pay)', url: 'https://www.bls.gov/ooh/healthcare/nursing-assistants.htm', date: '2026-08-27', note: 'page updated' },
  'bls-phleb': { label: 'BLS Occupational Outlook Handbook: Phlebotomists (May 2025 pay)', url: 'https://www.bls.gov/ooh/healthcare/phlebotomists.htm', date: '2026-09-14', note: 'page updated' },
  'bls-ma': { label: 'BLS Occupational Outlook Handbook: Medical Assistants (May 2025 pay)', url: 'https://www.bls.gov/ooh/healthcare/medical-assistants.htm', date: '2026-08-27', note: 'page updated' },
  'bls-pharm': { label: 'BLS Occupational Outlook Handbook: Pharmacy Technicians (May 2025 pay)', url: 'https://www.bls.gov/ooh/healthcare/pharmacy-technicians.htm', date: '2026-08-27', note: 'page updated' },
  'bls-emt': { label: 'BLS Occupational Outlook Handbook: EMTs and Paramedics (May 2025 pay)', url: 'https://www.bls.gov/ooh/healthcare/emts-and-paramedics.htm', date: '2026-08-27', note: 'page updated' },
  'bls-hha': { label: 'BLS Occupational Outlook Handbook: Home Health and Personal Care Aides (May 2025 pay)', url: 'https://www.bls.gov/ooh/healthcare/home-health-aides-and-personal-care-aides.htm', date: '2026-08-27', note: 'page updated' },
  'bls-home': { label: 'BLS Occupational Outlook Handbook: Healthcare Occupations overview (all-occupations median, May 2025)', url: 'https://www.bls.gov/ooh/healthcare/home.htm', date: '2026-08-27', note: 'page updated' },
  'bls-lpn': { label: 'BLS Occupational Outlook Handbook: Licensed Practical and Licensed Vocational Nurses (May 2025 pay)', url: 'https://www.bls.gov/ooh/healthcare/licensed-practical-and-licensed-vocational-nurses.htm', date: '2026-09-14', note: 'page updated' },
  'bls-rn': { label: 'BLS Occupational Outlook Handbook: Registered Nurses (May 2025 pay)', url: 'https://www.bls.gov/ooh/healthcare/registered-nurses.htm', date: '2026-10-29', note: 'page updated' },
  'bls-pharmacist': { label: 'BLS Occupational Outlook Handbook: Pharmacists (May 2025 pay)', url: 'https://www.bls.gov/ooh/healthcare/pharmacists.htm', date: '2026-10-29', note: 'page updated' },
  'onet-cna': { label: 'O*NET OnLine, Nursing Assistants (31-1131.00), wages (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/localwages/31-1131.00', date: '2026-11-14', note: 'read' },
  'onet-phleb': { label: 'O*NET OnLine, Phlebotomists (31-9097.00), wages (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/localwages/31-9097.00', date: '2026-11-14', note: 'read' },
  'onet-ma': { label: 'O*NET OnLine, Medical Assistants (31-9092.00), wages (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/localwages/31-9092.00', date: '2026-11-14', note: 'read' },
  'onet-pharm': { label: 'O*NET OnLine, Pharmacy Technicians (29-2052.00), wages (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/localwages/29-2052.00', date: '2026-11-14', note: 'read' },
  'onet-emt': { label: 'O*NET OnLine, Emergency Medical Technicians (29-2042.00), wages (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/localwages/29-2042.00', date: '2026-11-14', note: 'read' },
  'onet-hha': { label: 'O*NET OnLine, Home Health Aides (31-1121.00), wages (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/localwages/31-1121.00', date: '2026-11-14', note: 'read' },
  'onet-spd-wage': { label: 'O*NET OnLine, Medical Equipment Preparers (31-9093.00), wages (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/localwages/31-9093.00', date: '2026-11-14', note: 'read' },
  'onet-spd': { label: 'O*NET OnLine, Medical Equipment Preparers (31-9093.00), summary: jobs and openings', url: 'https://www.onetonline.org/link/summary/31-9093.00', date: '2026-11-14', note: 'read' },
  'onet-orderly': { label: 'O*NET OnLine, Orderlies (31-1132.00), summary: reported titles include Patient Care Technician', url: 'https://www.onetonline.org/link/summary/31-1132.00', date: '2026-11-14', note: 'read' },
  'onet-paramedic': { label: 'O*NET OnLine, Paramedics (29-2043.00), wages (BLS 2025 wage data)', url: 'https://www.onetonline.org/link/localwages/29-2043.00', date: '2026-11-14', note: 'read' },
  'cfr-483-152': { label: '42 CFR 483.152, requirements for nurse aide training and competency evaluation programs (eCFR)', url: 'https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-483/subpart-D/section-483.152', date: '2026-11-01', note: 'text as of' },
  'cfr-483-35': { label: '42 CFR 483.35, nursing services: nurse aides and the registry check (eCFR)', url: 'https://www.ecfr.gov/current/title-42/section-483.35', date: '2026-11-01', note: 'text as of' },
  'cfr-484-80': { label: '42 CFR 484.80, home health aide training and competency (eCFR)', url: 'https://www.ecfr.gov/current/title-42/section-484.80', date: '2026-11-01', note: 'text as of' },
  'cfr-483-12': { label: '42 CFR 483.12, who a nursing home must not employ (eCFR)', url: 'https://www.ecfr.gov/current/title-42/section-483.12', date: '2026-11-14', note: 'read' },
  'cms-careers': { label: 'Centers for Medicare & Medicaid Services, Nursing Home Careers overview', url: 'https://www.cms.gov/priorities/nursing-home-careers/overview', date: '2026-10-23', note: 'page updated' },
  'tx-556': { label: '26 Tex. Admin. Code § 556.3, nurse aide training programs (Cornell Legal Information Institute)', url: 'https://law.cornell.edu/regulations/texas/26-Tex-Admin-Code-SS-556-3', date: '2026-11-14', note: 'read' },
  'fl-464': { label: 'Florida Statutes § 464.203, certified nursing assistants: certification requirement', url: 'https://www.flsenate.gov/Laws/Statutes/2025/464.203', date: '2026-11-14', note: 'read' },
  'ca-phleb': { label: '17 Cal. Code Regs. § 1035, phlebotomy training programs (Cornell Legal Information Institute)', url: 'https://www.law.cornell.edu/regulations/california/17-CCR-1035', date: '2026-11-14', note: 'read' },
  'tx-pharm': { label: 'Texas State Board of Pharmacy, Pharmacy Technician Trainee registration', url: 'https://www.pharmacy.texas.gov/applicants/tech-trainee.asp', date: '2026-11-14', note: 'read' },
  'ca-pharm': { label: 'California State Board of Pharmacy, pharmacy technician application (form 17A-5)', url: 'https://www.pharmacy.ca.gov/forms/tch_app_pkt.pdf', date: '2021-12', note: 'form revised' },
  'nremt-emt': { label: 'National Registry of EMTs, EMT certification: full education program', url: 'https://www.nremt.org/Document/EMT-Full-Education-Program', date: '2026-11-14', note: 'read' },
  'nremt-para': { label: 'National Registry of EMTs, letter from the Chair on paramedic program accreditation', url: 'https://www.nremt.org:443/getmedia/8c064a0e-515f-400a-a97b-73fa0a734a7a/NREMT-letter-from-Chair-June-2022.pdf', date: '2022-06', note: 'published' },
  'ny-spd': { label: 'New York Public Health Law § 2824, central service technicians', url: 'https://www.nysenate.gov/legislation/laws/PBH/2824', date: '2026-11-14', note: 'read' },
  'mn-spd': { label: 'Healthcare Sterile Processing Association (HSPA), Minnesota certification FAQ', url: 'https://myhspa.org/wp-content/uploads/2025/06/MN-FAQs.pdf', date: '2025-06', note: 'published' },
  'nha-cpt': { label: 'National Healthcareer Association (NHA), Certified Phlebotomy Technician (CPT)', url: 'https://www.nhanow.com/certifications/phlebotomy-technician', date: '2026-11-14', note: 'read' },
  'nha-ccma': { label: 'NHA, Certified Clinical Medical Assistant (CCMA)', url: 'https://www.nhanow.com/certifications/clinical-medical-assistant', date: '2026-11-14', note: 'read' },
  'nha-excpt': { label: 'NHA, Certified Pharmacy Technician (ExCPT)', url: 'https://www.nhanow.com/certifications/pharmacy-technician', date: '2026-11-14', note: 'read' },
  'nha-cpct': { label: 'NHA, Certified Patient Care Technician/Assistant (CPCT/A)', url: 'https://www.nhanow.com/certifications/patient-care-technician', date: '2026-11-14', note: 'read' },
  'aama': { label: 'American Association of Medical Assistants, CMA (AAMA) eligibility', url: 'https://aama-ntl.org/certification/eligibility', date: '2026-11-14', note: 'read' },
  'ptcb': { label: 'Pharmacy Technician Certification Board (PTCB), Certified Pharmacy Technician (CPhT)', url: 'https://www.ptcb.org/credentials/certified-pharmacy-technician', date: '2026-11-14', note: 'read' },
  'hspa-crcst': { label: 'HSPA, Certified Registered Central Service Technician (CRCST)', url: 'https://myhspa.org/certification/instrument/crcst/', date: '2026-11-14', note: 'read' },
  'walgreens': { label: 'Walgreens, pharmacy technician training and certification', url: 'https://jobs.walgreens.com/pharmtechlicense', date: '2026-11-14', note: 'read' },
  'ptcb-walgreens': { label: 'PTCB, employer profile: Walgreens', url: 'https://ptcb.org/?p=1559', date: '2026-11-14', note: 'read' },
  'cvs-instore': { label: 'CVS Health careers, in-store and pharmacy jobs (LearnRx)', url: 'https://jobs.cvshealth.com/us/en/in-store', date: '2026-11-14', note: 'read' },
  'cvs-apprentice': { label: 'CVS Health, Registered Apprenticeship programs', url: 'https://www.cvshealth.com/about/our-strategy/inclusionandbelonging/workforce-initiatives/apprenticeships.html', date: '2026-11-14', note: 'read' },
  'amazon-cc1': { label: 'Amazon, Career Choice training programs', url: 'https://www.aboutamazon.com/news/workplace/amazon-career-choice-training-programs-tuition-careers', date: '2026-09-04', note: 'published' },
  'amazon-cc2': { label: 'Amazon, Career Choice and higher-paying jobs', url: 'https://www.aboutamazon.com/news/workplace/amazon-career-choice-high-paying-jobs', date: '2024-01-17', note: 'published' },
  'vumc': { label: 'Vanderbilt University Medical Center, Central Sterile Processing Technician program', url: 'https://vumc.org/allied-health-education/central-sterile-processing-technician', date: '2026-11-14', note: 'read' },
  'uwhealth': { label: 'UW Health, medical assistant apprenticeship', url: 'https://careers.uwhealth.org/?p=3642', date: '2026-11-14', note: 'read' },
  'centralhealth': { label: 'Central Health (Austin, TX), medical assistant apprenticeship program', url: 'https://www.centralhealth.net/about-central-health/careers/ma-apprenticeship-program/', date: '2026-11-14', note: 'read' },
  'redcross': { label: 'American Red Cross, Nurse Assistant Training', url: 'https://www.redcross.org/take-a-class/cna.html', date: '2026-11-14', note: 'read' },
  'jobcorps': { label: 'Job Corps (U.S. Department of Labor)', url: 'https://www.jobcorps.gov/', date: '2026-11-14', note: 'read' },
  'dol-tegl': { label: 'U.S. Department of Labor, TEGL 08-19: WIOA training and the Eligible Training Provider List', url: 'https://www.dol.gov/sites/dolgov/files/ETA/advisories/TEGL/2020/TEGL_8-19_acc.pdf', date: '2026-11-14', note: 'read' },
  'careeronestop': { label: 'CareerOneStop (U.S. Department of Labor), training and American Job Center finder', url: 'https://www.careeronestop.org/', date: '2026-11-14', note: 'read' },
  'pima': { label: 'Pima Community College, Nursing Assistant Certificate costs, 2026–27', url: 'https://pima.edu/academics-programs/degrees-certificates/health-sciences/nursing/cna/costs.html', date: '2026-11-14', note: 'read' },
  'laketech': { label: 'Lake Technical College, Nursing Assistant cost sheet', url: 'https://www.laketech.org/wp-content/uploads/2026/07/Nursing-Asst-Cost-Sheet-070126.pdf', date: '2026-07-01', note: 'cost sheet dated' },
  'oig-auth': { label: 'HHS Office of Inspector General, exclusion authorities', url: 'https://oig.hhs.gov/exclusions/authorities.asp', date: '2026-11-14', note: 'read' },
  'oig-leie': { label: 'HHS Office of Inspector General, List of Excluded Individuals/Entities', url: 'https://oig.hhs.gov/exclusions/', date: '2026-11-14', note: 'read' },
  'osha-bbp': { label: 'OSHA, 29 CFR 1910.1030, bloodborne pathogens: hepatitis B vaccination', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1030', date: '2026-11-14', note: 'read' },
  'cdc-vax': { label: 'CDC, vaccines recommended for healthcare workers', url: 'https://www.cdc.gov/vaccines-adults/recommended-vaccines/index.html', date: '2024-06-12', note: 'page updated' },
  'cdc-tb': { label: 'CDC, baseline TB screening and testing for health care personnel', url: 'https://cdc.gov/tb-healthcare-settings/hcp/screening-testing/baseline-testing.html', date: '2023-12-19', note: 'page updated' },
  'crl-2018': { label: 'Center for Responsible Lending, "A Bitter Pill": for-profit healthcare support programs', url: 'https://www.responsiblelending.org/media/crl-report-financial-distress-dominates-experience-profit-healthcare-support-students', date: '2018-06-07', note: 'published' },
  // First-hand accounts (Reddit threads read through the Arctic Shift archive); never presented as fact.
  'r-cna36': { label: 'r/cna, "I had 36 residents tonight"', url: 'https://www.reddit.com/r/cna/comments/1wx4wqc/i_had_36_residents_tonight/', date: '2026-10-04', note: 'thread' },
  'r-cna13': { label: 'r/cna, "How am I supposed to change 13 people in 2.5 hours"', url: 'https://www.reddit.com/r/cna/comments/1x71py4/how_am_i_supposed_to_change_13_people_in_25_hours/', date: '2026-10-16', note: 'thread' },
  'r-cnaleave': { label: 'r/cna, "I think I hate this field, should I leave nursing"', url: 'https://www.reddit.com/r/cna/comments/1wlqefn/i_think_i_hate_this_field_should_i_leave_nursing/', date: '2026-11-14', note: 'read' },
  'r-cnapay': { label: 'r/cna, "Why is the pay for us so low"', url: 'https://www.reddit.com/r/cna/comments/1xqitg8/why_is_the_pay_for_us_so_low/', date: '2026-11-07', note: 'thread' },
  'r-cnaca': { label: 'r/cna, "California starting pay $20"', url: 'https://www.reddit.com/r/cna/comments/1vsuzpe/california_starting_pay_20/', date: '2026-11-14', note: 'read' },
  'r-cnaback': { label: 'r/cna, "Is it right for the nurse to tell me not to raise…"', url: 'https://www.reddit.com/r/cna/comments/1w4nhst/is_it_right_for_the_nurse_to_tell_me_not_to_raise/', date: '2026-11-14', note: 'read' },
  'r-cnafree': { label: 'r/cna, "I\'m free"', url: 'https://www.reddit.com/r/cna/comments/1umopsr/im_free/', date: '2026-11-14', note: 'read' },
  'r-cnaburnout': { label: 'r/cna, "1st CNA job: tips for preventing burnout"', url: 'https://www.reddit.com/r/cna/comments/1xfbayj/1st_cna_job_tips_for_preventing_burnout/', date: '2026-11-14', note: 'read' },
  'r-malow': { label: 'r/MedicalAssistant, "I\'m sick of the low pay"', url: 'https://www.reddit.com/r/MedicalAssistant/comments/1wog6jz/im_sick_of_the_low_pay/', date: '2026-09-23', note: 'thread' },
  'r-maraise': { label: 'r/MedicalAssistant, "Is anyone actually surviving on full-time clinic…"', url: 'https://www.reddit.com/r/MedicalAssistant/comments/1x8f63b/is_anyone_actually_surviving_on_fulltime_clinic/', date: '2026-11-14', note: 'read' },
  'r-maroi': { label: 'r/MedicalAssistant, "Can you guys explain why you became MAs"', url: 'https://www.reddit.com/r/MedicalAssistant/comments/1wcle3a/can_you_guys_explain_why_you_became_mas_because/', date: '2026-11-14', note: 'read' },
  'r-phleb1': { label: 'r/phlebotomy, "Why is it so hard to find a job as a phlebotomist"', url: 'https://www.reddit.com/r/phlebotomy/comments/1x8cuu9/why_is_it_so_hard_to_find_a_job_as_a_phlebotomist/', date: '2026-11-14', note: 'read' },
  'r-phleb2': { label: 'r/phlebotomy, "Is it really that hard to find a phlebotomy job"', url: 'https://www.reddit.com/r/phlebotomy/comments/1xsb1ko/is_it_really_that_hard_to_find_a_phlebotomy_job/', date: '2026-11-14', note: 'read' },
  'r-phleb3': { label: 'r/phlebotomy, "One year, no job"', url: 'https://www.reddit.com/r/phlebotomy/comments/1xw0cdd/one_year_no_job/', date: '2026-11-14', note: 'read' },
  'r-phleb4': { label: 'r/phlebotomy, "Just finished my 40-hour in-class training, scared"', url: 'https://www.reddit.com/r/phlebotomy/comments/1vbezsi/just_finished_my_40_hour_inclass_training_scared/', date: '2026-11-14', note: 'read' },
  'r-pharm1': { label: 'r/PharmacyTechnician, "Please tell me that other chain retail pharmacies…"', url: 'https://www.reddit.com/r/PharmacyTechnician/comments/1x9dwlv/please_tell_me_that_other_chain_retail_pharmacys/', date: '2026-11-14', note: 'read' },
  'r-pharm2': { label: 'r/PharmacyTechnician, "I understand why people leave retail pharmacies"', url: 'https://www.reddit.com/r/PharmacyTechnician/comments/1xqexun/i_understand_why_people_leave_retail_pharmacies/', date: '2026-11-14', note: 'read' },
  'r-pharm3': { label: 'r/PharmacyTechnician, "I got the job"', url: 'https://www.reddit.com/r/PharmacyTechnician/comments/1x0ak8j/i_got_the_job/', date: '2026-11-14', note: 'read' },
  'r-emslv': { label: 'r/NewToEMS, "Las Vegas private EMS is a joke"', url: 'https://www.reddit.com/r/NewToEMS/comments/1x7pa59/las_vegas_private_ems_is_a_joke_just_a_rant/', date: '2026-11-14', note: 'read' },
  'r-emsnyc': { label: 'r/NewToEMS, "My NYC EMS experience"', url: 'https://www.reddit.com/r/NewToEMS/comments/1x7wv0b/my_nyc_ems_experience/', date: '2026-11-14', note: 'read' },
  'r-spd1': { label: 'r/sterileprocessing, "I have my CRCST certification but can\'t get 400…"', url: 'https://www.reddit.com/r/sterileprocessing/comments/1x5ulho/i_have_my_crcst_certification_but_cant_get_400/', date: '2026-11-14', note: 'read' },
  'r-spd2': { label: 'r/sterileprocessing, "Impossible to find a job"', url: 'https://www.reddit.com/r/sterileprocessing/comments/1woshgv/impossible_to_find_a_job/', date: '2026-11-14', note: 'read' },
  'r-spd3': { label: 'r/sterileprocessing, "Passed my CRCST exam provisionally, struggling to…"', url: 'https://www.reddit.com/r/sterileprocessing/comments/1xa4i62/passed_my_crcst_exam_provisionally_struggling_to/', date: '2026-11-14', note: 'read' },
  'r-spd4': { label: 'r/sterileprocessing, "How can I get my 400 hrs"', url: 'https://www.reddit.com/r/sterileprocessing/comments/1xizo4o/how_can_i_get_my_400_hrs/', date: '2026-11-14', note: 'read' },
  'r-spdhired': { label: 'r/sterileprocessing, "I got the hospital job"', url: 'https://www.reddit.com/r/sterileprocessing/comments/1vj9jc8/i_got_the_hospital_job/', date: '2026-11-14', note: 'read' },
}

export const guide = {
  path: '/start/healthcare',
  title: 'Getting into healthcare without a degree',
  crumbLabel: 'Healthcare',
  eyebrow: 'Guide',
  // The one-sentence answer under the h1 (the page's first screen).
  answer: { text: 'Most of these jobs take weeks to a few months of training, and some employers pay for it. Every one pays below the national median for all jobs; the bigger raises come with the next license.', src: ['cfr-483-152', 'vumc', 'bls-home', 'bls-lpn'] },
  metaDescription: 'How to get into healthcare without a degree: CNA, phlebotomy, medical assistant, pharmacy tech, EMT, patient care tech, home health aide and sterile processing. Training rules, what each pays, who pays for training, and live listings near you.',
  asOf: '2026-11-14',
}

// The three readings in the hero: each restates a sourced fact below, with the same sources.
export const tiles = [
  { label: 'CNA training, federal minimum', value: '75 hours', text: 'and free if a nursing home has hired you or offered you the job first', src: ['cfr-483-152'] },
  { label: 'Median pay', value: '$35,800–$47,700', text: 'a year across these jobs, May 2025; all below $50,980, the median for all U.S. jobs', src: ['bls-hha', 'onet-spd-wage', 'bls-home'] },
  { label: 'Openings a year', value: '203,300', text: 'projected for nursing assistants and orderlies, 2025–35', src: ['bls-cna'] },
]

// 1. Job by job. `trade` is the job, `length` the training, `path` the way in, `apply` where the jobs are and what to
// check; the median carries its BLS source (rendered by the `tradeRows` block).
export const jobRows = [
  { trade: 'Nursing assistant (CNA)', path: 'A state-approved training program, then the state competency exam to get on the nurse aide registry', length: 'At least 75 hours', apply: 'Nursing homes, hospitals and home health agencies. A nursing home that hires you before training must not charge you for it.', median: '$42,260', src: ['bls-cna', 'cfr-483-152'] },
  { trade: 'Phlebotomist', path: 'A certificate program of under a year; some employers train high school graduates on the job. Some states require a license or certification.', length: 'Under a year', apply: 'Hospitals and labs. Employers often prefer a national certification such as NHA\'s CPT, which needs 30 blood draws on live people.', median: '$45,230', src: ['bls-phleb', 'nha-cpt'] },
  { trade: 'Medical assistant', path: 'A certificate program, or training on the job. The BLS says most states do not require certification.', length: 'Varies', apply: 'Doctors\' offices and clinics. Many employers prefer a CCMA, CMA (AAMA) or RMA, and some require one.', median: '$45,690', src: ['bls-ma'] },
  { trade: 'Pharmacy technician', path: 'A high school diploma, then on-the-job training. Most states register or license pharmacy techs.', length: 'On the job', apply: 'Retail pharmacies and hospitals. Walgreens and CVS run paid trainee programs.', median: '$45,750', src: ['bls-pharm', 'walgreens', 'cvs-instore'] },
  { trade: 'EMT', path: 'A state-approved EMT course, then a state license. Most states use the NREMT exam; others give their own.', length: 'Varies by state', apply: 'Ambulance services. Every state requires a license before you work.', median: '$44,470', src: ['bls-emt', 'nremt-emt'] },
  { trade: 'Patient care tech', path: 'Usually a CNA plus hospital training. NHA offers a patient care technician certification (CPCT/A).', length: 'CNA, then more', apply: 'Hospitals. Many patient care tech postings ask for a CNA.', median: '$38,290', src: ['onet-orderly', 'nha-cpct'] },
  { trade: 'Home health aide', path: 'At Medicare-certified home health agencies, at least 75 hours of training and a competency check. Some states add a license or certificate.', length: 'At least 75 hours', apply: 'Home health and home care agencies.', median: '$35,800', src: ['bls-hha', 'cfr-484-80'] },
  { trade: 'Sterile processing tech', path: 'No set schooling: employers train. The CRCST certification needs 400 hours of hands-on work in a sterile processing department.', length: 'Employers train', apply: 'Hospital trainee jobs, such as Vanderbilt University Medical Center\'s paid program. New York requires certification within 18 months of hire.', median: '$47,700', src: ['onet-spd-wage', 'hspa-crcst', 'vumc', 'ny-spd'] },
]
export const jobNote = { text: 'Medians are national yearly pay for May 2025. Home health aides are counted with personal care aides, and patient care techs with orderlies. The median for all U.S. jobs was $50,980; every job here is below it.', src: ['bls-home', 'bls-hha', 'onet-orderly'] }

// Hourly pay, from the 10th to the 90th percentile (one tap away).
export const payRows = [
  { job: 'Nursing assistant', median: '$20.32', range: '$16.32 to $24.99', src: ['bls-cna', 'onet-cna'] },
  { job: 'Phlebotomist', median: '$21.75', range: '$17.20 to $28.26', src: ['bls-phleb', 'onet-phleb'] },
  { job: 'Medical assistant', median: '$21.97', range: '$17.33 to $28.52', src: ['bls-ma', 'onet-ma'] },
  { job: 'Pharmacy technician', median: '$22.00', range: '$17.32 to $29.35', src: ['bls-pharm', 'onet-pharm'] },
  { job: 'EMT', median: '$21.38', range: '$16.41 to $30.05', src: ['bls-emt', 'onet-emt'] },
  { job: 'Home health and personal care aide', median: '$17.21', range: '$13.00 to $21.65', src: ['bls-hha', 'onet-hha'] },
  { job: 'Sterile processing tech', median: '$22.93', range: '$17.50 to $33.63', src: ['onet-spd-wage'] },
  { job: 'Patient care tech (with orderlies)', median: '$18.41', range: null, src: ['onet-orderly'] },
]
export const payNote = { text: 'The low end is what the lowest-paid 10% earn and the high end what the top 10% pass, May 2025. Pay by type of employer, such as nursing homes against hospitals, is not shown here.', src: ['onet-cna'] }
export const growth = [
  { text: 'Medical assistants are projected to grow 13% from 2025 to 2035, much faster than average; phlebotomists 7%, pharmacy techs and EMTs 6%.', src: ['bls-ma', 'bls-phleb', 'bls-pharm', 'bls-emt'] },
  { text: 'Nursing assistants and orderlies are projected to have about 203,300 openings a year; sterile processing techs about 10,700.', src: ['bls-cna', 'onet-spd'] },
]

// 2. Becoming a CNA: the federal floor, then how states differ. `name` is what a reader scans, `text` the detail.
export const cna = {
  items: [
    { name: 'At least 75 hours of training', text: 'The federal minimum for a nursing-home aide program, including at least 16 hours of supervised practical training.', src: ['cfr-483-152'] },
    { name: 'Class before you touch a resident', text: 'At least 16 hours on communication, infection control, safety, and residents\' rights and independence come first.', src: ['cfr-483-152'] },
    { name: 'A state exam, then the registry', text: 'Every state keeps a nurse aide registry, and a nursing home must check it before letting you work as an aide.', src: ['cfr-483-35', 'cfr-483-152'] },
    { name: 'Up to 4 months to finish', text: 'A nursing home may use a new aide full-time for up to 4 months while the aide completes training and the exam.', src: ['cfr-483-35'] },
    { name: 'Keep working, or retest', text: 'After 24 months in a row without paid nursing work, you must retrain or retest.', src: ['cfr-483-35'] },
  ],
  free: { text: 'The federal rule: "No nurse aide who is employed by, or who has received an offer of employment from, a facility on the date on which the aide begins a nurse aide training and competency evaluation program may be charged for any portion of the program (including any fees for textbooks or other required course materials)."', src: ['cfr-483-152', 'cms-careers'] },
  refund: { text: 'If you paid for training yourself and a nursing home hires you within 12 months of finishing, the state must pay you back a share of it while you work as an aide.', src: ['cfr-483-152'] },
  states: [
    { text: 'Texas requires 100 hours: 60 in class (in person, online, or the state\'s free computer-based training) and 40 clinical, with no more than 10 trainees per instructor.', src: ['tx-556'] },
    { text: 'Florida lets you take the exam without training if you have a high school diploma or equivalent, or are at least 18, and pass background screening. After 3 failed attempts you must finish an approved program, and CNAs need 24 hours of in-service training every two years.', src: ['fl-464'] },
    { text: 'Hospitals are not covered by the federal nursing-home rule; they set their own requirements.', src: ['cfr-483-35'] },
    { text: 'The American Red Cross stopped its nurse assistant training after December 31, 2023; it still teaches CPR.', src: ['redcross'] },
  ],
}

// 3. Who pays for training (verified programs only) + the caveat.
export const employers = [
  { name: 'Any Medicare or Medicaid nursing home', chip: { text: 'CNA training at no charge', src: ['cfr-483-152'] }, text: 'Cannot charge you for any part of CNA training if it employs you, or has offered you a job, before training starts.', src: ['cfr-483-152', 'cms-careers'] },
  { name: 'Walgreens', chip: { text: 'Paid position', src: ['walgreens'] }, text: 'A paid pharmacy technician training program. Walgreens "pays for trainees to complete the PTCB training and to pass the Pharmacy Technician Certification Exam."', src: ['walgreens', 'ptcb-walgreens'] },
  { name: 'CVS Health', chip: { text: 'No experience required', src: ['cvs-instore'] }, text: 'LearnRx pharmacy technician training. CVS says it launched the first Registered Apprenticeship for pharmacy techs in 2005; its pages do not say whether it pays for the certification exam.', src: ['cvs-instore', 'cvs-apprentice'] },
  { name: 'Vanderbilt University Medical Center', chip: { text: 'Paid 12-week program', src: ['vumc'] }, text: 'Sterile Processing Tech Trainee: tuition covered and an hourly wage, weekdays on day shift, then 1 year full-time at VUMC. Applications for January 2027 open November 16, 2026 and usually close within 24 to 48 hours.', src: ['vumc'] },
  { name: 'UW Health, Wisconsin', chip: { text: 'Paid apprenticeship', src: ['uwhealth'] }, text: 'A 10-month medical assistant apprenticeship, paid 40 hours a week, with the CCMA exam and a 2-year work agreement. Open to outside applicants; the next group starts February 8, 2027.', src: ['uwhealth'] },
  { name: 'Central Health and Austin Community College', chip: { text: 'Tuition covered', src: ['centralhealth'] }, text: 'A 15-week medical assistant apprenticeship in Texas, hired full time with benefits, with the certification exam at no cost. Age 18 or older with a diploma or GED; applications open December 1, 2026.', src: ['centralhealth'] },
  { name: 'Amazon Career Choice', chip: { text: 'From the first day', src: ['amazon-cc1'] }, text: 'For Amazon employees: Amazon pays tuition up front, up to a yearly cap it does not state, for certifications that include pharmacy technician, medical assistant and EMT.', src: ['amazon-cc1', 'amazon-cc2'] },
]
export const caveatLine = { text: 'Paid programs usually come with a work commitment: 1 year at Vanderbilt, 2 years at UW Health. Read the terms before you sign.', src: ['vumc', 'uwhealth'] }
export const freeHelp = [
  { name: 'WIOA training funds', url: 'https://www.careeronestop.org/', text: 'Your local American Job Center can pay for training at an approved provider through an Individual Training Account. Local boards decide who qualifies and which jobs count, so amounts vary.', src: ['dol-tegl', 'careeronestop'] },
  { name: 'Job Corps', url: 'https://www.jobcorps.gov/', text: 'Free, residential job training for low-income people aged 16 through 24. Ask a center which health care training it offers.', src: ['jobcorps'] },
]
export const selfPay = [
  { text: 'Pima Community College in Arizona estimates $1,514 for its 2026–27 nursing assistant certificate, including tuition, fees, books, a drug screen, a fingerprint card and the credential.', src: ['pima'] },
  { text: 'Lake Technical College in Florida lists $1,929.16 for its 165-hour nursing assistant program, including $250 for vaccinations and $185 for a background check.', src: ['laketech'] },
]

// 4. Certifications and the law: what is required, and what employers ask for.
export const law = [
  { name: 'CNA', text: 'Required by federal rule to work in a nursing home past 4 months: state-approved training and exam, and a place on the registry.', src: ['cfr-483-35'] },
  { name: 'Home health aide', text: 'Medicare-certified agencies: at least 75 hours of training, a competency check, and 12 hours of in-service training a year.', src: ['cfr-484-80'] },
  { name: 'EMT', text: 'Every state requires a license. NREMT asks for a state-approved course finished in the past 2 years, a skills check, and the exam: $104 a try.', src: ['bls-emt', 'nremt-emt'] },
  { name: 'Pharmacy technician', text: 'Most states regulate the job. Texas registers trainees while they finish a program (up to 2 years, once); California accepts PTCB or ExCPT certification, among other routes.', src: ['bls-pharm', 'tx-pharm', 'ca-pharm'] },
  { name: 'Phlebotomist', text: 'Only some states require a license or certification. California programs include at least 40 hours of practical training and 50 blood draws.', src: ['bls-phleb', 'ca-phleb'] },
  { name: 'Medical assistant', text: 'The BLS says most states do not require certification; employers decide.', src: ['bls-ma'] },
  { name: 'Sterile processing', text: 'New York requires certification within 18 months of hire. Minnesota will require it within 2 years of hire for new technicians from January 1, 2028.', src: ['ny-spd', 'mn-spd'] },
]
export const certRows = [
  { cert: 'CPT (phlebotomy)', body: 'NHA', takes: 'A diploma or GED, then a program or 1 year of supervised work; 30 blood draws and 10 finger sticks on live people', fee: 'Renew every 2 years', src: ['nha-cpt'] },
  { cert: 'CCMA (medical assistant)', body: 'NHA', takes: 'A diploma or GED, then a program or 1 year of supervised work', fee: 'Renew every 2 years', src: ['nha-ccma'] },
  { cert: 'CMA (medical assistant)', body: 'AAMA', takes: 'An accredited (CAAHEP or ABHES) program or an approved apprenticeship', fee: '$125 members, $250 others', src: ['aama'] },
  { cert: 'CPhT (pharmacy tech)', body: 'PTCB', takes: 'A PTCB-recognized program or 500 hours of work', fee: '$129', src: ['ptcb'] },
  { cert: 'ExCPT (pharmacy tech)', body: 'NHA', takes: 'A program or 1,200 hours of supervised pharmacy work', fee: 'Renew every 2 years', src: ['nha-excpt'] },
  { cert: 'EMT', body: 'NREMT', takes: 'A state-approved course, a skills check and the exam', fee: '$104 a try', src: ['nremt-emt'] },
  { cert: 'CRCST (sterile processing)', body: 'HSPA', takes: '400 hours of hands-on work in a sterile processing department, paid or volunteer', fee: 'Renew yearly: 12 continuing education credits, $50', src: ['hspa-crcst'] },
  { cert: 'CPCT/A (patient care tech)', body: 'NHA', takes: 'A diploma or GED, then a program or 1 year of work', fee: 'Renew every 2 years', src: ['nha-cpct'] },
]

// 5. The hard parts, said plainly (BLS, federal rules).
export const pay = { text: 'Every median on this page is below $50,980, the national median for all jobs. Home health and personal care aides, at $35,800, are about $15,000 a year below it.', src: ['bls-home', 'bls-hha'] }
export const shifts = [
  { text: 'EMTs: some work shifts of 12, 18 or 24 hours, with nights, weekends and holidays.', src: ['bls-emt'] },
  { text: 'Phlebotomists in hospitals and labs may work nights, weekends and holidays; pharmacies "may be open at all hours."', src: ['bls-phleb', 'bls-pharm'] },
  { text: 'Medical assistants mostly work in doctors\' offices (56%), with some evenings and weekends.', src: ['bls-ma'] },
]
export const injuries = [
  { text: 'Nursing assistants and orderlies have "one of the highest rates of injuries and illnesses of all occupations," and so do EMTs.', src: ['bls-cna', 'bls-emt'] },
  { text: 'Home health aides risk back injuries, and some clients "may act difficult or violently."', src: ['bls-hha'] },
]
export const checks = [
  { text: 'A nursing home must not employ anyone a court found guilty of abuse, neglect, exploitation, misappropriation of property or mistreatment, or who has such a finding on the nurse aide registry.', src: ['cfr-483-12'] },
  { text: 'The federal government must exclude people convicted of patient abuse or neglect, Medicare or Medicaid fraud, or a felony drug offense from federal health programs, and employers check its exclusion list.', src: ['oig-auth', 'oig-leie'] },
  { text: 'Florida CNAs must pass background screening, California pharmacy techs are fingerprinted, and PTCB asks for full disclosure of criminal history.', src: ['fl-464', 'ca-pharm', 'ptcb'] },
]
export const health = [
  { text: 'The CDC says all U.S. health care workers should be screened for tuberculosis when hired.', src: ['cdc-tb'] },
  { text: 'An employer must offer the hepatitis B vaccine free to anyone exposed to blood at work, within 10 working days of starting.', src: ['osha-bbp'] },
  { text: 'The CDC recommends flu, hepatitis B, MMR, chickenpox and Tdap vaccines for health care workers; each employer sets its own requirements. Students may pay for their own: Lake Technical College lists $250 for vaccinations.', src: ['cdc-vax', 'laketech'] },
]
// What people in these jobs say (first-hand, several accounts each).
export const peopleSay = [
  { text: 'In nursing homes and assisted living, aides describe 15 to 20 residents on a shift, more after a call-out, for pay they compare to fast food.', src: ['r-cna36', 'r-cna13', 'r-cnaleave', 'r-cnapay', 'r-cnaca'], firstHand: true },
  { text: 'Back pain and lasting injuries come up often among CNAs.', src: ['r-cnaback', 'r-cnafree', 'r-cnaburnout'], firstHand: true },
  { text: 'Medical assistants describe low pay in private offices and small raises, and some say expensive programs were not worth it.', src: ['r-malow', 'r-maraise', 'r-maroi'], firstHand: true },
  { text: 'The first phlebotomy job is hard to land without experience, even with a certificate.', src: ['r-phleb1', 'r-phleb2', 'r-phleb3', 'r-phleb4'], firstHand: true },
  { text: 'Retail pharmacies are busy and short-staffed, and techs move to hospital or mail-order work for better conditions or pay.', src: ['r-pharm1', 'r-pharm2', 'r-pharm3'], firstHand: true },
  { text: 'Private ambulance companies can start EMTs at low pay.', src: ['r-emslv', 'r-emsnyc'], firstHand: true },
  { text: 'People who pass the CRCST exam before finding a job struggle to find a department that will take them for the 400 hours; others are hired untrained and certify after.', src: ['r-spd1', 'r-spd2', 'r-spd3', 'r-spd4', 'r-spdhired', 'hspa-crcst'], firstHand: true },
]

// 6. Moving up: nursing and the other next steps (BLS May 2025).
export const nursing = { text: 'Nursing is a next step, not a first one: LPN and RN both need a state-approved program and a licensing exam, so they are not on this page\'s list.', src: ['bls-lpn', 'bls-rn'] }
export const ladder = [
  { from: 'CNA or patient care tech', next: 'LPN / LVN', takes: 'A state-approved program, typically about 1 year, and a licensing exam', median: '$64,400', src: ['bls-lpn'] },
  { from: 'CNA, patient care tech or medical assistant', next: 'Registered nurse', takes: 'A nursing degree: the BLS says both ADN and BSN programs typically take about 4 years; then a licensing exam', median: '$97,550', src: ['bls-rn'] },
  { from: 'EMT', next: 'Paramedic', takes: 'An accredited paramedic program, usually after working as an EMT', median: '$60,600', src: ['onet-paramedic', 'bls-emt', 'nremt-para'] },
  { from: 'Pharmacy technician', next: 'Pharmacist', takes: 'At least 2 years of college courses, then a PharmD (usually 4 years) and two licensing exams', median: '$140,910', src: ['bls-pharmacist'] },
]
export const ladderNote = { text: 'Medians are national yearly pay for May 2025.', src: ['bls-lpn', 'onet-paramedic'] }

// 7. Common mistakes. `lead` is the mistake in a few words; `text` the detail.
export const mistakes = [
  { lead: 'Paying for CNA training a nursing home would cover.', text: 'If a nursing home hires you or offers you the job before class starts, it cannot charge you. Ask local nursing homes before you pay a school.', src: ['cfr-483-152'] },
  { lead: 'An online-only CNA course.', text: 'Federal rules require at least 16 hours of supervised practical training, so a course with no hands-on hours cannot qualify. Texas allows its 60 classroom hours online; its 40 clinical hours are in person.', src: ['cfr-483-152', 'tx-556'] },
  { lead: 'A phlebotomy course with no live draws.', text: 'NHA\'s CPT needs 30 blood draws and 10 finger sticks on live people; California programs require 50 draws and 10 skin punctures.', src: ['nha-cpt', 'ca-phleb'] },
  { lead: 'A medical assistant program that is not accredited.', text: 'Only a CAAHEP- or ABHES-accredited program, or an approved apprenticeship, qualifies you for the CMA (AAMA). NHA\'s CCMA also accepts a year of supervised work.', src: ['aama', 'nha-ccma'] },
  { lead: 'An expensive pharmacy tech school.', text: 'In California, PTCB or ExCPT certification alone qualifies you; Texas lets you work as a trainee while you study; Walgreens pays for its trainees\' PTCB training and exam.', src: ['ca-pharm', 'tx-pharm', 'walgreens'] },
  { lead: 'Taking the CRCST exam before you have a job.', text: 'Certification needs 400 hours in a sterile processing department. A paid trainee job builds the hours; studying alone does not.', src: ['hspa-crcst', 'vumc'] },
  { lead: 'A paramedic program that is not accredited.', text: 'Since 2013 NREMT has required paramedic candidates to graduate from a CAAHEP-accredited program, or one with a Letter of Review.', src: ['nremt-para'] },
]
export const forProfit = { text: 'A 2018 study by the Center for Responsible Lending found that 83% of for-profit healthcare support programs failed a debt-to-earnings test, against 11% of public programs. Compare a community college\'s price first.', src: ['crl-2018', 'pima'] }

// FAQ — visible on the page and mirrored in FAQPage JSON-LD.
export const faq = [
  {
    q: 'How long does it take to become a CNA?',
    a: { text: 'The federal minimum is 75 hours of training, including at least 16 hours of supervised practical work, then a state exam. Many states require more: Texas requires 100 hours.', src: ['cfr-483-152', 'tx-556'] },
  },
  {
    q: 'Can I get CNA training for free?',
    a: { text: 'Yes, through a nursing home. A Medicare or Medicaid nursing home that employs you, or has offered you a job, before training starts cannot charge you for any part of it, books included.', src: ['cfr-483-152', 'cms-careers'] },
  },
  {
    q: 'Which of these jobs pays the most?',
    a: { text: 'Nationally in May 2025, sterile processing techs had the highest median at $47,700 a year and home health and personal care aides the lowest at $35,800. All of them are below $50,980, the median for all jobs in the country.', src: ['onet-spd-wage', 'bls-hha', 'bls-home'] },
  },
  {
    q: 'Do medical assistants need to be certified?',
    a: { text: 'Usually not by law: the BLS says most states do not require it. Many employers prefer a CCMA, CMA (AAMA) or RMA, and some require one.', src: ['bls-ma'] },
  },
  {
    q: 'Do I need a license to be an EMT?',
    a: { text: 'Yes. Every state requires EMTs to be licensed after a state-approved course, and most use the NREMT exam, which costs $104 a try.', src: ['bls-emt', 'nremt-emt'] },
  },
  {
    q: 'Can I become a pharmacy tech without school?',
    a: { text: 'Often. The BLS says the usual path is a high school diploma and on-the-job training, and Walgreens and CVS run paid trainee programs. Rules vary by state: Texas registers trainees, and California accepts PTCB or ExCPT certification.', src: ['bls-pharm', 'walgreens', 'cvs-instore', 'tx-pharm', 'ca-pharm'] },
  },
]

// ── Listings: the filters on the "Hiring now" block (lib/start/listingFilters.js) ──────────────────────────────────
// Each job × level is its own search (CNA + Trainee → "cna trainee"); rows are kept only when the title names that job,
// and the level is read from the title. A plain "CNA", "EMT" or "Pharmacy Technician" title is a trained, certified or
// licensed job (federal and state rules), so "Trainee / no certificate yet" needs a beginner word (trainee,
// apprentice, entry), the listing's own "Entry level" or a paid-training flag. Look-alikes stay out: CNA the insurer,
// CMA the accountant, PCT the patent treaty, DSP the engineer, and every licensed or degree title (RN, LPN, nurse
// practitioner, physician assistant, pharmacist, therapist). "All jobs" runs one search per job and deals the rows out
// job by job, two per employer before a third. Patterns avoid lookaheads (the wording test reads every string here).
const byLevel = (any, entry, experienced) => {
  const all = (first) => [...new Set([...first, ...any, ...entry, ...experienced])]
  return { any: all(any), entry: all(entry), experienced: all(experienced) }
}
export const listings = {
  defaultRadius: '50',
  radii: ['25', '50', '100', '250'],
  levelMode: 'entryNeedsMarker',
  levelLabels: { any: 'Any level', entry: 'Trainee / no certificate yet', experienced: 'Certified / experienced' },
  levelWords: { entry: 'trainee and entry-level', experienced: 'certified and experienced' },
  exclude: '\\b(instructors?|educators?|faculty|professor|teacher|recruiter|sales|account executive|underwrit\\w*|insurance|claims|actuar\\w*|accountants?|accounting|patent|attorney|paralegal|veterinar\\w*|vet tech|animal|dental|billing|coders?|coding|scribe|receptionist|engineers?|developer|police|registered nurse|rn|bsn|lpn|lvn|licensed practical|licensed vocational|nurse practitioner|physician assistant|pa-c|pharmacist|pharmd|therapist|medication aide|med aide|medication tech\\w*|child ?care|nanny|babysitter|pet)\\b',
  positions: [
    {
      id: 'all', label: 'All jobs', noun: 'healthcare', mix: 'positions',
      queries: {
        any: ['cna', 'phlebotomist', 'medical assistant', 'pharmacy technician', 'emt', 'patient care technician', 'home health aide', 'sterile processing technician'],
        entry: ['cna trainee', 'pharmacy technician trainee', 'medical assistant apprentice', 'sterile processing trainee', 'caregiver'],
        experienced: ['certified nursing assistant', 'phlebotomist', 'certified medical assistant', 'certified pharmacy technician', 'emt', 'patient care technician', 'certified home health aide', 'sterile processing technician'],
      },
    },
    { id: 'cna', label: 'CNA', noun: 'CNA', match: '\\bcnas?\\b|c\\.n\\.a|nurs(?:e|es|ing)\'?s? (?:aide|assistant)|\\bstna\\b|\\blna\\b|\\bgna\\b|nurse aide', queries: byLevel(['cna', 'nursing assistant'], ['cna trainee', 'nurse aide trainee'], ['certified nursing assistant']) },
    { id: 'phlebotomist', label: 'Phlebotomist', noun: 'phlebotomist', match: 'phlebotom|\\bphleb\\b|patient service tech|mobile examiner', queries: byLevel(['phlebotomist'], ['phlebotomy trainee'], ['phlebotomist']) },
    { id: 'medical-assistant', label: 'Medical assistant', noun: 'medical assistant', match: 'medical assistant|\\bccma\\b|\\brma\\b|clinical assistant|ophthalmic assistant|optometric assistant', queries: byLevel(['medical assistant'], ['medical assistant apprentice', 'medical assistant trainee'], ['certified medical assistant']) },
    { id: 'pharmacy-tech', label: 'Pharmacy tech', noun: 'pharmacy tech', match: 'pharm(?:acy)?\\.? tech|\\bcpht\\b', queries: byLevel(['pharmacy technician'], ['pharmacy technician trainee'], ['certified pharmacy technician']) },
    { id: 'emt', label: 'EMT', noun: 'EMT', match: '\\bemt(?:-?b|-basic)?\\b|\\baemt\\b|emergency medical tech|ambulance (?:driver|attendant)', queries: byLevel(['emt'], ['emt trainee'], ['emt', 'emergency medical technician']) },
    { id: 'patient-care-tech', label: 'Patient care tech', noun: 'patient care tech', match: 'patient care (?:tech|assistant|associate)|\\bpct\\b', queries: byLevel(['patient care technician'], ['patient care technician trainee'], ['patient care technician']) },
    { id: 'home-health-aide', label: 'Home health aide', noun: 'home health aide', match: 'home health aide|\\bc?hha\\b|home care aide|hospice aide|personal care (?:aide|assistant|attendant)|caregiver', queries: byLevel(['home health aide', 'caregiver'], ['caregiver'], ['certified home health aide']) },
    { id: 'sterile-processing', label: 'Sterile processing', noun: 'sterile processing', match: 'sterile (?:processing|tech)|\\bspd tech|central (?:sterile|service) tech|central sterile|\\bcrcst\\b|decontamination tech', queries: byLevel(['sterile processing technician'], ['sterile processing trainee'], ['sterile processing technician']) },
  ],
}

// ── The page's openable rows ──────────────────────────────────────────────────────────────────────────────────────
export const menu = [
  {
    id: 'by-job', title: 'Job by job', summary: 'The way in, how long it takes, median pay',
    blocks: [
      { type: 'text', plain: 'Tap a job for the way in and where to apply.' },
      { type: 'tradeRows', items: jobRows },
      { type: 'note', entry: jobNote },
      { type: 'more', title: 'Hourly pay, low to high', blocks: [
        { type: 'table', caption: 'Hourly pay for each job, national', columns: [{ key: 'job', label: 'Job' }, { key: 'median', label: 'Median, hourly', num: true }, { key: 'range', label: 'Low to high', num: true }], rows: payRows },
        { type: 'text', entry: payNote },
        { type: 'text', entries: growth },
      ] },
    ],
  },
  {
    id: 'cna', title: 'Becoming a CNA', summary: 'Training hours, the state exam, who pays',
    blocks: [
      { type: 'checklist', items: cna.items, cols: true },
      { type: 'callout', entry: cna.free },
      { type: 'text', entry: cna.refund },
      { type: 'more', title: 'How states differ', blocks: [{ type: 'notes', items: cna.states }] },
    ],
  },
  {
    id: 'paid-training', title: 'Who pays for training', summary: 'Employers and free programs that train you',
    blocks: [
      { type: 'cards', items: employers.map((e) => ({ name: e.name, body: e, chips: [e.chip] })) },
      { type: 'callout', entry: caveatLine },
      { type: 'heading', text: 'Free programs' },
      { type: 'cards', items: freeHelp.map((f) => ({ name: f.name, body: f, link: f.url })) },
      { type: 'more', title: 'If you pay for a CNA course yourself', blocks: [{ type: 'notes', items: selfPay }] },
    ],
  },
  {
    id: 'licenses', title: 'Licenses and certifications', summary: 'What the law requires, what employers ask',
    blocks: [
      { type: 'checklist', items: law, cols: true },
      { type: 'more', title: 'National certifications: what each one takes', blocks: [
        { type: 'table', caption: 'National certifications for each job', columns: [{ key: 'cert', label: 'Certification' }, { key: 'body', label: 'From' }, { key: 'takes', label: 'What it takes' }, { key: 'fee', label: 'Fee or renewal' }], rows: certRows },
      ] },
      { type: 'resumeLink', before: 'Before you apply, you can', label: 'check your résumé against a posting' },
    ],
  },
  {
    id: 'hard-parts', title: 'The hard parts', summary: 'Pay, shifts, injuries, background checks',
    blocks: [
      { type: 'callout', entry: pay },
      { type: 'notes', label: 'Shifts', items: shifts },
      { type: 'notes', label: 'Injuries', items: injuries },
      { type: 'notes', label: 'Background checks', items: checks },
      { type: 'notes', label: 'Health checks', items: health },
      { type: 'more', title: 'What people in these jobs say', blocks: [
        { type: 'text', plain: 'Several accounts agree on each of these.' },
        { type: 'notes', items: peopleSay },
      ] },
    ],
  },
  {
    id: 'moving-up', title: 'Moving up', summary: 'Where nursing fits, and the next license',
    blocks: [
      { type: 'text', entry: nursing },
      { type: 'table', caption: 'The next step from each job and what it pays', columns: [{ key: 'from', label: 'From' }, { key: 'next', label: 'Next step' }, { key: 'takes', label: 'What it takes' }, { key: 'median', label: 'Median a year', num: true }], rows: ladder },
      { type: 'note', entry: ladderNote },
    ],
  },
  {
    id: 'watch-out', title: 'Watch out', icon: 'caution', summary: 'Courses that do not qualify you',
    blocks: [
      { type: 'disclosures', items: mistakes },
      { type: 'text', entry: forProfit },
    ],
  },
  { id: 'questions', title: 'Common questions', summary: 'CNA training, pay, licenses', blocks: [{ type: 'faq', items: faq }] },
]

// ── Additional resources: every reference above, as plain grouped links ──────────────────────────────────────────
export const resourcesSummary = 'Training rules, certifications, pay data'
export const resources = [
  { title: 'Training rules', items: [
    { key: 'cfr-483-152', name: 'Nurse aide training requirements (42 CFR 483.152)' },
    { key: 'cfr-483-35', name: 'Nurse aides in nursing homes and the registry (42 CFR 483.35)' },
    { key: 'cfr-484-80', name: 'Home health aide training (42 CFR 484.80)' },
    { key: 'cms-careers', name: 'Nursing home careers (Centers for Medicare & Medicaid Services)' },
    { key: 'tx-556', name: 'Texas nurse aide training rules' },
    { key: 'fl-464', name: 'Florida CNA certification law' },
    { key: 'ca-phleb', name: 'California phlebotomy training programs' },
    { key: 'tx-pharm', name: 'Texas pharmacy technician trainee registration' },
    { key: 'ca-pharm', name: 'California pharmacy technician application' },
    { key: 'ny-spd', name: 'New York central service technician law' },
    { key: 'mn-spd', name: 'Minnesota sterile processing certification (HSPA)' },
  ] },
  { title: 'Certifications', items: [
    { key: 'nha-cpt', name: 'Phlebotomy technician certification (NHA)' },
    { key: 'nha-ccma', name: 'Clinical medical assistant certification (NHA)' },
    { key: 'aama', name: 'CMA (AAMA) eligibility' },
    { key: 'ptcb', name: 'Certified pharmacy technician (PTCB)' },
    { key: 'nha-excpt', name: 'Pharmacy technician certification (NHA)' },
    { key: 'nha-cpct', name: 'Patient care technician certification (NHA)' },
    { key: 'nremt-emt', name: 'EMT certification (National Registry of EMTs)' },
    { key: 'nremt-para', name: 'Paramedic program accreditation (National Registry of EMTs)' },
    { key: 'hspa-crcst', name: 'Sterile processing certification, CRCST (HSPA)' },
  ] },
  { title: 'Employers that train', items: [
    { key: 'walgreens', name: 'Walgreens pharmacy technician training' },
    { key: 'ptcb-walgreens', name: 'Walgreens employer profile (PTCB)' },
    { key: 'cvs-instore', name: 'CVS Health in-store and pharmacy jobs' },
    { key: 'cvs-apprentice', name: 'CVS Health apprenticeships' },
    { key: 'vumc', name: 'Vanderbilt University Medical Center sterile processing program' },
    { key: 'uwhealth', name: 'UW Health medical assistant apprenticeship' },
    { key: 'centralhealth', name: 'Central Health medical assistant apprenticeship' },
    { key: 'amazon-cc1', name: 'Amazon Career Choice training programs' },
    { key: 'amazon-cc2', name: 'Amazon Career Choice certifications' },
  ] },
  { title: 'Free programs and costs', items: [
    { key: 'dol-tegl', name: 'WIOA training accounts (U.S. Department of Labor)' },
    { key: 'careeronestop', name: 'CareerOneStop: training and American Job Centers' },
    { key: 'jobcorps', name: 'Job Corps' },
    { key: 'redcross', name: 'Red Cross nurse assistant training' },
    { key: 'pima', name: 'Pima Community College nursing assistant costs' },
    { key: 'laketech', name: 'Lake Technical College nursing assistant costs' },
    { key: 'crl-2018', name: 'For-profit healthcare support programs (Center for Responsible Lending)' },
  ] },
  { title: 'Background checks and health rules', items: [
    { key: 'cfr-483-12', name: 'Who a nursing home must not employ (42 CFR 483.12)' },
    { key: 'oig-auth', name: 'Federal health program exclusions (HHS OIG)' },
    { key: 'oig-leie', name: 'List of Excluded Individuals/Entities (HHS OIG)' },
    { key: 'osha-bbp', name: 'Hepatitis B vaccination at work (OSHA)' },
    { key: 'cdc-vax', name: 'Vaccines for healthcare workers (CDC)' },
    { key: 'cdc-tb', name: 'TB screening for health care workers (CDC)' },
  ] },
  { title: 'Pay data', items: [
    { key: 'bls-home', name: 'Healthcare occupations (Bureau of Labor Statistics)' },
    { key: 'bls-cna', name: 'Nursing assistants and orderlies' },
    { key: 'bls-phleb', name: 'Phlebotomists' },
    { key: 'bls-ma', name: 'Medical assistants' },
    { key: 'bls-pharm', name: 'Pharmacy technicians' },
    { key: 'bls-emt', name: 'EMTs and paramedics' },
    { key: 'bls-hha', name: 'Home health and personal care aides' },
    { key: 'bls-lpn', name: 'Licensed practical and vocational nurses' },
    { key: 'bls-rn', name: 'Registered nurses' },
    { key: 'bls-pharmacist', name: 'Pharmacists' },
    { key: 'onet-cna', name: 'Nursing assistant wages (O*NET)' },
    { key: 'onet-phleb', name: 'Phlebotomist wages (O*NET)' },
    { key: 'onet-ma', name: 'Medical assistant wages (O*NET)' },
    { key: 'onet-pharm', name: 'Pharmacy technician wages (O*NET)' },
    { key: 'onet-emt', name: 'EMT wages (O*NET)' },
    { key: 'onet-hha', name: 'Home health aide wages (O*NET)' },
    { key: 'onet-spd-wage', name: 'Sterile processing wages (O*NET)' },
    { key: 'onet-spd', name: 'Sterile processing jobs and openings (O*NET)' },
    { key: 'onet-orderly', name: 'Orderlies and patient care techs (O*NET)' },
    { key: 'onet-paramedic', name: 'Paramedic wages (O*NET)' },
  ] },
  { title: 'Community discussions', items: [
    { key: 'r-cna36', name: 'A CNA shift with too many residents' },
    { key: 'r-cna13', name: 'Changing residents on a short shift' },
    { key: 'r-cnaleave', name: 'Thinking about leaving CNA work' },
    { key: 'r-cnapay', name: 'Why CNA pay is low' },
    { key: 'r-cnaca', name: 'CNA starting pay in California' },
    { key: 'r-cnaback', name: 'Protecting your back as a CNA' },
    { key: 'r-cnafree', name: 'Leaving CNA work after an injury' },
    { key: 'r-cnaburnout', name: 'Avoiding burnout in a first CNA job' },
    { key: 'r-malow', name: 'Medical assistant pay' },
    { key: 'r-maraise', name: 'Living on a medical assistant\'s pay' },
    { key: 'r-maroi', name: 'Why people became medical assistants' },
    { key: 'r-phleb1', name: 'Finding a first phlebotomy job' },
    { key: 'r-phleb2', name: 'How hard phlebotomy jobs are to find' },
    { key: 'r-phleb3', name: 'A year without a phlebotomy job' },
    { key: 'r-phleb4', name: 'After phlebotomy training' },
    { key: 'r-pharm1', name: 'Working in chain retail pharmacies' },
    { key: 'r-pharm2', name: 'Why techs leave retail pharmacy' },
    { key: 'r-pharm3', name: 'A pharmacy tech moving to mail order' },
    { key: 'r-emslv', name: 'Private ambulance pay in Las Vegas' },
    { key: 'r-emsnyc', name: 'Working EMS in New York City' },
    { key: 'r-spd1', name: 'Certified but short of the CRCST hours' },
    { key: 'r-spd2', name: 'Finding a sterile processing job' },
    { key: 'r-spd3', name: 'Provisional CRCST and the hours' },
    { key: 'r-spd4', name: 'How to get the CRCST hours' },
    { key: 'r-spdhired', name: 'Hired into sterile processing untrained' },
  ] },
]

/** Every fact on the page, in reading order: the hero, then each menu row. */
export function pageEntries() {
  return [guide.answer, ...tiles, ...blockEntries(menu)]
}
