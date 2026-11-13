// Does a posting say it takes and trains people with no experience? ONE definition, read by:
//   • the listing level (lib/server/jobSources.js listingLevel): a posting that trains beginners is 'Entry level'
//     even when its title says nothing about level ("Floorhand - Oklahoma", "Roustabout Hand");
//   • the search row's `trains_beginners` flag (api/jobs.js) — the data behind a quiet "Paid training" note;
//   • the matched-jobs reader (lib/server/jobKeys.js saysEntryLevel → postingSaysEntryLevel), which adds "entry level".
//
// The phrases are the ones real entry postings use (research 2026-11-13, oilfield + trades postings read in full):
// "This is an entry-level job that provides initial introductory training and substantial on-the-job training"
// (Patterson-UTI floorhand), "Oilfield experience preferred but not required" (a Midland roustabout ad),
// "…outdoor labor experience is helpful but not required" (a roustabout/laborer ad), "Paid Training" (a diesel
// apprentice title), "no experience necessary", "will train", "apprenticeship program", "green hands welcome".
//
// Precision rules, each from a sentence that would otherwise read wrong:
//   • "will train" is a training OFFER only with an object that is the applicant ("will train you", "will train the
//     right candidate", "Will train.") — never "You will train new associates" / "will train and develop the team",
//     which is a duty of the job, usually a lead's.
//   • "provides training" needs the employer (or the job) as its subject and an adjective that makes it an offer
//     ("a job that provides initial introductory training", "we provide full training") — a duty line "Provides
//     training to new employees" / "provide hands-on training for new installation crews" is not.
//   • a bare "no experience" counts only as the offer ("no experience required/needed/necessary", "No experience?
//     No problem") — never "candidates with no experience will not be considered".

const OFFERS = [
  // no experience asked
  /\bno (?:prior |previous |oilfield |industry |related |work |professional )?experience (?:is |was )?(?:required|necessary|needed)\b/i,
  /\bno experience\s*(?:\?|,|!|-|–|—)?\s*no problem\b/i,
  /\bno (?:prior |previous )?experience(?: at all)?\s*\?/i,
  /\bno experience at all\b/i,
  // the employer trains
  /(?<!\byou )(?<!\bwho )\bwill train (?:you|the right|qualified|motivated|dependable|from scratch|beginners|green)\b/i,
  /\bwill train\s*[.!]/i,
  /\bwe(?:'ll|’ll| will)? train (?:you|the right|qualified|motivated|beginners|from scratch|green)\b/i,
  /\b(?:willing|happy|ready) to train (?:the right|you|qualified|motivated|new|green)\b/i,
  /\b(?:company[- ]paid|paid|free|sponsored) cdl training\b/i,
  /\b(?:full|on[- ]the[- ]job|comprehensive|initial|introductory) training (?:is |will be )?(?:provided|offered|included)\b/i,
  /\b(?:we|that|which|program|position|role|job|company)\s+(?:will\s+)?provides?\s+(?:initial |full |all |comprehensive )?(?:introductory|paid|on[- ]the[- ]job|full) training\b/i,
  /\bwe provide (?:all |full |paid )(?:necessary |required )?training\b/i,
  /\bearn while you learn\b/i,
  /\bgreen (?:hands?|hats?) (?:are )?(?:welcome|wanted|encouraged|accepted)\b/i,
];
// "…experience preferred but not required" counts only as the job's WHOLE experience ask: a general experience
// ("Oilfield experience preferred but not required", "Previous security experience preferred, but not required" — real
// entry ads), never experience "as a" named role, and never when the posting states years of experience anywhere
// ("Property management experience is a plus but not required" beside "2+ years of HVAC experience").
const OPTIONAL_EXPERIENCE_RE = /\bexperience\b(?:(?!\bas an?\b)[^.;\n]){0,80}\b(?:preferred|helpful|a plus),? but not (?:required|necessary|mandatory)\b/i;
const N = '(?:\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)';
const YEARS_ASKED_RE = new RegExp(`\\b${N}\\+?\\s*(?:(?:-|to|or)\\s*${N}\\s*)?(?:years?|yrs?)\\b[^.\\n]{0,50}\\bexperience|\\bexperience\\b[^.\\n]{0,30}\\b${N}\\+?\\s*(?:years?|yrs?)\\b`, 'i');
// "apprenticeship program" is an offer ("Earn while you learn in our apprenticeship program", "P.I.P.E. Apprenticeship
// Program") — but not a requirement to have finished one ("Completion of a recognized pipefitter apprenticeship
// program", "certification from a recognized DOL apprenticeship program").
const APPRENTICESHIP_RE = /\bapprenticeship program\b/gi;
const FINISHED_ONE_RE = /\b(?:complet\w*|graduat\w*|certif\w*|finish\w*|journey\w*|recogni[sz]ed|accredited|approved)\b[^\n]{0,60}$/i;
function offersApprenticeship(s) {
  for (const m of s.matchAll(APPRENTICESHIP_RE)) {
    if (!FINISHED_ONE_RE.test(s.slice(Math.max(0, m.index - 80), m.index))) return true;
  }
  return false;
}

// "Paid training" / "training provided" are a beginner's training ("Paid training from day one", "Optometric Technician
// - Training Provided!", the "Diesel Technician Apprentice-Paid Training" title) — except in a benefits line about
// professional growth: "Paid training and certifications, tuition reimbursement", "company paid training and tuition
// reimbursement", "Education and training provided with monetary incentives" (production rows, 2026-11-13).
const PLAIN_TRAINING_RE = /\b(?:paid training|training provided)\b/gi;
const PERK_NEAR_RE = /\b(?:tuition|reimburse\w*|certifications?|cpe|continuing education|professional (?:growth|development)|career development|education and|company[- ]paid|conferences?)\b/i;
function plainTrainingOffer(s) {
  for (const m of s.matchAll(PLAIN_TRAINING_RE)) {
    const near = s.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    if (!PERK_NEAR_RE.test(near)) return true;
  }
  return false;
}

/** The posting's text (title + description) says the employer takes and trains people with no experience. */
export function trainsBeginners(text) {
  const s = String(text || '');
  if (!s) return false;
  if (OFFERS.some((re) => re.test(s))) return true;
  if (plainTrainingOffer(s)) return true;
  if (OPTIONAL_EXPERIENCE_RE.test(s) && !YEARS_ASKED_RE.test(s)) return true;
  return offersApprenticeship(s);
}

// A title that names a rung above a beginner, a job that teaches/runs the work, or a licensed profession never reads as
// a beginner job whatever its posting says: "Electrical Apprenticeship Instructor" mentions the apprenticeship program
// it teaches; "Floorhand (Experienced)", "Mechanic II", "Lead Welder" postings still say "paid training"; a home-health
// "Registered Nurse" posting's "Paid training from day one" and an "Internal Medicine Physician"'s "full training
// provided" are an orientation for licensed people (production rows, 2026-11-13).
const NOT_BEGINNER_TITLE_RE = /\b(?:instructor|teacher|trainer|professor|faculty|manager|director|supervisor|superintendent|foreman|engineer|journeyman|journey[- ]?level|master|experienced|senior|sr|lead(?! generat)|principal|staff|ii|iii|iv|level [2-9]|physician|doctor|md|psychiatrist|psychologist|psychotherapist|therapist|pathologist|slp|nurse|rn|lvn|lpn|np|practitioner|pharmacist|dietitian|dentist|hygienist|attorney|counsel|lawyer|accountant|cpa|scientist|architect)\b/i;

/** A listing { title, description } offers to train beginners — the flag a search row carries. */
export function listingTrainsBeginners(job) {
  const title = String(job?.title || '');
  if (NOT_BEGINNER_TITLE_RE.test(title)) return false;
  return trainsBeginners(`${title}\n${job?.description || ''}`);
}

/** Entry level by the posting's own words — what jobKeys.saysEntryLevel reads: "entry level" / "entry-level" anywhere
 *  in the title or posting, or the listing's training offer above (same title rules). */
export function postingSaysEntryLevel(job) {
  if (/\bentry[- ]level\b/i.test(`${job?.title || ''} ${job?.description || ''}`)) return true;
  return listingTrainsBeginners(job);
}
