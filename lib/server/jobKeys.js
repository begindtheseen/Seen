// Job keys — the per-person matching profile behind "Matched to your résumé" (the /jobs rail) and the
// matched-jobs emails (owner request 2026-11-10: "Each user should have a db table column that is filled
// with job keys related to their resume specifically … pull from her resume and from her recently applied
// to jobs. And every time she updates her resume it should change her user db keys.").
//
// Why this exists (verified 2026-11-10, report: scratchpad/director/reports/m-matched.md): a job-match email
// sent "Account Manager (LA Metro)" at GSG Protective Services to a person whose résumé listed an Account
// Manager job. The title phrase matched; nothing read the posting, which asks for "a Security Officer
// License", "registration as a security guard" and "two (2) years of supervisory experience within the
// security industry". She has never worked security.
//
// The rule now (matchListing — the ONE rule, used by the rail and the emails):
//   1. The listing's OCCUPATION (from its title; a title that does not say the field — "Team Member",
//      "Shift Lead" — is placed by its description) is one the person HELD (a résumé role), or a close
//      neighbour of one (cashier ↔ retail sales associate), or one they APPLIED to in the last 60 days,
//      or the field of a degree they hold / are studying (internships and entry-level only).
//   2. Every REQUIRED minimum of years the posting states is met by the person's years in THAT field
//      ("2 years of supervisory experience within the security industry" = management AND security).
//      A shortfall of at most 1 year is allowed only when they have at least half. Zero years in the
//      field + a stated minimum ≥ 1 year is never a match.
//   3. Every licence the posting REQUIRES (guard card, CDL, RN, LPN, CNA, clearance, …) is on the résumé
//      or implied by a role that cannot be held without it.
//   4. LEVEL: at most one step above the highest level they held in that field; manager titles need
//      people-management on the résumé; internships only for students and recent graduates.
//   5. PLACE and LIVENESS are checked by the caller's read (lib/server/resumeMatches.js) with placeMatch.
//   Every match carries a `reason` built from the keys ("You were a Cashier at Fry's Food Stores
//   (2019–2023)."). No reason → no match. No padding, ever.
//
// The keys object (profiles.job_keys, migration 20261110120000_profiles_job_keys.sql) is small, versioned
// and deterministic; every occupation in it points at the résumé role(s), degree or application that put
// it there. It is rebuilt on every résumé write and application change (rebuildJobKeys), and the readers
// re-derive it in memory whenever it is missing, of an old version, or built from different résumé text
// or applications (keysStale) — so a missed hook can never leave stale keys in use. Before the migration
// the column does not exist: keys are derived in memory every time (hasJobKeysColumn probes once).

import { createHash } from 'node:crypto';
import { parseResume } from '../resume/parse/index.js';
import { extractEmployment } from './resumeAnalysis.js';
import { extractJobFacts } from '../optimizer/extractJobFacts.js';
import { locationScope } from '../jobs/usLocation.js';
import { isDescriptionPreview } from '../jobs/descriptionText.js';
import { escapeRegExp } from '../text/escapeRegExp.js';
import { specialisationsOf } from './resumeJobMatch.js';
import { postingField, roleField, fieldLabel, areAdjacent, FIELDS as SHARED_FIELDS } from '../optimizer/fieldMatch.js';
import { runOptimizer } from '../optimizer/index.js';
import { occupationOf as onetOf, relation as onetRelation, militaryOccupation, looksMilitary } from '../occupations/index.js';

export const JOB_KEYS_VERSION = 9;
export const APPLIED_DAYS = 60;

// ── Occupations ────────────────────────────────────────────────────────────────────────────────
// Finer than roleOntology's 20 families on purpose: "nurse recruiter" is a recruiter, "electrical engineer"
// is not an electrician, "customer success" is not customer service, "security engineer" is not a guard.
// Order matters: the first rule whose pattern is in the (normalized) title wins. Each entry:
//   id, label (as a person says it), family (roleOntology-style), re (title pattern),
//   adj (close neighbours: years there count here), lic (a licence the title itself requires),
//   q (title words to read listings with), remote (a field that is commonly remote).
const O = (id, label, family, re, extra = {}) => ({ id, label, family, re, adj: [], lic: null, q: null, remote: false, ...extra });
export const OCCUPATIONS = [
  // Not a field of their own: AI-training / survey gigs, recruiters of any field, trainers of any field.
  O('ai_training', 'AI training work', 'other', /\b(ai trainer|ai training|survey participants?|research participants?|annotation|audio tasks|content reviewer)\b/),
  O('recruiter', 'recruiter', 'hr', /\b(recruiter|recruiting|recruitment|talent acquisition|sourcer|talent partner)\b/, { adj: ['hr_generalist'], q: ['recruiter', 'recruiting'], remote: true }),
  O('personal_trainer', 'personal trainer', 'fitness', /\b(personal trainer|fitness (coach|instructor)|pilates instructor|yoga instructor|group fitness)\b/, { q: ['personal trainer', 'fitness'] }),
  O('teaching_assistant', 'teaching assistant', 'education', /\b(teaching assistant|paraprofessional|para educator|teacher aide|teacher s aide)\b/, { adj: ['tutor'], q: ['teaching assistant', 'paraprofessional'] }),
  O('school_admin', 'school administrator', 'education', /\b(assistant principal|vice principal|school principal|principal(?= *($|of\b|elementary|middle|high|school|charter|k ?8|k ?12))|dean of (students|academics|instruction)|curriculum director|director of (elementary|secondary|curriculum|instruction|education|teaching and learning)|superintendent of schools|assistant superintendent|head of school|education program manager|(associate |assistant )?dean\b|provost|academic affairs|registrar)\b/, { adj: ['instructional_designer'], q: ['principal', 'assistant principal', 'curriculum director', 'director of education'], remote: true }),
  O('instructional_designer', 'instructional designer', 'education', /\b(instructional design\w*|curriculum (developer|designer|writer|specialist)|learning (experience )?designer|e ?learning (developer|designer))\b/, { q: ['instructional designer', 'curriculum'], remote: true }),
  O('instructor', 'teacher', 'education', /\b(instructor|teacher|professor|lecturer|faculty|department chair|chair of (the )?\w+ department)\b/, { q: ['teacher', 'instructor'] }),
  O('tutor', 'tutor', 'education', /\b(tutor|academic coach|mentor)\b/, { adj: [], q: ['tutor'] }),
  O('childcare', 'childcare worker', 'education', /\b(nanny|babysit\w*|child ?care|daycare|preschool aide)\b/, { q: ['childcare', 'nanny'] }),

  // Security: guards are not security engineers.
  O('security_engineer', 'security engineer', 'software_engineering', /\b(security (engineer|architect|technologist)|cyber ?security|application security|product security|appsec|ciso|information security officer|soc analyst|grc analyst|penetration tester)\b/, { adj: ['security_analyst'], q: ['security engineer', 'cybersecurity'], remote: true }),
  O('security_analyst', 'security analyst', 'it', /\b(security analyst|industrial security|information security|cyber analyst)\b/, { adj: ['security_engineer'], q: ['security analyst'], remote: true }),
  O('loss_prevention', 'loss prevention', 'security', /\b(loss prevention|asset protection)\b/, { adj: ['security_officer'], q: ['loss prevention', 'asset protection'] }),
  O('security_officer', 'security officer', 'security', /\b(security (officer|guard|host|hostess|supervisor|field supervisor|patrol|monitor|agent)|security\b(?!.*\b(engineer|architect|analyst|developer|software)\b)|guard|patrol officer|armed officer|unarmed officer)\b/, { adj: ['loss_prevention'], lic: 'guard_card', q: ['security officer', 'security guard'] }),

  // Healthcare (licensed roles never borrow years from each other).
  O('nurse_practitioner', 'nurse practitioner', 'clinical', /\b(nurse practitioner|np\b|pmhnp|fnp|crna|nurse anesthetist|physician assistant)\b/, { lic: 'np', q: ['nurse practitioner'] }),
  O('registered_nurse', 'registered nurse', 'clinical', /^(?!.*\b(lpn|lvn|licensed (practical|vocational))\b).*\b(registered nurse|rn\b|rns\b|nurse (navigator|manager|supervisor|educator|case manager)|charge nurse|nursing supervisor|staff nurse|travel nurse|new nurse graduate)\b/, { lic: 'rn', q: ['registered nurse', 'rn'], remote: true }),
  O('lpn', 'licensed practical nurse', 'clinical', /\b(lpn|lvn|licensed (practical|vocational) nurse|licensed nurse)\b/, { lic: 'lpn', q: ['lpn', 'lvn'] }),
  O('cna', 'nursing assistant', 'healthcare_support', /\b(cna|lna|certified nursing assistant|nursing assistant|nurse aide|nursing attendant|patient care (assistant|technician|tech)|pct)\b/, { adj: ['caregiver'], lic: 'cna', q: ['nursing assistant', 'cna', 'patient care'] }),
  O('caregiver', 'caregiver', 'healthcare_support', /\b(caregiver|care giver|home health aide|chha|hha|personal care (aide|assistant|attendant)|direct support professional|dsp|companion|in home care|resident assistant)\b/, { adj: ['cna'], q: ['caregiver', 'home health aide', 'direct support'] }),
  O('medical_assistant', 'medical assistant', 'healthcare_support', /\b(medical assistant|clinical assistant)\b/, { adj: [], q: ['medical assistant'] }),
  O('phlebotomist', 'phlebotomist', 'healthcare_support', /\b(phlebotom\w*)\b/, { adj: ['lab_assistant', 'cna'], q: ['phlebotomist'] }),
  O('lab_assistant', 'laboratory assistant', 'healthcare_support', /\b(laborator(y|ies) assistant|lab assistant|specimen (processor|processing|accessioner|collector)|accessioner|lab(oratory)? (processor|aide|support (associate|technician))|plasma (center )?(technician|tech|processor)|donor (care )?(technician|specialist)|medical laboratory assistant)\b/, { adj: ['phlebotomist'], q: ['laboratory assistant', 'lab assistant', 'specimen processor', 'plasma'] }),
  O('pharmacy_tech', 'pharmacy technician', 'healthcare_support', /\b(pharmacy (technician|tech))\b/, { lic: 'pharmacy_tech', q: ['pharmacy technician'], remote: true }),
  O('pharmacist', 'pharmacist', 'clinical', /\b(pharmacist)\b/, { lic: 'pharmacist', q: ['pharmacist'] }),
  O('dental_hygienist', 'dental hygienist', 'clinical', /\b(dental hygienist|hygienist|rdh)\b/, { lic: 'rdh', q: ['hygienist', 'dental hygienist'] }),
  O('dental_assistant', 'dental assistant', 'healthcare_support', /\b(dental assistant)\b/, { q: ['dental assistant'] }),
  O('medical_billing', 'medical billing', 'healthcare_support', /\b(medical (billing|coding|biller|coder)|billing (specialist|coordinator|representative)|coding specialist|patient (account|accounts|financial) (representative|specialist|services)|insurance (verification|authorization)|prior authorization|revenue cycle|claims (specialist|processor|representative))\b/, { adj: ['medical_receptionist'], q: ['billing', 'coding', 'patient account', 'insurance verification', 'prior authorization', 'revenue cycle'], remote: true }),
  O('vet_tech', 'veterinary technician', 'healthcare_support', /\b(veterinary (technician|tech|assistant)|vet tech)\b/, { q: ['veterinary technician'] }),
  O('behavior_tech', 'behavior technician', 'healthcare_support', /\b(behavior (technician|tech|interventionist)|rbt|autism support|aba therapist)\b/, { q: ['behavior technician', 'rbt'] }),
  O('therapist_rehab', 'therapist', 'clinical', /\b(physical therapist|physical therapy assistant|occupational therapist|speech (language )?(pathologist|therapist)|rehabilitation therapist|pta\b|cota\b|respiratory therapist)\b/, { lic: 'therapy', q: ['physical therapist', 'occupational therapist'] }),
  O('counselor', 'counselor', 'social_services', /\b((?<!massage )therapist|counselor|counsellor|social worker|lcsw|lmsw|lmft|lpc|psychologist|bcba|behavior analyst)\b/, { lic: 'counseling', q: ['counselor', 'social worker'] }),
  O('physician', 'physician', 'clinical', /\b(physician|doctor|surgeon|dentist|endodontist|optometrist|veterinarian|hospitalist)\b/, { lic: 'md', q: ['physician'] }),
  O('med_tech', 'medical technologist', 'clinical', /\b(radiologic technologist|surgical (tech|technologist)|or tech|sterile processing|lab(oratory)? technician|medical technologist|optometric technician|ophthalmic technician|ekg tech|emt|paramedic)\b/, { q: ['technologist'] }),
  O('medical_receptionist', 'medical receptionist', 'administrative', /\b(medical receptionist|front desk (medical|clinic)|patient (access|registration|coordinator)|unit secretary|health info\w* (svc|services)? ?technician|medical records)\b/, { adj: ['receptionist'], q: ['medical receptionist', 'patient access'] }),
  O('records_clerk', 'records clerk', 'administrative', /\b(records (custodian|clerk|specialist|technician|coordinator|assistant|analyst|management|manager)|court clerk|clerk of (the )?(circuit )?courts?|deputy (court )?clerk|public records|file clerk|document (control|imaging) (clerk|specialist))\b/, { adj: ['admin_assistant', 'legal_assistant'], q: ['records clerk', 'records', 'court clerk', 'deputy clerk'], remote: true }),

  // Engineering and technology (before trades: an electrical engineer is not an electrician).
  O('food_safety', 'food safety and quality', 'manufacturing', /\b(food safety( (and|&) quality( assurance)?)?|food quality|fsqa|food (safety )?auditor|qa (technician|tech|inspector|coordinator)|quality assurance (technician|tech|specialist|coordinator|auditor|supervisor|inspector)|haccp (coordinator|manager|specialist)|sanitation (supervisor|manager|coordinator|lead))\b/, { adj: ['quality_inspector'], q: ['food safety', 'quality assurance', 'qa technician', 'haccp'], remote: true }),
  O('electrical_engineer', 'electrical engineer', 'engineering', /\b(electrical engineer\w*|electronics engineer|asic|fpga|analog (design|engineer)|power electronics|rf engineer|controls engineer|hardware engineer|serdes|soc architect|digital design engineer|design verification)\b/, { q: ['electrical engineer', 'hardware engineer'] }),
  O('mechanical_engineer', 'mechanical engineer', 'engineering', /\b(mechanical (design )?engineer\w*|mechanical engineering|propulsion|turbomachinery|aerospace engineer|structures engineer|structural engineer\w*|thermal engineer)\b/, { q: ['mechanical engineer'] }),
  O('civil_engineer', 'civil engineer', 'engineering', /\b(civil (engineer|designer|project)|project civil|water ?\/? ?wastewater|geotechnical|transportation engineer)\b/, { q: ['civil engineer'] }),
  O('manufacturing_engineer', 'manufacturing engineer', 'engineering', /\b((manufacturing|process|quality|industrial|tooling|welding|production|reliability|supplier (development|quality)|test|product|msat|facilities|commissioning|controls|automation) engineer\w*)\b/, { q: ['manufacturing engineer', 'process engineer'] }),
  O('data_scientist', 'data scientist', 'data_analytics', /\b(data scientist|machine learning (scientist|engineer|researcher)|ml engineer|research scientist|deep learning|applied scientist|ai (engineer|researcher)|quantitative researcher)\b/, { adj: ['data_engineer'], q: ['data scientist', 'machine learning'], remote: true }),
  O('data_engineer', 'data engineer', 'data_analytics', /\b(data engineer|analytics engineer|etl developer|data platform)\b/, { adj: ['software_engineer', 'data_scientist'], q: ['data engineer'], remote: true }),
  O('data_analyst', 'data analyst', 'data_analytics', /\b(data analyst|business (intelligence|data) analyst|reporting analyst|bi analyst|analytics (analyst|specialist)|marketing data analyst)\b/, { q: ['data analyst'], remote: true }),
  O('research_assistant', 'research assistant', 'data_analytics', /\b(research (assistant|associate|technician|coordinator|aide)|undergraduate researcher|student researcher)\b/, { adj: ['data_analyst', 'data_scientist'], q: ['research assistant', 'research associate'], remote: false }),
  O('qa_engineer', 'QA engineer', 'software_engineering', /\b(qa (engineer|analyst|lead|tester|principal|technical lead)|quality assurance (engineer|analyst)|sdet|software (development )?engineer in test|test automation|software tester)\b/, { adj: ['software_engineer'], q: ['qa engineer'], remote: true }),
  O('sre', 'site reliability / DevOps engineer', 'software_engineering', /\b(site reliability|sre|devops|platform engineer|infrastructure engineer|cloud engineer|hpc cloud)\b/, { adj: ['software_engineer'], q: ['devops', 'site reliability'], remote: true }),
  O('software_engineer', 'software engineer', 'software_engineering', /\b(software (engineer|engineering|developer|development engineer)|developer|(?<!(cnc|alarm|plc|robot|nc) )programmer|(back|front)[ -]?end (engineer|developer)|full[ -]?stack|web developer|mobile (engineer|developer)|ios (engineer|developer)|android (engineer|developer)|golang engineer|engineer.*\b(backend|frontend|platform|payments|api)\b|forward deployed engineer|software architect|tech lead)\b/, { adj: ['qa_engineer', 'sre', 'data_engineer'], q: ['software engineer', 'developer'], remote: true }),
  O('it_support', 'IT support', 'it', /\b(it (support|specialist|technician|engineer|analyst)|help ?desk|service desk|desktop support|technical support (specialist|technician)|computer technician|endpoint engineer)\b/, { adj: ['network_admin'], q: ['it support', 'help desk', 'it specialist'], remote: true }),
  O('network_admin', 'network / systems administrator', 'it', /\b(network (engineer|administrator|technician)|system(s)? administrator|sysadmin|unified communications)\b/, { adj: ['it_support'], q: ['network engineer', 'systems administrator'] }),
  O('product_manager', 'product manager', 'product', /\b(product (manager|owner|lead)|technical product (manager|lead))\b/, { q: ['product manager'], remote: true }),
  O('project_manager', 'project manager', 'project_management', /\b(project (manager|coordinator|lead)|program (manager|coordinator)|scrum master|technical program manager|pmo)\b/, { q: ['project manager', 'project coordinator'], remote: true }),
  O('designer', 'designer', 'design', /\b(graphic designer|visual designer|product designer|ux|ui designer|web designer|interior designer|cadd? (specialist|designer|drafter)|drafter|level designer|motion designer)\b/, { q: ['designer'], remote: true }),

  // Skilled trades and production.
  O('electrician', 'electrician', 'skilled_trades', /\b(electrician|electrician helper|electrical (journeyman|apprentice|installer|lead installer|technician|test technician|helper|foreman)|mechatronics technician|installation technician helper|journeyman (electrician|service driver|wireman)|wireman|electrical lead)\b/, { lic: null, q: ['electrician', 'electrical'] }),
  O('hvac_tech', 'HVAC technician', 'skilled_trades', /\b(hvac|refrigeration tech\w*|heating and air)\b/, { adj: ['maintenance_tech'], q: ['hvac'] }),
  O('plumber', 'plumber', 'skilled_trades', /\b(plumber|plumbing|pipefitter|pipe fitter|backflow|sprinkler (fitter|construction|installer)|fire sprinkler|utility pipe layer|pipe layer)\b/, { adj: ['maintenance_tech'], q: ['plumber', 'pipefitter', 'backflow', 'plumbing'] }),
  O('welder', 'welder', 'skilled_trades', /\b(welder|welding (tech|operator)|fabricator)\b/, { q: ['welder'] }),
  O('carpenter', 'carpenter', 'skilled_trades', /\b(carpenter|framer|framing|cabinet maker)\b/, { q: ['carpenter'] }),
  O('aircraft_mechanic', 'aircraft mechanic', 'skilled_trades', /\b(a ?& ?p (mechanic|technician)|airframe (and|&) powerplant|aircraft (maintenance )?(mechanic|technician)|aviation (maintenance )?(mechanic|technician)|aircraft inspector|avionics technician)\b/, { lic: 'faa_ap', q: ['aircraft mechanic', 'a&p', 'aviation maintenance'] }),
  O('auto_mechanic', 'automotive technician', 'skilled_trades', /\b(auto(motive)? (technician|mechanic|tech)|diesel (technician|mechanic)|mechanic|express service technician|lube tech|tire tech|fleet technician|oil (change|sales and service))\b/, { adj: [], q: ['automotive technician', 'mechanic'] }),
  O('maintenance_tech', 'maintenance technician', 'skilled_trades', /\b(maintenance (technician|tech|mechanic|team member|worker|level|associate)(?!.*\bplumbing\b)|industrial (mechanic|maintenance)|facilities technician|equipment maintenance|maintainer|building engineer)\b/, { adj: ['hvac_tech'], q: ['maintenance technician', 'maintenance mechanic'] }),
  O('machinist', 'machinist', 'skilled_trades', /\b(machinist|cnc (programmer|operator|machinist)|tool technician|tool and die)\b/, { adj: [], q: ['machinist', 'cnc'] }),
  O('installer', 'installer', 'skilled_trades', /\b(installer|installation (technician|specialist|tech)|telematics|cable technician|field service technician)\b/, { q: ['installer', 'installation technician'] }),
  O('quality_inspector', 'quality inspector', 'manufacturing', /\b(quality (inspector|control inspector|technician|auditor)|qc (inspector|technician)|inspector)\b/, { adj: ['production_associate'], q: ['quality inspector', 'qc inspector'] }),
  O('production_associate', 'production associate', 'manufacturing', /\b(production (associate|worker|operator|technician|team member|services associate|supervisor|lead)|line lead|manufacturing (associate|technician|operator)|assembler|assembly (technician|associate|worker)|machine operator|set ?up operator|line worker|factory worker|motor test technician|test technician|integration,? and test technician|engineering technician)\b/, { adj: ['quality_inspector'], q: ['production associate', 'manufacturing associate', 'assembler'] }),
  O('construction_laborer', 'construction worker', 'skilled_trades', /\b(construction (laborer|worker|helper)|general laborer|laborer|stagehand|crew chief|demolition|concrete)\b/, { q: ['construction laborer', 'laborer'] }),

  // Drivers.
  O('valet', 'valet', 'valet_parking', /\b(valet|parking (attendant|lot attendant|cashier)|parker)\b/, { q: ['valet', 'parking attendant'] }),
  O('truck_driver_cdl', 'CDL truck driver', 'delivery_logistics', /\b(driver trainer|driving instructor|motor transport operator|88m|transportation supervisor|(?<!non )cdl|truck driver|tractor trailer|class a (driver|company driver)|otr driver|regional driver|tanker driver|hazmat driver)\b/, { adj: ['delivery_driver'], lic: 'cdl', q: ['cdl', 'truck driver'] }),
  O('delivery_driver', 'delivery driver', 'delivery_logistics', /\b(delivery (driver|associate)|courier|driver|route (driver|sales)|box truck)\b(?!.*(?<!non )\bcdl\b)/, { adj: ['truck_driver_cdl'], q: ['delivery driver', 'driver', 'courier'] }),

  // Warehouse / logistics / operations.
  O('warehouse_associate', 'warehouse associate', 'warehouse', /\b(warehouse|process assistant|material handler|picker|packer|order (picker|selector|filler)|forklift|shipping (and|&) receiving|receiving (clerk|associate)|fulfillment (associate|center)|distribution (associate|center|&|and)|loader|unloader|package handler|yard (technician|jockey|associate|driver))\b/, { adj: ['inventory_specialist', 'production_associate'], q: ['warehouse', 'material handler', 'forklift', 'process assistant'] }),
  O('inventory_specialist', 'inventory specialist', 'warehouse', /\b(inventory (specialist|control|clerk|associate|analyst|coordinator)|materials coordinator|property ?\/? ?logistics specialist|logistics specialist|supply technician|storekeeper|supply (specialist|sergeant|clerk|technician)|unit supply|92y|ls[1-3]\b|lsc\b)\b/, { adj: ['warehouse_associate'], q: ['inventory specialist', 'inventory control'] }),
  O('logistics_coordinator', 'logistics coordinator', 'operations', /\b(logistics (coordinator|manager|analyst|partner)|supply chain|dispatcher|dispatch|production planner|buyer|purchasing|procurement|sourcing)\b/, { adj: [], q: ['logistics coordinator', 'supply chain'] }),
  O('operations', 'operations', 'operations', /\b((?<!people )operations (manager|associate|coordinator|lead|specialist|supervisor|analyst|director)|business operations|ops (manager|lead|associate)|area operations|director of (facility )?operations)\b/, { adj: [], q: ['operations manager', 'operations coordinator', 'operations associate'] }),

  // Food and hospitality.
  O('restaurant_manager', 'restaurant front-of-house manager', 'food_service', /\b(front of (the )?house|foh (manager|lead|supervisor|director)|restaurant (general )?manager|dining room (manager|supervisor|captain)|maitre d|food (and|&) beverage (manager|director|supervisor)|f ?& ?b (manager|director|supervisor)|banquet (manager|captain)|beverage (manager|director)|hospitality manager)\b/, { adj: ['server', 'host', 'bartender', 'food_crew'], q: ['front of house', 'restaurant manager', 'food and beverage', 'dining room manager'] }),
  O('barista', 'barista', 'food_service', /\b(barista|coffee)\b/, { adj: ['food_crew'], q: ['barista'] }),
  O('cook', 'cook', 'food_service', /\b(cook|chef|line cook|prep cook|chef de partie|sous chef|grill (master|cook)|kitchen (staff|team member|associate|manager|lead|supervisor)|culinary|pizza maker|baker)\b/, { adj: ['food_crew'], q: ['cook', 'line cook', 'prep cook'] }),
  O('server', 'server', 'food_service', /\b(server|waiter|waitress|food runner|busser|banquet server)\b/, { adj: ['host', 'bartender'], q: ['server'] }),
  O('bartender', 'bartender', 'food_service', /\b(bartender|barback)\b/, { adj: ['server'], q: ['bartender'] }),
  O('host', 'host', 'food_service', /\b(host|hostess|greeter)\b/, { adj: ['server'], q: ['host'] }),
  O('dishwasher', 'dishwasher', 'food_service', /\b(dishwasher|dish washer|steward)\b/, { adj: ['food_crew'], q: ['dishwasher'] }),
  O('food_crew', 'restaurant crew', 'food_service', /\b(crew member|crew|team member|food service (worker|associate)|fast food|counter (attendant|associate)|cafeteria|concessions)\b/, { adj: ['barista', 'cook', 'dishwasher'], q: ['crew member', 'team member'], needsCue: true }),
  O('hotel_front_desk', 'hotel front desk agent', 'hospitality', /\b(front desk (agent|associate|clerk)|desk clerk|guest service(s)? (agent|associate|staff)|night auditor|concierge|reservation(s)? (agent|coordinator))\b/, { adj: ['receptionist'], q: ['front desk', 'guest services'] }),
  O('housekeeper', 'housekeeper', 'hospitality', /\b(housekeep\w*|room attendant|janitor|custodian|cleaner|cleaning|lobby attendant|environmental services|evs|trash collector|porter)\b/, { q: ['housekeeper', 'custodian', 'janitor'] }),
  O('event_staff', 'event staff', 'hospitality', /\b(event (staff|supervisor|coordinator|associate)|banquet|usher|ticket taker|pool monitor|lifeguard|stage manager|light (and|&) sound)\b/, { q: ['event staff'] }),

  // Retail.
  O('cashier', 'cashier', 'retail', /\b(cashier|checker|front end (associate|cashier))\b/, { adj: ['retail_associate', 'grocery_clerk'], q: ['cashier'] }),
  O('grocery_clerk', 'grocery clerk', 'retail', /\b(deli|(bakery|grocery|produce|stock) clerk|grocery|produce associate|meat cutter)\b/, { adj: ['cashier', 'retail_associate'], q: ['deli', 'grocery clerk'] }),
  O('retail_associate', 'retail associate', 'retail', /\b(retail (sales )?(associate|representative|consultant|team member|worker)|sales associate|store associate|sales floor|merchandiser|visual (lead|merchandiser)|stock associate|stocker|key ?holder|keyholder|retail|store (manager|lead|supervisor)|assistant store manager|kids (&|and) teens manager|team store)\b/, { adj: ['cashier', 'grocery_clerk'], q: ['sales associate', 'retail associate', 'store associate', 'keyholder'] }),

  // Office, customer service, finance, legal, sales, marketing, HR.
  // A trainer of people at work (a call-center trainer, a corporate trainer, L&D) — after the food and retail
  // rules, so "Barista Trainer" stays a barista job.
  O('corporate_trainer', 'trainer', 'training', /\b(corporate trainer|call center trainer|customer service trainer|technical trainer|sales trainer|software trainer|training (specialist|coordinator|manager|facilitator|lead|associate)|learning (and|&) development|learning specialist|onboarding (specialist|trainer)|facilitator|trainer)\b/, { q: ['trainer', 'training specialist'], remote: true }),
  // Sales jobs that are not closing jobs: deal desk / sales & revenue operations / enablement, and pre-sales
  // engineering. A closer is never matched to them unless they held or applied to one.
  O('sales_operations', 'sales operations', 'sales', /\b(deal desk|sales operations|sales ops|revenue operations|rev ?ops|revenue order|sales enablement|revenue enablement|enablement (manager|specialist|lead)|sales performance management|order management|sales strategy|go to market operations|gtm operations)\b/, { adj: [], q: ['deal desk', 'sales operations', 'revenue operations', 'enablement'], remote: true }),
  O('sales_engineer', 'sales engineer', 'sales', /\b(sales engineer\w*|solutions engineer\w*|solutions consultant|pre ?sales|sales solutions engineering|solutions architect)\b/, { adj: [], q: ['sales engineer', 'solutions engineer', 'solutions consultant'], remote: true }),
  O('customer_success', 'customer success', 'sales', /\b(customer success|client success|client partner|account management specialist)\b/, { adj: [], q: ['customer success'], remote: true }),
  O('customer_service', 'customer service', 'customer_service', /\b(customer service|customer care|customer support|call center|contact center|customer experience (coordinator|associate|representative|specialist)|client care|patient care advocate|support (specialist|representative|agent)|care expert|service representative|member services)\b/, { adj: [], q: ['customer service', 'call center', 'customer support'], remote: true }),
  O('receptionist', 'receptionist', 'administrative', /\b(receptionist|front desk|front office)\b/, { adj: ['admin_assistant', 'medical_receptionist', 'hotel_front_desk'], q: ['receptionist', 'front desk'] }),
  O('legal_assistant', 'legal assistant', 'legal', /\b(paralegal|docket\w*|calendar(ing)? (clerk|specialist)|court filing|legal (records|clerk)|legal (assistant|secretary|administrative assistant)|litigation (assistant|secretary)|presuit secretary|law clerk|trademark paralegal)\b/, { adj: ['admin_assistant'], q: ['paralegal', 'legal assistant'] }),
  O('attorney', 'attorney', 'legal', /\b(attorney|lawyer|counsel)\b/, { lic: 'bar', q: ['attorney'] }),
  O('office_manager', 'office manager', 'administrative', /\b(office (services |operations )?manager|legal office manager|workplace (experience |services )?manager|office (and|&) facilities manager)\b/, { adj: ['admin_assistant', 'operations'], q: ['office manager', 'workplace manager', 'operations manager'] }),
  O('admin_assistant', 'administrative assistant', 'administrative', /\b(administrative (assistant|coordinator|specialist|associate)|admin assistant|office (assistant|administrator|coordinator|clerk)|executive assistant|secretary|data entry|clerical|intake (specialist|coordinator)|personal assistant)\b/, { adj: ['receptionist', 'legal_assistant', 'medical_receptionist', 'records_clerk'], q: ['administrative assistant', 'office assistant', 'executive assistant'], remote: true }),
  O('hr_generalist', 'HR', 'hr', /\b(human resources?|hr (coordinator|generalist|assistant|specialist|manager|director|business partner)|people (operations|ops|partner|systems)|benefits (specialist|coordinator)|payroll (specialist|coordinator|administrator))\b/, { adj: ['recruiter'], q: ['human resources', 'hr coordinator'], remote: true }),
  O('accountant', 'accountant', 'finance_accounting', /\b(accountant|accounting|bookkeeper|accounts (payable|receivable)|controller|auditor|audit (associate|assistant|staff|intern|senior)|assurance (associate|staff)|tax (preparer|associate)|cpa|consolidations)\b/, { q: ['accountant', 'bookkeeper', 'accounts payable'], remote: true }),
  O('financial_analyst', 'financial analyst', 'finance_accounting', /\b(financial analyst|fp ?& ?a|finance (manager|analyst|director)|investment (operations|analyst)|portfolio (manager|specialist)|credit (analyst|officer|review)|underwriter|risk analyst|asset manager|director, finance|vice president, finance|program controller)\b/, { q: ['financial analyst'], remote: true }),
  O('bank_teller', 'banking', 'finance_accounting', /\b(teller|relationship banker|personal banker|universal banker|banker|(assistant )?branch (manager|operations manager|service manager|supervisor)|branch operations|loan (processor|officer)|financial (solutions|services) (advisor|representative)|card services)\b/, { q: ['bank teller', 'personal banker'] }),
  O('insurance_agent', 'insurance agent', 'sales', /\b(insurance (agent|representative|sales|customer service|recovery|producer|sales producer)|(sales|lines|licensed|insurance) producer|state farm|claims (adjuster|representative))\b/, { q: ['insurance agent', 'insurance', 'producer'], remote: true }),
  O('real_estate_agent', 'real estate agent', 'sales', /\b(real estate|realtor|leasing (agent|consultant)|property (manager|coordinator))\b/, { q: ['real estate agent', 'leasing'] }),
  O('marketing', 'marketing', 'marketing', /\b(marketing|social media|content (creator|strategist|writer|manager)|seo|copywriter|brand (manager|associate|ambassador)|communications (specialist|coordinator|manager)|paid media|growth|user acquisition|ecommerce|e commerce|public relations)\b/, { q: ['marketing', 'social media'], remote: true }),
  O('sdr', 'sales development representative', 'sales', /\b(sales development|business development (representative|rep)|sdr|bdr|lead generat\w*)\b/, { adj: ['sales_rep', 'account_executive'], q: ['sales development', 'business development representative'], remote: true }),
  O('account_executive', 'account executive', 'sales', /\b(account executive|enterprise sales|account sales executive)\b/, { adj: ['sales_rep', 'sdr'], q: ['account executive'], remote: true }),
  O('account_manager', 'account manager', 'sales', /\b(account manager|key account|client manager|relationship manager|business development (manager|lead|director)|partner account|national sales account|commissioning client manager)\b/, { adj: ['sales_rep'], q: ['account manager'], remote: true }),
  O('sales_rep', 'sales representative', 'sales', /\b(sales (representative|rep|consultant|agent|specialist|executive|manager|director)|territory (manager|representative|sales|account manager)|field sales|inside sales|outside sales|specialty representative|development representative|medical science liaison|membership (specialist|advisor|sales))\b/, { adj: ['account_executive', 'sdr', 'account_manager'], q: ['sales representative', 'inside sales', 'territory'], remote: true }),

  // Personal services.
  O('groomer', 'pet groomer', 'personal_services', /\b(groomer|grooming|kennel|dog walker|pet care)\b/, { q: ['groomer'] }),
  // Each beauty trade is its own licence: a cosmetologist is not an esthetician, a barber or a nail technician.
  O('esthetician', 'esthetician', 'personal_services', /\b(esthetician|aesthetician|skin care specialist|skincare specialist|facialist|lash (artist|technician)|waxing specialist)\b/, { lic: 'esthetician', q: ['esthetician', 'skin care'] }),
  O('barber', 'barber', 'personal_services', /\b(barber|master barber)\b/, { lic: 'barber', q: ['barber'] }),
  O('nail_tech', 'nail technician', 'personal_services', /\b(nail (tech\w*|artist|specialist)|manicurist|pedicurist)\b/, { lic: 'nail_tech', q: ['nail technician', 'manicurist'] }),
  O('massage_therapist', 'massage therapist', 'personal_services', /\b(massage therapist|lmt|licensed massage)\b/, { lic: 'massage', q: ['massage therapist'] }),
  O('cosmetologist', 'cosmetologist', 'personal_services', /\b(cosmetolog\w*|hair stylist|hairstylist|stylist|colorist|haircolorist|salon (stylist|artist)|stretch practi\w*)\b/, { lic: 'cosmetology', q: ['stylist'] }),
  O('interpreter', 'interpreter', 'other', /\b(interpreter|translator)\b/, { q: ['interpreter'] }),
];
const OCC_BY_ID = new Map(OCCUPATIONS.map((o) => [o.id, o]));

// ── The occupation knowledge base (lib/occupations, O*NET) ─────────────────────────────────────
// O*NET-SOC code (detailed 'XX-XXXX', or the full 'XX-XXXX.XX' where O*NET splits one) → the job type this file
// already knows (its licences, read words, ladders). A code with no job type here becomes a job type of its own
// ('soc:<code>'), placed in a family by its SOC major group; neighbours between coded job types come from
// relation(). Codes several of this file's job types share (HR specialists = HR + recruiting) map to the wider one.
const SOC_OCC = {
  '29-12': 'physician', '25-1': 'instructor', '25-20': 'instructor', '25-3031': 'instructor', '25-3021': 'instructor', '39-9031': 'personal_trainer', '25-9042': 'teaching_assistant', '25-9043': 'teaching_assistant', '25-9044': 'teaching_assistant',
  '11-9032': 'school_admin', '11-9033': 'school_admin', '11-9031': 'school_admin', '25-9031': 'instructional_designer', '25-3041': 'tutor',
  '39-9011': 'childcare', '15-1299.05': 'security_engineer', '15-1212': 'security_analyst', '33-9099.02': 'loss_prevention', '33-9032': 'security_officer',
  '29-1171': 'nurse_practitioner', '29-1151': 'nurse_practitioner', '29-1071': 'nurse_practitioner', '29-1141': 'registered_nurse', '29-2061': 'lpn',
  '31-1131': 'cna', '31-1132': 'cna', '31-1121': 'caregiver', '31-1122': 'caregiver', '31-9092': 'medical_assistant', '31-9097': 'phlebotomist',
  '29-2052': 'pharmacy_tech', '29-1051': 'pharmacist', '29-1292': 'dental_hygienist', '31-9091': 'dental_assistant', '43-3021': 'medical_billing',
  '29-2072': 'medical_billing', '29-2056': 'vet_tech', '31-9096': 'vet_tech', '29-2053': 'behavior_tech', '29-1123': 'therapist_rehab', '29-1122': 'therapist_rehab',
  '29-1127': 'therapist_rehab', '29-1126': 'therapist_rehab', '31-2021': 'therapist_rehab', '31-2011': 'therapist_rehab', '21-1011': 'counselor', '21-1012': 'counselor',
  '21-1013': 'counselor', '21-1014': 'counselor', '21-1015': 'counselor', '21-1018': 'counselor', '21-1019': 'counselor', '21-1021': 'counselor', '21-1022': 'counselor', '21-1023': 'counselor',
  '19-3033': 'counselor', '19-3034': 'counselor', '29-1021': 'physician', '29-1041': 'physician', '29-1131': 'physician',
  '29-2011': 'med_tech', '29-2012': 'med_tech', '29-2034': 'med_tech', '29-2055': 'med_tech', '29-2042': 'med_tech', '29-2043': 'med_tech', '31-9093': 'med_tech', '29-2031': 'med_tech', '29-2032': 'med_tech',
  '43-6013': 'medical_receptionist', '43-4071': 'records_clerk', '43-4031': 'records_clerk', '19-4099.01': 'food_safety', '19-4013': 'food_safety',
  '17-2071': 'electrical_engineer', '17-2072': 'electrical_engineer', '17-2061': 'electrical_engineer', '17-2141': 'mechanical_engineer', '17-2011': 'mechanical_engineer',
  '17-2051': 'civil_engineer', '17-2112': 'manufacturing_engineer', '17-2199': 'manufacturing_engineer', '15-2051.00': 'data_scientist', '15-1243': 'data_engineer', '15-1242': 'data_engineer',
  '15-2051.01': 'data_analyst', '15-2041': 'data_analyst', '19-4061': 'research_assistant', '15-1253': 'qa_engineer', '15-1252': 'software_engineer', '15-1254': 'software_engineer',
  '15-1232': 'it_support', '15-1231': 'it_support', '15-1244': 'network_admin', '15-1241': 'network_admin', '13-1082': 'project_manager', '15-1299.09': 'project_manager',
  '27-1024': 'designer', '15-1255': 'designer', '27-1025': 'designer', '47-2111': 'electrician', '47-3013': 'electrician', '49-9021': 'hvac_tech', '47-2152': 'plumber', '47-3015': 'plumber',
  '51-4121': 'welder', '47-2031': 'carpenter', '47-3012': 'carpenter', '49-3023': 'auto_mechanic', '49-3031': 'auto_mechanic', '49-3093': 'auto_mechanic', '49-3042': 'auto_mechanic',
  '49-9071': 'maintenance_tech', '49-9041': 'maintenance_tech', '49-9043': 'maintenance_tech', '51-4041': 'machinist', '51-4011': 'machinist', '51-9161': 'machinist',
  '49-2022': 'installer', '49-2098': 'installer', '49-9052': 'installer', '51-9061': 'quality_inspector', '51-2092': 'production_associate', '51-2023': 'production_associate',
  '51-2028': 'production_associate', '51-2031': 'production_associate', '51-2041': 'production_associate', '51-2051': 'production_associate', '51-2061': 'production_associate',
  '51-2090': 'production_associate', '51-9198': 'production_associate', '51-1011': 'production_associate', '47-2061': 'construction_laborer', '47-3019': 'construction_laborer',
  '53-6021': 'valet', '53-3032': 'truck_driver_cdl', '53-3033': 'delivery_driver', '43-5021': 'delivery_driver', '53-3031': 'delivery_driver',
  '53-7062': 'warehouse_associate', '53-7065': 'warehouse_associate', '53-7051': 'warehouse_associate', '53-1042': 'warehouse_associate', '53-7064': 'warehouse_associate',
  '43-5111': 'inventory_specialist', '43-5071': 'inventory_specialist', '43-5081': 'inventory_specialist', '43-5011': 'logistics_coordinator', '13-1081': 'logistics_coordinator',
  '43-5032': 'logistics_coordinator', '13-1023': 'logistics_coordinator', '11-1021': 'operations', '11-9051': 'restaurant_manager', '35-3023.01': 'barista',
  '35-2014': 'cook', '35-2012': 'cook', '35-2015': 'cook', '35-2019': 'cook', '35-1011': 'cook', '35-2021': 'food_crew', '35-2011': 'food_crew', '35-3023.00': 'food_crew', '35-1012': 'food_crew',
  '35-3031': 'server', '35-9011': 'server', '35-3011': 'bartender', '35-9031': 'host', '35-9021': 'dishwasher', '43-4081': 'hotel_front_desk',
  '37-2011': 'housekeeper', '37-2012': 'housekeeper', '37-1011': 'housekeeper', '39-3031': 'event_staff', '33-9092': 'event_staff', '13-1121': 'event_staff',
  '41-2011': 'cashier', '41-2031': 'retail_associate', '41-1011': 'retail_associate', '41-2021': 'retail_associate', '13-1151': 'corporate_trainer', '41-9031': 'sales_engineer',
  '43-4051': 'customer_service', '43-4171': 'receptionist', '23-2011': 'legal_assistant', '43-6012': 'legal_assistant', '23-1011': 'attorney',
  '43-1011': 'office_manager', '11-3012': 'office_manager', '43-6014': 'admin_assistant', '43-6011': 'admin_assistant', '43-9061': 'admin_assistant', '43-9021': 'admin_assistant',
  '13-1071': 'hr_generalist', '13-1141': 'hr_generalist', '11-3121': 'hr_generalist', '43-4161': 'hr_generalist', '43-3051': 'hr_generalist',
  '13-2011': 'accountant', '43-3031': 'accountant', '13-2082': 'accountant', '11-3031.01': 'accountant', '13-2051': 'financial_analyst', '13-2041': 'financial_analyst', '13-2053': 'financial_analyst',
  '43-3071': 'bank_teller', '43-4141': 'bank_teller', '13-2072': 'bank_teller', '43-4131': 'bank_teller', '11-3031.00': 'bank_teller',
  '41-3021': 'insurance_agent', '13-1031': 'insurance_agent', '41-9022': 'real_estate_agent', '41-9021': 'real_estate_agent', '11-9141': 'real_estate_agent',
  '13-1161': 'marketing', '27-3031': 'marketing', '11-2032': 'marketing', '41-3091': 'sales_rep', '41-4011': 'sales_rep', '41-4012': 'sales_rep', '11-2022': 'sales_rep',
  '39-2021': 'groomer', '39-5012': 'cosmetologist', '39-5011': 'cosmetologist', '39-5092': 'cosmetologist', '39-5094': 'cosmetologist', '31-9011': 'cosmetologist', '27-3091': 'interpreter',
};
const SOC_FAMILY = { 11: 'operations', 13: 'finance_accounting', 15: 'software_engineering', 17: 'engineering', 19: 'other', 21: 'social_services', 23: 'legal', 25: 'education', 27: 'marketing', 29: 'clinical', 31: 'healthcare_support', 33: 'security', 35: 'food_service', 37: 'hospitality', 39: 'personal_services', 41: 'sales', 43: 'administrative', 45: 'other', 47: 'skilled_trades', 49: 'skilled_trades', 51: 'manufacturing', 53: 'delivery_logistics', 55: 'other' };
const OCC_SOC = new Map();
for (const [code, id] of Object.entries(SOC_OCC)) if (!OCC_SOC.has(id)) OCC_SOC.set(id, code.length === 7 ? `${code}.00` : code);
// most specific first: the full code, the detailed code, the broad group ('25-20…'), the minor group ('25-1…')
const socOccId = (code) => { const c = String(code); return SOC_OCC[c] || SOC_OCC[c.slice(0, 7)] || SOC_OCC[c.slice(0, 5)] || SOC_OCC[c.slice(0, 4)] || null; };
const _socOccs = new Map();
function socOccupation(code, title) {
  if (_socOccs.has(code)) return _socOccs.get(code);
  const o = { id: `soc:${code}`, label: String(title || code).toLowerCase(), family: SOC_FAMILY[Number(String(code).slice(0, 2))] || 'other', re: /(?!)/, adj: [], lic: null, q: null, remote: false, soc: code, fieldKey: `soc:${String(code).slice(0, 7)}` };
  _socOccs.set(code, o); OCC_BY_ID.set(o.id, o);
  return o;
}
/** The table's job type is a finer reading of the same occupation (a recruiter inside O*NET's HR specialists, an SRE
 * inside software developers): its neighbours include the knowledge base's answer, or the other way round. */
function finerThan(own, kb) {
  if (!own || !kb || own === kb) return false;
  return (own.adj || []).includes(kb.id) || (kb.adj || []).includes(own.id);
}
/** The O*NET code of a job type ('soc:…' ids carry theirs; table job types their first crosswalk code). */
export function socOf(id) { const s = String(id || ''); return s.startsWith('soc:') ? s.slice(4) : (OCC_SOC.get(s) || null); }
/**
 * The knowledge base's reading of a title, by its trust contract: military first; `exact` and `close` only (a
 * `guess` is never a basis); null = unknown.
 * @returns {{ occ: object, code: string, confidence: 'exact'|'close', ambiguous: boolean } | null}
 */
const _modMemo = new Map();
export function moduleOccupation(title, { lines = [], employer = '' } = {}) {
  const mk = `${title}\u0001${employer}\u0001${(lines || []).join('\u0002').slice(0, 400)}`;
  if (_modMemo.has(mk)) return _modMemo.get(mk);
  const out = moduleOccupationRaw(title, { lines, employer });
  if (_modMemo.size > 5000) _modMemo.clear();
  _modMemo.set(mk, out);
  return out;
}
function moduleOccupationRaw(title, { lines = [], employer = '' } = {}) {
  let r = null;
  try {
    if (looksMilitary(`${title} ${employer}`)) {
      const m = militaryOccupation(`${title} ${employer}`);
      if (m && m.occupations && m.occupations.length && m.confidence !== 'guess') r = { code: m.occupations[0].code, title: m.occupations[0].title, confidence: 'close', ambiguous: false };
    }
    if (!r) r = onetOf(String(title || ''), { lines, employer });
  } catch { r = null; }
  // an ambiguous filing (several occupations claim the title equally) is not a placement
  if (!r || (r.confidence !== 'exact' && r.confidence !== 'close') || r.ambiguous) return null;
  const id = socOccId(r.code);
  const occ = id ? OCC_BY_ID.get(id) : socOccupation(r.code, r.title);
  return occ ? { occ, code: r.code, confidence: r.confidence, ambiguous: !!r.ambiguous } : null;
}
// Title words to READ listings with, per occupation: every way a title in that job type is written, including
// the lead / manager titles one step up ("Customer Support Manager", "Sous Chef"). The read is a pre-filter;
// matchListing decides. Fallback: the occupation's own `q`.
const READ_TERMS = {
  cook: ['cook', 'chef', 'kitchen', 'culinary', 'grill'],
  food_crew: ['crew member', 'team member', 'crew', 'shift lead', 'shift leader', 'shift supervisor', 'general manager', 'restaurant manager', 'assistant manager'],
  barista: ['barista', 'coffee'],
  server: ['server', 'waiter', 'waitress', 'banquet'],
  software_engineer: ['software', 'developer', 'frontend', 'front end', 'front-end', 'backend', 'back end', 'back-end', 'full stack', 'fullstack', 'full-stack', 'web engineer', 'mobile engineer', 'programmer'],
  qa_engineer: ['qa', 'quality assurance', 'sdet', 'test engineer', 'test automation'],
  sre: ['site reliability', 'sre', 'devops', 'platform engineer', 'infrastructure engineer', 'cloud engineer'],
  data_engineer: ['data engineer', 'analytics engineer'],
  data_analyst: ['data analyst', 'analyst', 'business intelligence'],
  customer_service: ['customer service', 'customer support', 'call center', 'contact center', 'customer care', 'customer experience', 'support specialist', 'support representative', 'support agent', 'member services', 'client care'],
  corporate_trainer: ['trainer', 'training', 'learning', 'facilitator', 'onboarding', 'enablement'],
  instructional_designer: ['instructional design', 'curriculum', 'learning design', 'e-learning'],
  electrician: ['electrician', 'electrical', 'journeyman', 'wireman'],
  plumber: ['plumber', 'plumbing', 'pipefitter', 'pipe fitter', 'sprinkler'],
  hvac_tech: ['hvac', 'refrigeration'],
  maintenance_tech: ['maintenance', 'mechanic', 'facilities technician', 'maintainer'],
  warehouse_associate: ['warehouse', 'material handler', 'forklift', 'picker', 'packer', 'fulfillment', 'loader', 'shipping', 'receiving', 'distribution'],
  inventory_specialist: ['inventory', 'materials coordinator', 'logistics specialist'],
  delivery_driver: ['driver', 'delivery', 'courier'],
  truck_driver_cdl: ['cdl', 'truck driver', 'class a', 'tractor'],
  registered_nurse: ['registered nurse', 'nurse', ' rn ', 'rn -', ' rn'],
  lpn: ['lpn', 'lvn', 'licensed practical', 'licensed vocational'],
  cna: ['cna', 'nursing assistant', 'nurse aide', 'patient care', 'nursing attendant', 'lna'],
  caregiver: ['caregiver', 'home health aide', 'chha', 'hha', 'direct support', 'personal care'],
  cashier: ['cashier', 'checker', 'front end'],
  retail_associate: ['sales associate', 'retail', 'store', 'keyholder', 'key holder', 'merchandis', 'stock', 'general manager', 'district manager', 'area manager', 'assistant manager', 'shift lead', 'shift supervisor', 'team lead', 'department manager'],
  grocery_clerk: ['deli', 'grocery', 'clerk', 'produce', 'bakery'],
  admin_assistant: ['administrative', 'admin', 'office', 'executive assistant', 'secretary', 'data entry', 'clerical'],
  receptionist: ['receptionist', 'front desk', 'front office'],
  account_executive: ['account executive', 'sales executive', 'enterprise sales'],
  account_manager: ['account manager', 'key account', 'territory manager', 'client manager', 'relationship manager'],
  sales_rep: ['sales representative', 'sales rep', 'inside sales', 'outside sales', 'sales consultant', 'sales specialist'],
  security_officer: ['security officer', 'security guard', 'guard', 'patrol', 'security supervisor'],
  accountant: ['accountant', 'accounting', 'bookkeeper', 'accounts payable', 'accounts receivable'],
  instructor: ['teacher', 'instructor', 'educator'],
  operations: ['operations'],
  marketing: ['marketing', 'social media', 'content', 'brand', 'communications'],
  recruiter: ['recruiter', 'recruiting', 'talent acquisition', 'sourcer'],
};
/** Plain words and phrases the occupation's own title pattern names (so the read covers every title the rule
 * places in that job type: "litigation assistant", "presuit secretary"…). */
function patternWords(o) {
  return String(o.re.source).replace(/\(\?<?[!=][^)]*\)/g, ' ').replace(/\\[bsw]\+?\*?|\\d\+?|\?:|\\/g, ' ').split(/[|()]/)
    .map((x) => x.replace(/[?*+]/g, '').replace(/\s+/g, ' ').trim()).filter((x) => /^[a-z][a-z &'-]{2,30}$/.test(x) && !GENERIC_TITLE_WORD.test(x));
}
// A level or role word alone names no job type ("assistant", "manager") — reading on it would flood the read.
const GENERIC_TITLE_WORD = /^(and|the|for|with|assistant|manager|associate|coordinator|specialist|supervisor|lead|leader|staff|master|officer|agent|representative|rep|member|team member|administrator|clerk|host|hostess|monitor|technician|tech|worker|operator|helper|director|engineer|analyst|consultant|executive|intern|trainee|apprentice|attendant|aide|advisor|partner|crew|team|field supervisor|general|senior|junior|level)$/;
const _readTerms = new Map();
export function readTermsFor(id) {
  if (_readTerms.has(id)) return _readTerms.get(id);
  const o = OCC_BY_ID.get(id) || occupation(id);
  const shared = o?.fieldKey ? SHARED_FIELDS.find((f) => f.key === o.fieldKey) : null;
  const sharedWords = shared ? patternWords({ re: new RegExp(String(shared.title.source).replace(/\\s\+/g, ' ').replace(/\(\?:/g, '('), 'i') }) : [];
  const list = [...new Set([...(READ_TERMS[id] || []), ...(o?.q || []), ...(o && !shared ? patternWords(o) : []), ...sharedWords])].slice(0, 40);
  _readTerms.set(id, list);
  return list;
}
/** The occupations a person's listings are read for — the same keys matchListing judges with: held fields
 * (current first), their neighbours, job types applied to, transferable targets, and a degree's field only
 * where a degree can match (student, recent graduate, under a year of work). */
/** Title words to read with, from the person's DIRECTION: their current / latest job titles and the titles they
 * applied to ("Director of Human Resources" → "human resources", "hr"), so no fixed list can leave a listing unread. */
export function directionTerms(keys) {
  const roles = keys.roles || [];
  const dir = new Set(keys.direction || []);
  const titles = [];
  roles.forEach((r) => { if (r.current || r.occupations.some((id) => dir.has(id)) || (keys.no_direction && r.title === keys.no_direction.title)) titles.push(r.title); });
  for (const a of keys.applied || []) titles.push(a.title);
  const out = new Set();
  for (const t of titles.slice(0, 8)) {
    const core = normTitle(String(t).replace(/\([^)]*\)/g, ' ').split(/\s+[-–—|]\s+|,|\|/)[0]).replace(/\b(senior|sr|junior|jr|lead|i|ii|iii|iv|part time|full time|seasonal|temp|of|the|and|&)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (core.length >= 3) out.add(core);
    const words = core.split(' ').filter((w) => w.length >= 4 && !GENERIC_TITLE_WORD.test(w));
    for (let i = 0; i < words.length; i++) { out.add(words[i]); if (words[i + 1]) out.add(`${words[i]} ${words[i + 1]}`); }
    if (/\bhuman resources\b/.test(core)) { out.add('hr '); out.add(' hr'); out.add('people'); }
  }
  return [...out].slice(0, 30);
}
export function readOccupations(keys, now = new Date()) {
  const ids = [];
  const push = (id) => { if (id && !ids.includes(id) && OCC_BY_ID.get(id) && id !== 'ai_training') ids.push(id); };
  const occs = [...(keys.occupations || [])].sort((a, b) => (b.current - a.current) || ((b.last_year || 0) - (a.last_year || 0)));
  for (const o of occs) push(o.occupation);
  for (const a of keys.applied || []) push(a.occupation);
  for (const o of occs) if (o.years > 0) for (const adj of OCC_BY_ID.get(o.occupation)?.adj || []) push(adj);
  // The shared reader's neighbouring FIELDS too (matchListing's field-level "close"): every row the rule can
  // accept as close must be read ("Service Technician" — maintenance — beside an electrician).
  for (const o of occs) {
    if (!(o.years > 0) || o.left || o.side) continue;
    const f = primaryField(occupation(o.occupation));
    if (!f) continue;
    for (const k of (SHARED_FIELDS || []).map((x) => x.key)) { let adj = false; try { adj = k !== f && areAdjacent(f, k); } catch { adj = false; } if (adj) { const fo = fieldOccupation(k); if (fo) push(fo.id); } }
  }
  // A store / restaurant manager is read for area and multi-unit OPERATIONS manager roles (matchListing's closeOps).
  if (occs.some((o) => !o.left && (o.level || 0) >= 3 && ['retail_associate', 'cashier', 'grocery_clerk', 'food_crew', 'cook', 'barista', 'hotel_front_desk'].includes(o.occupation))) push('operations');
  for (const [target] of Object.entries(TRANSFER)) if (transferFrom(keys, target, (keys.applied || []).some((a) => a.occupation === target), now.getUTCFullYear())) push(target);
  const yearsTotal = Number(keys.years_total) || 0;
  for (const e of keys.education || []) if (e.studying || (e.year && now.getUTCFullYear() - e.year <= 1) || yearsTotal < 1) push(e.occupation);
  for (const id of keys.intent || []) push(id);
  return ids;
}
export const occupation = (id) => OCC_BY_ID.get(id) || (String(id || '').startsWith('field:') ? fieldOccupation(String(id).slice(6)) : null);

// ── The shared field reader as the fallback classifier ─────────────────────────────────────────
// When the job-type table above cannot place a title, the fit check's own field reader decides
// (lib/optimizer/fieldMatch.js: postingField for a listing — title first, then its duty lines; roleField for a
// résumé role — title, then what its bullets do). The answer is a field-level job type ("field:support") with
// that field's adjacency, so the matcher and the fit check read the same title the same way.
const _fieldOccs = new Map();
export function fieldOccupation(key) {
  if (!key) return null;
  if (_fieldOccs.has(key)) return _fieldOccs.get(key);
  const label = fieldLabel(key) || key;
  const o = { id: `field:${key}`, label: `${label} work`, family: key, re: /(?!)/, adj: [], lic: null, q: null, remote: ['software', 'data', 'it', 'marketing', 'sales', 'support', 'hr', 'accounting', 'design', 'product', 'front_office', 'training'].includes(key), fieldKey: key };
  _fieldOccs.set(key, o);
  OCC_BY_ID.set(o.id, o);
  return o;
}
/** A listing's job type: the table, else the shared field reader on its title and description. */
export function classifyListing(title, company = '', description = '') {
  const ctx = `${company} ${String(description || '').slice(0, 1500)}`;
  // An `exact` answer from the occupation knowledge base is a fact (measured 98.9% right) and wins over this
  // file's table; everything else falls through to the table, the shared field reader, then a `close` answer.
  // the exact check reads the title alone (cached by the module — this runs on every candidate listing)
  const mod = moduleOccupation(title, {});
  let own = classifyTitle(title, ctx);
  // The employer kind decides a generic title: a "Store Manager" / "Shift Supervisor" of a coffee or quick-service
  // brand, a "Training Coordinator (Restaurant)", is restaurant work.
  if (own && (own.id === 'retail_associate' || own.id === 'corporate_trainer')) {
    const fc = (String(description || '').slice(0, 800).match(new RegExp(FOOD_CUE.source, 'gi')) || []).length + (FOOD_CUE.test(title) ? 3 : 0) + (FOOD_CUE.test(String(company || '')) ? 3 : 0);
    const rc = (`${company} ${String(description || '').slice(0, 800)}`.match(new RegExp(RETAIL_CUE.source, 'gi')) || []).length;
    const generic = own.id === 'corporate_trainer' ? FOOD_CUE.test(`${title} ${company}`) : /\b((assistant )?store|shift|general)\s+(manager|supervisor|lead|leader)\b/i.test(title);
    if (generic && fc >= 2 && fc > rc) own = OCC_BY_ID.get('food_crew');
  }
  if (/\b(instrument|central (supply|sterile|service)|decontamination|spd)\s+(technician|tech|specialist|aide)\b/i.test(title) && /\b(steril\w*|surgical instruments?|decontamination|autoclave|central (supply|sterile|service)|operating room)\b/i.test(`${company} ${String(description || '').slice(0, 1200)}`)) return OCC_BY_ID.get('med_tech');
  if (mod && mod.confidence === 'exact' && !finerThan(own, mod.occ)) return mod.occ;
  if (own) return own;
  // The table names a job type the shared reader disagrees with ("Security Host" — a guard to the table, a host
  // to the reader): unplaced, never a match in either field.
  const raw = String(title || '');
  const head = raw.replace(/\([^)]*\)/g, ' ').split(/\s+[-–—|]\s+|,|\|/)[0].trim();
  if ((head && classifyRaw(head, ctx)) || classifyRaw(raw, ctx)) return null;
  let fm = null;
  try { fm = postingField(title, String(description || '')); } catch { fm = null; }
  if (fm) return fieldOccupation(fm);
  // Last: a `close` answer, with the posting's lines (measured right ~5 times in 6 on postings; the email path's
  // shared gates confirm it).
  const lines = String(description || '').split(/\n+/).map((x) => x.trim()).filter((x) => x.length > 20).slice(0, 40);
  const late = moduleOccupation(title, { lines, employer: company });
  return late ? late.occ : null;
}

// Industry cues that place a title which does not name its field ("Team Member", "Shift Lead").
const FOOD_CUE = /\b(restaurant|kitchen|food|menu|drive[- ]?thru|burger|pizza|cafe|café|coffee|grill|fryer|chick|taco|sandwich|bibibop|chipotle|mcdonald|wendy|subway|starbucks|panera|dutch bros|in-n-out|culinary|dining|guests? orders?|baristas?|broistas?|espresso|boba|quick[- ]service|fast[- ]casual|crew( members?)?|line cooks?|servers?|bar (&|and) grill|chili'?s|applebee'?s|olive garden|denny'?s|ihop|panda express|taco bell|kfc|popeyes|sonic|arby'?s|whataburger|domino'?s|little caesars|dunkin|peet'?s|caribou)\b/i;
const RETAIL_CUE = /\b(stores?|retail|merchandis\w*|register|sales floor|shelves|shelving|stocking|target|walmart|costco|kroger|safeway|fry'?s|albertsons|home depot|lowe'?s|best buy|cvs|walgreens|dollar (general|tree)|ulta|sephora|gnc|nordstrom|macy'?s|tj ?maxx|ross|marshalls|old navy|gap|kohl'?s|drive up|front[- ]end|planogram|guest service)\b/i;
const WAREHOUSE_CUE = /\b(warehouse|distribution center|fulfillment|forklift|pallet|picking|packing|loading dock|inbound|outbound)\b/i;

export function normTitle(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' & ').replace(/[^a-z0-9&/+#\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Which occupation a title names. `context` (company + description/bullets) places a title that does not say its field. */
/** Which of food / retail / warehouse the title + context clearly describe, or null when unclear. */
function placeByCue(title, context) {
  const score = (re) => {
    const g = new RegExp(re.source, 'gi');
    const inHead = (String(title).match(g) || []).length * 3;
    const inCtx = Math.min(5, (String(context).match(g) || []).length);
    return inHead + inCtx;
  };
  const ranked = [['food_crew', score(FOOD_CUE)], ['retail_associate', score(RETAIL_CUE)], ['warehouse_associate', score(WAREHOUSE_CUE)]].sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] < 2 || ranked[0][1] < ranked[1][1] + 2) return null;
  return OCC_BY_ID.get(ranked[0][0]);
}

/**
 * Which occupation a title names. The JOB NOUN decides: the part before " - ", ",", "|" or "(" first
 * ("Frontend Developer, Device Security" is a developer; "Device Security" is the team), then the whole title.
 * The answer must agree with the fit check's field reader (lib/optimizer/fieldMatch.js postingField) — when the
 * two disagree the title is left unplaced (never a match), so the matcher and the fit check can never call the
 * same title two different fields.
 */
const GRADE_TAIL_RE = /[\s,-]+(?:i{1,3}|iv|v|[1-4]|level\s*(?:[1-4]|i{1,3}|iv)|grade\s*\d|l[1-6])\s*$/i;
export function classifyTitle(title, context = '') {
  // "IT Support Specialist I", "Technician II", "Analyst - Level 2": the grade is a level, not a word of the job
  const raw = String(title || '').replace(GRADE_TAIL_RE, '').trim() || String(title || '');
  const head = raw.replace(/\([^)]*\)/g, ' ').split(/\s+[-–—|]\s+|,|\|/)[0].trim();
  // AI-training / survey gigs name a profession they are not ("Registered Nurses - AI Training").
  if (OCC_BY_ID.get('ai_training').re.test(normTitle(raw))) return OCC_BY_ID.get('ai_training');
  const occ = (head && head !== raw.trim() ? classifyRaw(head, context) : null) || classifyRaw(raw, context);
  if (!occ) return null;
  let fm = null;
  // An assistant TO someone is the assistant ("Executive Assistant to the Communications … Executives").
  try { fm = postingField(raw.replace(/\b(assistant|coordinator|aide|secretary) to (the )?.*$/i, '$1'), ''); } catch { fm = null; }
  // A title that names only a level ("Assistant Manager", "Shift Supervisor") was placed by its employer and lines;
  // the shared reader's field for the bare words is no evidence against that.
  if (fm && !fieldsFor(occ).includes(fm) && !levelOnlyTitle(raw)) return null;
  return occ;
}
const FAMILY_FIELDS = {
  retail: ['retail', 'sales', 'support', 'ops'], food_service: ['food', 'hospitality', 'ops'], warehouse: ['warehouse', 'logistics', 'manufacturing', 'supply_chain'],
  delivery_logistics: ['logistics', 'warehouse', 'supply_chain'], valet_parking: ['hospitality', 'logistics'], hospitality: ['hospitality', 'food', 'front_office'],
  customer_service: ['support', 'front_office', 'sales', 'retail', 'hospitality'], clinical: ['nursing', 'clinical', 'patient_care'],
  healthcare_support: ['patient_care', 'nursing', 'clinical', 'front_office'], administrative: ['front_office', 'legal', 'support', 'hr', 'patient_care', 'records'],
  sales: ['sales', 'support', 'retail'], software_engineering: ['software', 'data', 'it', 'engineering', 'cyber'], data_analytics: ['data', 'software', 'marketing', 'accounting'],
  operations: ['ops', 'logistics', 'warehouse', 'accounting', 'supply_chain'], security: ['ops', 'hospitality'], finance_accounting: ['accounting', 'data', 'sales'],
  marketing: ['marketing', 'sales', 'design'], education: ['education', 'training'], project_management: ['ops', 'product', 'engineering', 'software', 'construction'],
  skilled_trades: ['electrical', 'maintenance', 'construction', 'manufacturing', 'logistics'], engineering: ['engineering', 'software', 'manufacturing', 'electrical'],
  manufacturing: ['manufacturing', 'engineering', 'maintenance', 'warehouse', 'electrical'], it: ['it', 'software', 'cyber', 'support'], hr: ['hr', 'front_office'],
  legal: ['legal', 'front_office', 'records'], product: ['product', 'software'], design: ['design', 'marketing', 'engineering'], training: ['training', 'education', 'support', 'hr'],
  fitness: ['fitness'], personal_services: ['fitness', 'retail', 'hospitality'], social_services: ['clinical', 'education'], other: [],
};
// Where the fit check's reader names a neighbouring field for a title this table places precisely
// ("Instructional Designer" → its 'design'; "Barista Trainer" → its 'training').
// Each entry below the first line is a title the shared reader files under a wrong field (listed for the scoring
// engineer in the round-6 report): "Assistant Principal" → front_office, "Plasma Center Technician" → maintenance,
// "Laboratory Assistant" → science, "Food Safety Auditor" → accounting, "Food Safety Coordinator" → front_office,
// "Framing Crew Lead" → food, "Clinical Nurse Educator" → education, "Sterile Processing Technician" → maintenance.
const OCC_EXTRA_FIELDS = { med_tech: ['maintenance'], school_admin: ['front_office'], lab_assistant: ['science', 'maintenance'], food_safety: ['food', 'accounting', 'front_office'], carpenter: ['food'], registered_nurse: ['education'], truck_driver_cdl: ['training'], instructional_designer: ['design'], barista: ['training'], food_crew: ['training'], cook: ['training'], cashier: ['training'], retail_associate: ['training'] };
/** The shared reader's field key for a job type (a field-level job type is its own key). */
export function primaryField(occ) { return occ ? (occ.fieldKey || (FAMILY_FIELDS[occ.family] || [])[0] || null) : null; }
function fieldsFor(occ) { return [...(FAMILY_FIELDS[occ.family] || []), ...(OCC_EXTRA_FIELDS[occ.id] || [])]; }

function classifyRaw(title, context = '') {
  const t = normTitle(title).replace(/\//g, ' ');
  if (!t || t.length < 2) return null;
  for (const o of OCCUPATIONS) {
    if (!o.re.test(t)) continue;
    if (o.needsCue) return placeByCue(title, context);
    return o;
  }
  // A title that only says a level ("Shift Lead", "Team Lead", "General Manager") — placed by context.
  // "Guest Experience Team Lead", "Front End Supervisor": a level plus service words that name no field.
  const core = normTitle(String(title).split(/\s+[-–—|]\s+|,|\(/)[0]);
  if (/\b(lead|leader|supervisor|manager|team member|associate)\b/.test(core)) {
    const rest = core.replace(/\b(shift|team|crew|store|assistant|general|floor|lead|leader|supervisor|manager|member|associate|senior|sr|guest|experience|service|services|front|end|customer|sales|overnight|night|day|key|holder|department|district|area|regional|multi unit|unit)\b/g, ' ').trim();
    if (!rest) return placeByCue(title, context);
  }
  return null;
}

/** A title that names a level and no field ("Assistant Manager", "Shift Supervisor", "General Manager"). */
export function levelOnlyTitle(title) {
  const core = normTitle(String(title || '').split(/\s+[-–—|]\s+|,|\(/)[0]);
  if (!/\b(lead|leader|supervisor|manager|team member|associate)\b/.test(core)) return false;
  return !core.replace(/\b(shift|team|crew|store|assistant|general|floor|lead|leader|supervisor|manager|member|associate|senior|sr|guest|experience|service|services|front|end|customer|overnight|night|day|key|holder|department|unit)\b/g, ' ').trim();
}
/** Every occupation a résumé title names ("Key Holder/Sales Representative" → retail + sales). */
export function classifyRoleTitle(title, context = '') {
  const out = [];
  const whole = classifyTitle(title, context);
  if (whole) out.push(whole);
  const parts = String(title || '').split(/\s*(?:\/|\||&| and |,)\s*/i).map((p) => p.trim()).filter((p) => p.length >= 3);
  if (parts.length > 1) for (const p of parts) { const o = classifyTitle(p, context); if (o && !out.includes(o)) out.push(o); }
  return out;
}

// ── Levels ─────────────────────────────────────────────────────────────────────────────────────
// 0 intern / co-op · 1 regular · 2 senior, lead, supervisor, key holder, assistant manager · 3 manager,
// principal / staff (tech) · 4 director, head of · 5 VP, chief. "Manager" in a title that is not about
// managing people (account / case / product / project manager …) keeps that field's own level.
const NOT_PEOPLE_MANAGER = /\b(account|case|care|product|project|program|social media|community|territory|customer success|client success|client|relationship|knowledge|portfolio|asset|category|configuration|plm|property|sales enablement|enablement|merchant launch|partner marketing|brand|content|marketing|digital marketing|field marketing)\s+manager\b/;
export function levelOf(title) {
  const t = normTitle(title).replace(/\b(assistant|coordinator|aide|secretary|support) to (the )?.*$/, '$1');
  if (!t) return 1;
  if (/\b(chief|ciso|cto|cfo|ceo|coo|vp|vice president|president)\b/.test(t)) return 5;
  if (/\b(associate|assistant) dean\b/.test(t)) return 3;
  if (/\b(dean|provost)\b/.test(t)) return 4;
  if (/\b(director|head of)\b/.test(t)) return /\bassociate director|assistant director\b/.test(t) ? 3 : 4;
  if (/\b(district|regional|area|multi[- ]?unit) (store |operations |sales )?manager\b/.test(t)) return 4;
  if (/\b(senior|sr) manager\b/.test(t)) return 4;
  if (/\b(intern|internship|co ?op|extern|externship|summer \d{4}|student)\b/.test(t)) return 0;
  if (/\b(trainee|in training|apprentice|entry level)\b/.test(t)) return 1;
  if (/\b(head chef|executive chef|chef de cuisine)\b/.test(t)) return 3;
  if (/\b(sous chef|lead cook|kitchen lead|chef de partie)\b/.test(t)) return 2;
  const peopleManager = /\b(manager|superintendent)\b/.test(t) && !/\bassistant (store |operations |station |retail |restaurant |general )?manager\b/.test(t) && !NOT_PEOPLE_MANAGER.test(t);
  if (peopleManager) return 3;
  if (/\b(senior|sr)\b/.test(t) && NOT_PEOPLE_MANAGER.test(t) && /\b(product|project|program|marketing|brand|content|partner marketing|field marketing|digital marketing|enablement|portfolio|asset|relationship) manager\b/.test(t)) return 3;
  if (/\b(assistant|vice) principal\b/.test(t)) return 2;
  if (/\b(principal|staff (software|engineer|applied|product|security|it|electrical|digital|automation|corporate|turbomachinery|technical|data|ml|machine|backend|frontend|infrastructure|platform|sre))\b/.test(t)) return 3;
  if (/\b(senior|sr|lead|supervisor|foreman|crew chief|key ?holder|keyholder|assistant (store |operations |station |retail |restaurant |general )?manager|team lead|shift (lead|leader|supervisor)|department chair|process assistant|squad leader|team leader|crew leader|line lead|charge nurse|level (iii|3|iv|4)|iii|iv)\b/.test(t)) return 2;
  if (NOT_PEOPLE_MANAGER.test(t)) {
    if (/\b(key|strategic|national|enterprise) account\b/.test(t) || /\b(product|project|program|property|marketing|brand|content|community|social media|partner marketing|field marketing|digital marketing|enablement|category|portfolio|asset|relationship|knowledge|configuration|plm) manager\b/.test(t)) return 2;
    return 1;
  }
  if (/\b(enterprise|strategic|major) (account executive|sales|accounts?)\b/.test(t)) return 2;
  return 1;
}
export const isPeopleManagerTitle = (title) => levelOf(title) >= 3 || /\b(supervisor|foreman|shift (lead|supervisor)|team lead|assistant (store )?manager|crew chief)\b/.test(normTitle(title));

// ── Licences ───────────────────────────────────────────────────────────────────────────────────
// listing: the posting asks for it; resume: the résumé states it. A role that cannot be held without the
// licence implies it (implied). Obtainable-on-the-job wording ("ability to obtain", "within 30 days", "will
// train", "preferred") never blocks.
const LICENCES = [
  { id: 'guard_card', label: 'a security guard license', listing: /\b(guard card|security (officer|guard) (license|licence|registration|card|certification)|registration as a security guard|security guard registration|bsis|security license|security licence|perc card|security registration)\b/i, resume: /\b(guard card|security (officer|guard) (license|licence|registration|card)|bsis|security license|security licence|perc card|registered security)\b/i, implied: ['security_officer'] },
  { id: 'cdl_a', label: 'a Class A CDL', listing: /\b(class a (cdl|commercial driver'?s licen[cs]e|licen[cs]e|driver)|cdl[- ]?a\b|cdl,? class a)/i, negative: /\b(non[- ]?cdl|no cdl|cdl (is )?not required)\b/i, resume: /\b(class a (cdl|commercial)|cdl[- ]?a\b|cdl,? class a|cdl \(class a\))/i, implied: [], impliedTitle: /\bclass a\b/i },
  { id: 'hazmat', label: 'a hazmat endorsement', listing: /\b(hazmat|hazardous materials?) (endorsement|endorsed|certification|required)|\b[hx] endorsement|\bendorsements?:?[^.\n]{0,30}\b(hazmat|h\b|x\b)|\bhazmat\b(?=[^.\n]{0,30}\brequired)/i, resume: /\b(hazmat|hazardous materials?)( endorsement)?\b|\b[hx] endorsement/i, implied: [], names: /hazmat|hazardous|\b[hx] endorsement/i },
  { id: 'tanker', label: 'a tanker endorsement', listing: /\b(tanker|\bn) endorsement|endorsements?:?[^.\n]{0,30}\btanker/i, resume: /\b(tanker|\bn) endorsement|\btanker\b/i, implied: [], names: /tanker|\bn endorsement/i },
  { id: 'cdl', label: 'a CDL', listing: /\b(cdl|commercial driver'?s licen[cs]e)\b(?![- ]?(not|isn'?t) required)/i, negative: /\b(non[- ]?cdl|no cdl|cdl (is )?not required|without a cdl)\b/i, resume: /\b(cdl|commercial driver'?s licen[cs]e)\b/i, implied: ['truck_driver_cdl'] },
  { id: 'rn', label: 'an RN license', listing: /\b(rn licen[cs]e|registered nurse licen[cs]e|licen[cs]ed (as an? )?(registered nurse|rn)|active rn|current rn|rn,? (bsn )?required|compact (rn )?licen[cs]e)\b/i, resume: /\b(rn licen[cs]e|registered nurse|\brn\b)\b/i, implied: ['registered_nurse', 'nurse_practitioner'] },
  { id: 'lpn', label: 'an LPN/LVN license', listing: /\b(lpn|lvn) (licen[cs]e|required)|licen[cs]ed (practical|vocational) nurse licen[cs]e\b/i, resume: /\b(lpn|lvn|licensed (practical|vocational) nurse)\b/i, implied: ['lpn', 'registered_nurse'] },
  { id: 'cna', label: 'a CNA certificate', listing: /\b(cna (certification|certificate|licen[cs]e|required)|certified nursing assistant (certification|certificate|licen[cs]e)|state[- ]certified (nursing assistant|cna)|active cna)\b/i, resume: /\b(cna|lna|certified nursing assistant|nurse aide certif\w*)\b/i, implied: ['cna', 'lpn', 'registered_nurse'] },
  { id: 'hha', label: 'a home health aide certificate', listing: /\b(hha|chha|home health aide) (certification|certificate|required)\b/i, resume: /\b(hha|chha|home health aide)\b/i, implied: ['cna', 'lpn', 'registered_nurse'] },
  { id: 'clearance', label: 'a security clearance', listing: /\b((active|current) (secret|top secret|ts\/?sci|ts) (security )?clearance|(secret|top secret|ts\/sci) clearance (is )?required|must (have|hold|possess) an? (active )?(secret|top secret|ts\/sci))\b/i, resume: /\b((active|current)?\s*(secret|top secret|ts\/sci) (security )?clearance)\b/i, implied: [] },
  { id: 'pharmacy_tech', label: 'a pharmacy technician license', listing: /\b(pharmacy technician (licen[cs]e|registration|certification)|ptcb|cpht)\b/i, resume: /\b(pharmacy technician|ptcb|cpht)\b/i, implied: ['pharmacy_tech'] },
  { id: 'cosmetology', label: 'a cosmetology license', listing: /\b(cosmetology|cosmetologist) licen[cs]e\b|\blicen[cs]ed cosmetologist\b/i, resume: /\b(cosmetology|cosmetologist) licen[cs]e\b|\blicen[cs]ed cosmetologist\b/i, implied: ['cosmetologist'] },
  { id: 'esthetician', label: 'an esthetician license', listing: /\b((a)?esthetician|esthetics|skin care) licen[cs]e\b|\blicen[cs]ed (a)?esthetician\b/i, resume: /\b((a)?esthetician|esthetics) licen[cs]e\b|\blicen[cs]ed (a)?esthetician\b/i, implied: ['esthetician'] },
  { id: 'barber', label: 'a barber license', listing: /\bbarber(ing)? licen[cs]e\b|\blicen[cs]ed barber\b/i, resume: /\bbarber(ing)? licen[cs]e\b|\blicen[cs]ed (master )?barber\b/i, implied: ['barber'] },
  { id: 'nail_tech', label: 'a nail technician license', listing: /\bnail (tech\w*|specialist|care) licen[cs]e\b|\blicen[cs]ed nail tech\w*\b|\bmanicurist licen[cs]e\b/i, resume: /\bnail (tech\w*|specialist|care) licen[cs]e\b|\blicen[cs]ed nail tech\w*\b|\bmanicurist licen[cs]e\b/i, implied: ['nail_tech'] },
  { id: 'massage', label: 'a massage therapy license', listing: /\b(massage (therapy|therapist) licen[cs]e|lmt\b|licen[cs]ed massage therapist)/i, resume: /\b(massage (therapy|therapist) licen[cs]e|lmt\b|licen[cs]ed massage therapist)/i, implied: ['massage_therapist'] },
  { id: 'faa_ap', label: 'an FAA A&P certificate', listing: /\b(a ?& ?p (certificate|licen[cs]e|certification|mechanic certificate)|airframe (and|&) powerplant (certificate|licen[cs]e|certification|rating)|faa (a ?& ?p|mechanic certificate))\b/i, resume: /\b(a ?& ?p\b|airframe (and|&) powerplant|faa mechanic certificate)/i, implied: ['aircraft_mechanic'] },
  { id: 'faa_ia', label: 'an FAA Inspection Authorization', listing: /\b(inspection authori[sz]ation|\bia\b (required|certificate|rating)|a ?& ?p with ia|a ?& ?p\/ia)\b/i, resume: /\b(inspection authori[sz]ation|a ?& ?p ?\/ ?ia\b|a ?& ?p with ia\b|\bia rating\b)/i, implied: [] },
  { id: 'rda', label: 'a registered dental assistant license', listing: /\b(rda\b|registered dental assistant|dental assisting (licen[cs]e|registration)|expanded function(s)? dental assistant|efda)\b/i, resume: /\b(rda\b|registered dental assistant|efda|expanded function(s)? dental assistant)/i, implied: [] },
  { id: 'rdh', label: 'a dental hygiene license', listing: /\b(rdh|dental hygien\w* licen[cs]e|licen[cs]ed dental hygienist|registered dental hygienist)\b/i, resume: /\b(rdh|registered dental hygienist|dental hygien\w* licen[cs]e)\b/i, implied: ['dental_hygienist'], names: /hygien|rdh/i },
  { id: 'master_electrician', label: 'a master electrician license', listing: /\b(master electrician('?s)? (licen[cs]e|card|certification)|licen[cs]ed master electrician|master (electrical )?licen[cs]e)\b/i, resume: /\bmaster electrician\b/i, implied: [], impliedTitle: /\bmaster electrician\b/i },
  { id: 'journeyman_electrician', label: 'a journeyman electrician license', listing: /\b(journeyman electrician('?s)? (licen[cs]e|card)|electrical (licen[cs]e|certification card)|licen[cs]ed electrician|state electrical licen[cs]e|(residential|general|commercial|state|certified) electrician('?s)? (certification|certificate|licen[cs]e|card)|electrician (certification|certificate)|certified electrician)\b/i, resume: /\b(journeyman electrician|electrical journeyman|journeyman (inside )?wireman|licen[cs]ed electrician|electrical licen[cs]e|electrician('?s)? (licen[cs]e|certification|card))\b/i, implied: [], impliedTitle: /\b(journeyman electrician|electrical journeyman|journeyman (inside )?wireman|master electrician)\b/i, names: /electric|wireman/i },
  { id: 'master_plumber', label: 'a master plumber license', listing: /\b(master plumb(er|ing)('?s)? licen[cs]e|licen[cs]ed master plumber)\b/i, resume: /\bmaster plumber\b/i, implied: [], impliedTitle: /\bmaster plumber\b/i },
  { id: 'journeyman_plumber', label: 'a journeyman plumber license', listing: /\b(journeyman plumb(er|ing)('?s)? licen[cs]e|licen[cs]ed (journeyman )?plumber)\b/i, resume: /\b(journeyman plumber|plumbing licen[cs]e|licen[cs]ed plumber)\b/i, implied: [], impliedTitle: /\b(journeyman|master) plumber\b/i },
  { id: 'pe', label: 'a PE license', listing: /\b(professional engineer(ing)? \(?pe\)? licen[cs]e|pe licen[cs]e|licen[cs]ed professional engineer|active pe)\b/i, resume: /\b(professional engineer|pe licen[cs]e|\bp\.?e\.?\b)/i, implied: [] },
  { id: 'epa608', label: 'an EPA 608 certification', listing: /\bepa (section )?608\b/i, resume: /\bepa (section )?608\b/i, implied: [] },
  { id: 'cpa', label: 'a CPA license', listing: /\b(active cpa|cpa licen[cs]e|licensed cpa|cpa (is )?required)\b/i, resume: /\bcpa\b/i, implied: [] }, // "CPA candidate" is IN_PROGRESS_RE
  { id: 'real_estate', label: 'a real estate license', listing: /\breal estate licen[cs]e\b/i, resume: /\breal estate licen[cs]e\b/i, implied: [] },
  { id: 'forklift', label: 'a forklift certification', listing: /\bforklift (certification|certificate|licen[cs]e|certified)\b/i, resume: /\bforklift\b/i, implied: [] },
  { id: 'emt', label: 'an EMT certification', listing: /\b(emt|paramedic) (certification|licen[cs]e|required)\b/i, resume: /\b(emt[- ]?b|emt|paramedic)\b/i, implied: [] }, // "EMT conduit" is not this: credentials need a licence line (CREDENTIAL_LINE)
];
const LIC_BY_ID = new Map(LICENCES.map((l) => [l.id, l]));
// A higher grade of a licence holds the lower one (a master electrician holds a journeyman's licence).
const LICENCE_COVERS = { master_electrician: ['journeyman_electrician'], master_plumber: ['journeyman_plumber'], cdl_a: ['cdl'] };
// Licences implied by a field the title names (a CNA listing needs a CNA). Fields like "np", "md", "bar"
// are licensed professions no résumé outside that profession reaches; they only exist as occupations.
const TITLE_LICENCE = { rdh: 'rdh', guard_card: 'guard_card', cdl: 'cdl', cdl_a: 'cdl_a', rn: 'rn', lpn: 'lpn', cna: 'cna', pharmacy_tech: 'pharmacy_tech', cosmetology: 'cosmetology', esthetician: 'esthetician', barber: 'barber', nail_tech: 'nail_tech', massage: 'massage', faa_ap: 'faa_ap' };
const OBTAINABLE_RE = /\b(prefer\w*|a plus|plus\b|nice to have|bonus|desired|ability to obtain|able to obtain|obtain\w* within|willing (to|and able to) obtain|must obtain|or obtain|will (help|assist|train|sponsor|pay|provide)|we (will )?(pay|sponsor|provide)|paid (training|certification)|eligible (to obtain|for)|in (the )?process of|upon hire|after hire|within \d+ (days|months|years)|within (thirty|sixty|ninety|six|twelve|one|two) (days|months|years?)|eligib\w*|sponsor\w*|once hired|not required|is not required)\b/i;
const IN_PROGRESS_RE = /\b(pursuing|in progress|expected|studying for|working toward|working towards|enrolled|candidate|planned|scheduled|inactive|expired|lapsed|formerly held|previously held|no longer active)\b/i;

function sentencesOf(text) {
  return String(text || '').replace(/\r/g, '').split(/\n+|(?<=[.!?;])\s+(?=[A-Z•\-*])|•/).map((s) => s.trim()).filter(Boolean);
}

/** Licences the posting requires (not "preferred", not "obtain after hire"). */
export function requiredLicences(job) {
  const out = new Set();
  const occ = classifyTitle(job?.title, `${job?.company || ''} ${String(job?.description || '').slice(0, 1500)}`);
  if (occ?.lic && TITLE_LICENCE[occ.lic]) out.add(TITLE_LICENCE[occ.lic]);
  const title = String(job?.title || '');
  for (const sentence of [title, ...sentencesOf(job?.description)]) {
    for (const l of LICENCES) {
      if (!l.listing.test(sentence)) continue;
      if (l.negative && l.negative.test(sentence)) continue;
      if (sentence !== title && OBTAINABLE_RE.test(sentence)) continue;
      out.add(l.id);
    }
  }
  // "Non-CDL" anywhere in the title means no CDL; a Class A requirement is the CDL requirement.
  if (/\bnon[- ]?cdl\b/i.test(title)) { out.delete('cdl'); out.delete('cdl_a'); }
  if (out.has('cdl_a')) out.delete('cdl');
  if (out.has('master_electrician')) out.delete('journeyman_electrician');
  if (out.has('master_plumber')) out.delete('journeyman_plumber');
  // A bare "journeyman license" is the trade of the listing (a plumber's journeyman license is not an electrician's).
  const bare = [title, ...sentencesOf(job?.description)].find((x) => /\b(journeyman|licen[cs]ed journeyman)( \w+)? (licen[cs]e|card)\b/i.test(x) && !OBTAINABLE_RE.test(x));
  if (bare) {
    if (occ?.id === 'electrician') out.add('journeyman_electrician');
    else if (occ?.id === 'plumber') out.add('journeyman_plumber');
  }
  return [...out];
}

// ── State licenses and permits ───────────────────────────────────────────────────────────────────
// "Washington dental hygiene license", "Expanded Practice Permit": a credential tied to a STATE or a named PERMIT.
// Until the shared gates read these, the pre-filter refuses when the résumé's credential lines do not name it.
const STATES = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY' };
const STATE_NAME_RE = new RegExp(`\\b(${Object.keys(STATES).sort((a, b) => b.length - a.length).join('|')})\\b`, 'i');
const STATE_CODE_RE = new RegExp(`\\b(${Object.values(STATES).join('|')})\\b`);
const CRED_WORD_RE = /\b(licen[cs]e|licensure|registration|registered|certification|certificate|permit)\b/i;
/** [{ kind: 'state', state, code, text } | { kind: 'permit', words, text }] the posting requires. */
export function requiredStateCredentials(job) {
  const out = [];
  for (const sentence of sentencesOf(job?.description)) {
    if (!CRED_WORD_RE.test(sentence) || OBTAINABLE_RE.test(sentence) || PREFERRED_RE.test(sentence)) continue;
    if (/\bdriver'?s?\b|\bdriving\b|\bwork permit\b|\bparking\b|\bauthori[sz]ed to work\b/i.test(sentence)) continue;
    const name = sentence.match(STATE_NAME_RE);
    const code = sentence.match(STATE_CODE_RE);
    // a state named WITH the credential ("Washington dental hygiene license", "active WA RDH license")
    const near = (idx) => { const w = sentence.slice(Math.max(0, idx - 40), idx + 60); return CRED_WORD_RE.test(w); };
    if (name && near(name.index)) out.push({ kind: 'state', state: name[1].toLowerCase(), code: STATES[name[1].toLowerCase()], text: sentence.slice(0, 160) });
    else if (code && near(code.index) && !/\b(OR|IN|ME|OK|HI)\b/.test(code[1])) out.push({ kind: 'state', state: Object.keys(STATES).find((k) => STATES[k] === code[1]), code: code[1], text: sentence.slice(0, 160) });
    const permit = sentence.match(/\b((?:[A-Z][\w-]+ ){1,3})[Pp]ermit\b/);
    if (permit) out.push({ kind: 'permit', words: permit[1].trim().toLowerCase(), text: sentence.slice(0, 160) });
  }
  return out;
}

// ── Named credentials ───────────────────────────────────────────────────────────────────────────
// Any certification / licence / card / endorsement / registration the posting REQUIRES by name ("OSHA 30
// certification required", "Nebraska Life & Health license", "ABA-approved paralegal certificate", "RHIT",
// "Journeyman card from the carpenters union"), read from the posting sentence. Credentials the licence table
// knows (CDL, RN, guard card…) are left to it. A named master's / doctoral degree "required" counts too.
const NAMED_CRED_NOUN = /\b(certifications?|certificates?|certified|licen[cs]es?|licensure|cards?|endorsements?|registrations?|credentials?)\b/i;
const NAMED_STOP = new Set(['required', 'requirement', 'requirements', 'must', 'have', 'has', 'hold', 'holds', 'possess', 'active', 'current', 'valid', 'unrestricted', 'good', 'standing', 'a', 'an', 'the', 'with', 'from', 'in', 'of', 'or', 'and', 'for', 'to', 'as', 'by', 'is', 'are', 'be', 'on', 'at', 'any', 'one', 'state', 'approved', 'accredited', 'union', 'program', 'level', 'license', 'licence', 'licenses', 'licences', 'licensure', 'licensed', 'certification', 'certifications', 'certificate', 'certificates', 'certified', 'card', 'cards', 'endorsement', 'endorsements', 'registration', 'registrations', 'credential', 'credentials', 'issued', 'your', 'our', 'their', 'this', 'that', 'who', 'will', 'we', 'you', 'all', 'new', 'national', 'nationally', 'recognized', 'equivalent', 'proof', 'copy', 'upon', 'hire', 'prior', 'start', 'date', 'years', 'year', 'experience', 'minimum', 'min', 'plus', 'also', 'such', 'similar', 'related', 'relevant', 'appropriate', 'applicable', 'professional', 'iii', 'ii', 'i', 'iv']);
const NAMED_SKIP = /\b(driver'?s?|driving record|background|drug|physical|authori[sz]ed to work|work permit|parking|food handler'?s? card|cpr\b(?!.*\bbls\b))/i;
export function requiredNamedCredentials(job) {
  const out = [];
  for (const sentence of sentencesOf(job?.description)) {
    const s0 = String(sentence).trim();
    if (!s0 || s0.length > 200 || OBTAINABLE_RE.test(s0) || PREFERRED_RE.test(s0) || NAMED_SKIP.test(s0)) continue;
    const degree = /\b(master'?s|masters|m\.?s\.?|mba|ph\.? ?d|doctorate|doctoral)\b[^.]{0,40}\b(degree|required|in)\b/i.test(s0) && /\brequired|must\b/i.test(s0);
    if (!NAMED_CRED_NOUN.test(s0) && !degree) continue;
    if (LICENCES.some((l) => l.listing.test(s0))) continue;
    if (STATE_NAME_RE.test(s0) && !/\b(life|health|real estate|superintendent|counselor|armed|level|electrician|general|insurance|property|casualty)\b/i.test(s0) && requiredStateCredentials({ description: s0 }).length) continue;
    // a requirement line: it says required / must / active / valid, or it is a short bullet naming the credential
    if (!/\b(required|must|active|valid|current|hold)\b/i.test(s0) && s0.length > 90) continue;
    const acr = [...s0.matchAll(/\b([A-Z]{2,6}(?:[- ]?\d{2,3})?(?:-[A-Z]{2})?)\b/g)].map((m) => m[1]).filter((a) => !STATE_CODE_RE.test(a) || a.length > 2).filter((a) => !/^(AND|OR|THE|US|USA|EEO|HR|OSHA)$/.test(a) || /\d/.test(a));
    const words = normTitle(s0.replace(STATE_NAME_RE, ' ')).split(' ').filter((w) => w.length > 1 && !NAMED_STOP.has(w) && !/^\d+$/.test(w) || /^\d{2,3}$/.test(w));
    if (degree) { out.push({ kind: 'degree', text: s0.slice(0, 160), field: words.filter((w) => !/^(master|masters|ms|mba|phd|doctorate|doctoral|degree)$/.test(w)) }); continue; }
    if (!acr.length && !words.length) continue;
    out.push({ kind: 'named', acr, words: words.slice(0, 6), text: s0.slice(0, 160) });
  }
  return out;
}
/** Does the résumé name the credential the posting asks for? */
function namesCredential(need, keys) {
  const hay = [...(keys.credential_lines || []), ...(keys.roles || []).map((r) => r.title), ...(keys.skills || [])].join('\n');
  const low = normTitle(hay);
  if (need.kind === 'degree') {
    const adv = (keys.education || []).some((e) => /\b(m\.?s|m\.?a|master|mba|m\.?ed|ph\.?d|ed\.?d|doctor)/i.test(String(e.degree || '')));
    return adv;
  }
  if (need.acr.length && need.acr.some((a) => new RegExp(`\\b${escapeRegExp(a).replace(/[- ]/g, '[- ]?')}\\b`, 'i').test(hay))) return true;
  if (need.acr.length && !need.words.length) return false;
  const words = need.words.filter((w) => !need.acr.some((a) => a.toLowerCase() === w));
  if (!words.length) return false;
  return words.every((w) => new RegExp(`\\b${escapeRegExp(w)}`, 'i').test(low));
}

// A named certification that opens one line of work — read as a DIRECTION for someone whose job titles do not
// say it yet (a new graduate with an IT degree and CompTIA A+; a certified sterile-processing technician).
const CERT_DIRECTION = [
  [/\b(comptia a\+|a\+ certifi\w*|google it support|comptia network\+|network\+)/i, 'it_support', 'CompTIA A+'],
  [/\b(ccna)\b/i, 'network_admin', 'CCNA'],
  [/\b(security\+|comptia security)/i, 'security_analyst', 'CompTIA Security+'],
  [/\b(crcst|cbspd|sterile processing (technician )?certif\w*|central service technician|certified sterile)/i, 'med_tech', 'a sterile-processing certification'],
  [/\b(cpht|ptcb|pharmacy technician certif\w*)/i, 'pharmacy_tech', 'a pharmacy technician certification'],
  [/\b(phlebotomy (technician )?certif\w*|cpt\b(?=.*phlebot)|nha phlebotomy)/i, 'phlebotomist', 'a phlebotomy certification'],
  [/\b(rbt|registered behavior technician)\b/i, 'behavior_tech', 'the RBT credential'],
  [/\b(ccma|certified (clinical )?medical assistant)\b/i, 'medical_assistant', 'a medical assistant certification'],
];
export function certDirections(lines) {
  const text = (lines || []).join('\n');
  const out = [];
  for (const [re, id, label] of CERT_DIRECTION) { const m = text.match(re); if (m && !out.some((o) => o.occupation === id)) out.push({ occupation: id, cred: /^[A-Z]/.test(m[0]) && m[0].length <= 30 ? m[0].trim() : label }); }
  return out;
}
/** Licences a résumé states (in-progress ones excluded). */
// A credential is read only from a licences / certifications section, or from a line that says it is a licence,
// certificate, card or registration — never from a bullet ("ran EMT conduit", "worked with the PE on site").
const CRED_HEADING_RE = /^\s*(licen[cs]es?|certifications?|certificates?|credentials?|licen[cs]es?\s*(and|&)\s*certifications?|certifications?\s*(and|&)\s*licen[cs]es?|professional licen[cs]es?)\b[^a-z]*$/i;
const OTHER_HEADING_RE = /^\s*(experience|work experience|employment|education|skills|technical skills|projects|summary|profile|objective|volunteer\w*|awards|references)\b[^a-z]*$/i;
const CREDENTIAL_LINE = /\b(licen[cs]e[ds]?|certif\w*|card|registration|registered|board[- ]certified|credential)\b/i;
/** The résumé lines that state a credential (a licenses section, or a line that says license/certified/card). */
export function credentialLines(text) {
  const out = [];
  let inCreds = false;
  for (const line of String(text || '').split(/\n/)) {
    const t = line.trim();
    if (CRED_HEADING_RE.test(t)) { inCreds = true; continue; }
    if (OTHER_HEADING_RE.test(t)) { inCreds = false; continue; }
    if (t && (inCreds || CREDENTIAL_LINE.test(t)) && !IN_PROGRESS_RE.test(t)) out.push(t.slice(0, 160));
  }
  return out.slice(0, 20);
}
export function resumeLicences(text) {
  const out = new Set();
  let inCreds = false;
  for (const line of String(text || '').split(/\n/)) {
    const t = line.trim();
    if (CRED_HEADING_RE.test(t)) { inCreds = true; continue; }
    if (OTHER_HEADING_RE.test(t)) { inCreds = false; continue; }
    if (!inCreds && !CREDENTIAL_LINE.test(t)) continue;
    if (IN_PROGRESS_RE.test(t)) continue;
    for (const l of LICENCES) {
      const m = t.match(l.resume);
      if (!m) continue;
      const before = t.slice(Math.max(0, m.index - 14), m.index);
      if (/\b(no|non|not|without|never)\b[\s-]{0,3}(a\s)?$/i.test(before)) continue; // "No CDL."
      out.add(l.id);
    }
  }
  return [...out];
}

// ── Dates and years ────────────────────────────────────────────────────────────────────────────
function monthIndex(s, { end = false, now = new Date() } = {}) {
  const v = String(s || '').trim().toLowerCase();
  if (!v) return null;
  if (/^(present|current|now|today)$/.test(v)) return now.getUTCFullYear() * 12 + now.getUTCMonth();
  let m = v.match(/^(\d{4})-(\d{1,2})/);
  if (m) return Number(m[1]) * 12 + (Number(m[2]) - 1);
  m = v.match(/^(\d{4})$/);
  if (m) return Number(m[1]) * 12 + 5; // a year alone: mid-year, so "2016 – 2019" is 3 years
  m = v.match(/(\d{4})/);
  return m ? Number(m[1]) * 12 + 5 : null;
  // (end is accepted for symmetry; a year-only end is mid-year like a start)
}
const yearOf = (mi) => (mi == null ? null : Math.floor(mi / 12));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Months covered by a set of [start, end] intervals, overlaps counted once. */
function unionMonths(intervals) {
  const iv = intervals.filter(([a, b]) => a != null && b != null && b >= a).sort((x, y) => x[0] - y[0]);
  let total = 0; let cs = null; let ce = null;
  for (const [a, b] of iv) {
    if (cs == null) { cs = a; ce = b; continue; }
    if (a <= ce) { ce = Math.max(ce, b); continue; }
    total += ce - cs; cs = a; ce = b;
  }
  if (cs != null) total += ce - cs;
  return total;
}

// ── Résumé roles ───────────────────────────────────────────────────────────────────────────────
const GIG_RE = /\b(doordash|uber|lyft|instacart|grubhub|postmates|amazon flex|spark driver|shipt|gopuff|taskrabbit|rover|fiverr|upwork|freelance|self[- ]employed|gig)\b/i;
const VOLUNTEER_RE = /\b(volunteer\w*|unpaid|pro bono)\b/i;
const INTERN_RE = /\b(intern|internship|co-?op|extern|externship|fellow(ship)?)\b/i;
const PLAUSIBLE_TITLE = (t) => {
  const s = String(t || '').trim();
  if (s.length < 2 || s.length > 70) return false;
  if (!/^([A-Za-z]|\d{1,2}(st|nd|rd|th)\b)/.test(s) || /^[a-z]/.test(s)) return false; // a bullet fragment starts lower-case
  if ((s.match(/,/g) || []).length >= 2) return false;
  if (s.split(/\s+/).length > 8) return false;
  return true;
};
const TRAINS_RE = /\b(train(s|ed|ing)?|coach(es|ed|ing)?|onboard(s|ed|ing)?|mentor(s|ed|ing)?|teach(es|ing)?|taught|facilitat(e|es|ed|ing))\b[^.\n]{0,50}\b(agents|new hires?|hires?|employees|staff|team|teams|associates|reps|representatives|cashiers|crew|members|technicians|students|nurses|drivers|workers|people|cohorts?|classes|sessions)\b/i;
const MANAGED_RE = /\b(supervis\w+|manage[sd]?|lead|leads|led|leading|oversee|oversees|oversaw|direct(s|ed)?|trained and (supervised|scheduled))\b[^.\n]{0,40}\b(team|teams|staff|crew|employees|associates|people|reps|representatives|workers|members|technicians|cashiers|drivers|\d+\s*(?:\+\s*)?(?:people|employees|staff|associates|reports))\b/i;

// The employer as the parser shows it (`displayCompany`) when the raw field carried a whole header line
// ("Paylocity-style HR SaaS: \"Brightwork HR\""); the raw name when display only changed its casing ("GNC").
function employerOf(r) {
  let raw = String(r.company || '').trim();
  // A header line kept whole ("Paylocity-style HR SaaS: \"Brightwork HR\"") → the quoted name, or what follows the colon.
  const quoted = raw.match(/["“]([^"”]{2,40})["”]/);
  if (quoted) raw = quoted[1].trim();
  else if (/:\s*\S/.test(raw)) raw = raw.split(':').pop().trim();
  const shown = String(r.displayCompany || '').trim().replace(/^.*?["“]([^"”]{2,40})["”].*$/, '$1');
  if (!shown) return raw;
  if (!raw || shown.length < raw.length - 3) return shown;
  return raw;
}

const normLine = (b) => String(b || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

function resumeRoles(text, now) {
  let doc = null;
  try { doc = parseResume({ text }); } catch { doc = null; }
  let raw = [];
  if (doc && Array.isArray(doc.experience) && doc.experience.length) {
    raw = doc.experience.map((r) => ({
      title: String(r.title || '').trim(), company: employerOf(r), start: r.start, end: r.end,
      type: `${r.employmentType || ''} ${r.group || ''}`, bullets: (r.bullets || []).map((b) => (typeof b === 'string' ? b : b?.text || '')).filter(Boolean),
    }));
  } else {
    let emp = [];
    try { emp = extractEmployment(text) || []; } catch { emp = []; }
    raw = emp.map((e) => ({ title: String(e.title || '').trim(), company: String(e.company || '').trim(), start: e.start_date, end: e.end_date, type: '', bullets: [] }));
  }
  const roles = [];
  for (const r of raw) {
    if (!PLAUSIBLE_TITLE(r.title)) continue;
    const s = monthIndex(r.start, { now }); let e = monthIndex(r.end, { end: true, now });
    if (s != null && e == null && !r.end) e = null;
    const ctx = `${r.company} ${r.bullets.join(' ')}`;
    let occs = classifyRoleTitle(r.title, ctx);
    if (!occs.length) {
      // The shared field reader on the role (its title, then what its bullets do).
      let fm = null;
      try { fm = roleField({ title: r.title, header: r.title, bullets: r.bullets }); } catch { fm = null; }
      if (fm) occs = [fieldOccupation(fm)];
    }
    // The occupation knowledge base (O*NET), by its trust contract: an `exact` answer is a fact and wins; a `close`
    // answer places only what neither this table nor the shared reader knows (military codes, formal titles).
    // Measured round 7 on the hidden half: `close` answers FIRST lowered precision and recall; this order holds them.
    const mod = moduleOccupation(r.title, { lines: r.bullets, employer: r.company });
    if (mod && ((mod.confidence === 'exact' && !finerThan(occs[0], mod.occ)) || !occs.length)) occs = [mod.occ];
    if (!occs.length && s == null) continue; // a header fragment with no dates and no field
    const kind = INTERN_RE.test(r.title) ? 'internship' : VOLUNTEER_RE.test(`${r.title} ${r.company} ${r.type}`) ? 'volunteer' : GIG_RE.test(`${r.title} ${r.company}`) ? 'gig' : 'regular';
    const current = /^(present|current|now)$/i.test(String(r.end || '').trim());
    const months = s != null && e != null && e >= s ? Math.max(1, e - s) : 0;
    roles.push({
      title: r.title.replace(/\s+/g, ' ').slice(0, 80), company: r.company.replace(/\s+/g, ' ').slice(0, 80) || null,
      occupations: occs.map((o) => o.id), family: occs[0]?.family || null,
      start: s != null ? `${yearOf(s)}-${String((s % 12) + 1).padStart(2, '0')}` : null,
      end: current ? 'present' : (e != null ? `${yearOf(e)}-${String((e % 12) + 1).padStart(2, '0')}` : null),
      current, years: Math.round((months / 12) * 10) / 10, kind,
      level: kind === 'internship' ? 0 : levelOf(r.title),
      managed: isPeopleManagerTitle(r.title) && !NOT_PEOPLE_MANAGER.test(normTitle(r.title)) || r.bullets.some((b) => MANAGED_RE.test(b)),
      trains: /\b(trainer|coach|instructor|teacher|training)\b/i.test(r.title) || r.bullets.some((b) => TRAINS_RE.test(b)),
      industries: industryOf(`${r.title} ${r.company} ${r.bullets.join(' ')}`),
      lines: r.bullets.slice(0, 8).map((b) => normLine(b)).filter((b) => b.length >= 12),
      _s: s, _e: e,
    });
  }
  return { roles, doc };
}

// Degree fields → the occupation a graduate or student is hired into at entry level.
const FIELD_OCC = [
  // degrees and programmes that NAME an occupation (a BSN is nursing, an A&P programme is aircraft maintenance)
  [/\b(nursing|bsn|adn|asn|registered nurse)\b/i, 'registered_nurse'],
  [/\bdental hygien\w*/i, 'dental_hygienist'],
  [/\bdental assist\w*/i, 'dental_assistant'],
  [/\bpharmacy tech\w*/i, 'pharmacy_tech'],
  [/\bcosmetology\b/i, 'cosmetologist'],
  [/\b(esthetics|aesthetics|esthetician)\b/i, 'esthetician'],
  [/\bbarber(ing)?\b/i, 'barber'],
  [/\b(aviation maintenance|airframe (and|&) powerplant|aircraft maintenance|a ?& ?p (program|school))\b/i, 'aircraft_mechanic'],
  [/\bparalegal\b/i, 'legal_assistant'],
  [/\b(radiolog\w* technolog\w*|surgical technolog\w*|sterile processing|medical laboratory)\b/i, 'med_tech'],
  [/\b(respiratory therapy|physical therapist assistant|occupational therapy assistant)\b/i, 'therapist_rehab'],
  [/\b(elementary education|secondary education|early childhood education|special education|teaching)\b/i, 'instructor'],
  [/\b(social work|counseling|counselling)\b/i, 'counselor'],
  [/\b(computer science|software|computer engineering|informatics)\b/i, 'software_engineer'],
  [/\b(data science|statistics|analytics)\b/i, 'data_analyst'],
  [/\b(information (technology|systems)|cybersecurity|network)\b/i, 'it_support'],
  [/\b(mechanical|aerospace|aeronautical)\b/i, 'mechanical_engineer'],
  [/\b(electrical|electronics)\b/i, 'electrical_engineer'],
  [/\bcivil\b/i, 'civil_engineer'],
  [/\b(industrial|manufacturing) engineering\b/i, 'manufacturing_engineer'],
  [/\b(accounting|accountancy)\b/i, 'accountant'],
  [/\b(finance|economics)\b/i, 'financial_analyst'],
  [/\b(marketing|advertising|public relations|communications?)\b/i, 'marketing'],
  [/\b(human resources)\b/i, 'hr_generalist'],
  [/\b(graphic design|visual (arts|design)|interior design)\b/i, 'designer'],
];
function educationKeys(doc, now) {
  const out = [];
  const nowMi = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (const e of (doc && Array.isArray(doc.education) ? doc.education : [])) {
    const blob = `${e.degree || ''} ${e.field || ''}`;
    if (!e.field && !e.degree) continue;
    if (/\b(high school|diploma|ged)\b/i.test(blob) && !e.field) continue;
    const endMi = monthIndex(e.end, { now });
    const studying = IN_PROGRESS_RE.test(`${blob} ${e.dateText || ''}`) || /coursework toward|currently/i.test(blob) || (endMi != null && endMi > nowMi) || (!e.end && /in progress/i.test(JSON.stringify(e)));
    if (/coursework toward/i.test(blob) && endMi != null && endMi < nowMi) continue; // unfinished, not studying now
    let occ = null;
    const details = (Array.isArray(e.details) ? e.details : []).map((d) => (typeof d === 'string' ? d : d?.text || '')).join(' ').slice(0, 200);
    for (const [re, id] of FIELD_OCC) if (re.test(`${e.field || ''} ${e.degree || ''} ${/\b(specialty|concentration|major|focus|emphasis|track)\b/i.test(details) ? details : ''}`)) { occ = id; break; }
    if (!occ) continue;
    out.push({ occupation: occ, degree: String(e.degree || '').slice(0, 60), field: String(e.field || '').slice(0, 60), school: String(e.school || '').slice(0, 60) || null, studying, year: endMi != null ? yearOf(endMi) : null });
  }
  return out;
}

// ── Applications ───────────────────────────────────────────────────────────────────────────────
function appliedKeys(applications, now) {
  const since = now.getTime() - APPLIED_DAYS * 86_400_000;
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(applications) ? applications : []) {
    const title = String(a?.role || a?.job_title || a?.title || '').trim();
    const company = String(a?.company_name || a?.company || '').trim();
    const at = a?.applied_at || a?.created_at || a?.at || null;
    const t = Date.parse(at || '');
    if (!title || !Number.isFinite(t) || t < since || t > now.getTime() + 86_400_000) continue;
    if (/^(test|test\d+)$/i.test(title) || /seen jobs/i.test(company)) continue;
    const occ = classifyTitle(title, company);
    if (!occ) continue;
    const key = `${normTitle(title)}|${normTitle(company)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ occupation: occ.id, family: occ.family, title: title.slice(0, 80), company: company.slice(0, 80) || null, at: new Date(t).toISOString().slice(0, 10), level: levelOf(title) });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 20);
}

/** The lines above the first section heading, plus the parser's summary — where a person says where they are going. */
function summaryText(text, doc) {
  const top = String(text || '').split(/\n\s*(?:experience|work experience|employment|professional experience|education)\s*\n/i)[0].slice(0, 800);
  return `${top} ${doc?.basics?.summary || ''} ${doc?.basics?.headline || ''}`;
}
/** The job types a stated intent names, chunk by chunk ("marketing coordinator, social media or sales development
 * role") — the title table, then the shared field reader; never a broad field list. */
function intentOccupations(phrase) {
  const out = new Set();
  // The whole phrase first ("food safety and quality assurance" is one field, not "food safety" + "quality assurance").
  const whole = String(phrase || '').replace(/\b(an?|the|entry[- ]level|junior|new|role|roles|position|positions|job|jobs|career|remote)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const w = whole.length >= 3 ? classifyRaw(whole, '') : null;
  if (w) return [w.id];
  for (const chunk of String(phrase || '').split(/,|\bor\b|\band\b|\//i)) {
    const c = chunk.replace(/\b(an?|the|entry[- ]level|junior|new|role|roles|position|positions|job|jobs|career|in|as|chicago|remote)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (c.length < 3) continue;
    const o = classifyRaw(c, '') || (/\bproject (management|coordination)|program management\b/i.test(c) ? OCC_BY_ID.get('project_manager') : null) || (/\bsocial media\b|\bmarketing\b/i.test(c) ? OCC_BY_ID.get('marketing') : null);
    if (o) { out.add(o.id); continue; }
    let fm = null; try { fm = postingField(c, ''); } catch { fm = null; }
    if (fm) out.add(fieldOccupation(fm).id);
  }
  return [...out];
}
/** The occupations a free-text field phrase names ("restaurant kitchens", "learning and development"). */
function domainOccupations(phrase) {
  const p = String(phrase || '');
  if (!p.trim()) return [];
  const out = new Set();
  const occ = classifyRaw(p, '');
  if (occ) out.add(occ.id);
  if (/\bproject (management|coordination)|program management\b/i.test(p)) out.add('project_manager');
  if (!out.size) { let fm = null; try { fm = postingField(p, ''); } catch { fm = null; } if (fm) out.add(fieldOccupation(fm).id); }
  for (const [re, ids] of DOMAINS) if (re.test(p)) for (const id of ids) out.add(id);
  if (/\b(kitchens?|restaurants?|culinary|food service)\b/i.test(p)) ['cook', 'food_crew', 'barista', 'server', 'dishwasher', 'host'].forEach((id) => out.add(id));
  if (/\b(l ?& ?d|learning (and|&) development|training|instructional design)\b/i.test(p)) ['corporate_trainer', 'instructional_designer'].forEach((id) => out.add(id));
  return [...out];
}

export function resumeHash(text) {
  return createHash('sha256').update(String(text || '').replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}
/** A signature of the applications that feed `applied` (so new / removed applications rebuild the keys). */
export function appliedSignature(applications, now = new Date()) {
  const keys = appliedKeys(applications, now).map((a) => `${a.occupation}|${a.title}|${a.company}|${a.at}`).sort();
  return createHash('sha256').update(keys.join('\n')).digest('hex').slice(0, 12);
}

/**
 * The person's job keys from their résumé text, recent applications and profile. Pure and deterministic
 * for the same inputs and `now`.
 * @returns {object} see the file header; `occupations` is what matching reads.
 */
// A licence, certificate or degree that names an occupation puts the person in that field, whatever their job
// titles say (round 10, principle 1). licence id → job type.
const LIC_OCC = {
  rn: 'registered_nurse', lpn: 'lpn', cna: 'cna', hha: 'caregiver', pharmacy_tech: 'pharmacy_tech', cosmetology: 'cosmetologist',
  esthetician: 'esthetician', barber: 'barber', nail_tech: 'nail_tech', massage: 'massage_therapist', faa_ap: 'aircraft_mechanic',
  rdh: 'dental_hygienist', rda: 'dental_assistant', cdl: 'truck_driver_cdl', cdl_a: 'truck_driver_cdl', journeyman_electrician: 'electrician',
  master_electrician: 'electrician', journeyman_plumber: 'plumber', master_plumber: 'plumber', guard_card: 'security_officer', emt: 'med_tech',
  cpa: 'accountant', real_estate: 'real_estate_agent', epa608: 'hvac_tech',
};
const NAMING_DEGREE_OCCS = new Set(['registered_nurse', 'dental_hygienist', 'dental_assistant', 'pharmacy_tech', 'cosmetologist', 'esthetician', 'barber', 'aircraft_mechanic', 'legal_assistant', 'med_tech', 'therapist_rehab', 'instructor', 'counselor', 'accountant']);
// The words a role's own lines use in that field (to place a role whose title the table cannot read — a military
// title, an employer's jargon — under the field its licence names).
const FIELD_LINE_WORDS = {
  registered_nurse: /\b(patients?|nurs\w*|clinical|ward|icu|med[- ]surg|triage|charting|telemetry)\b/i,
  lpn: /\b(patients?|med pass|residents?|wound)\b/i, cna: /\b(patients?|residents?|adls?|vitals)\b/i, caregiver: /\b(clients?|residents?|adls?|personal care)\b/i,
  aircraft_mechanic: /\b(aircraft|airframe|engines?|powerplant|avionics|helicopters?|turbines?|c-?130|f-?16|f-?35|uh-?60|black ?hawk|flight line)\b/i,
  cosmetologist: /\b(hair|color(ing)?|cuts?|salon|balayage|highlights|clients?)\b/i, esthetician: /\b(facials?|skin|wax\w*|lash\w*|peels?)\b/i,
  barber: /\b(fades?|beards?|clippers?|barber\w*|cuts?)\b/i, nail_tech: /\b(nails?|manicures?|pedicures?|acrylics?|gel)\b/i, massage_therapist: /\b(massage|bodywork)\b/i,
  dental_assistant: /\b(dental|chair-?side|x-?rays?|dentists?|impressions)\b/i, dental_hygienist: /\b(cleanings?|periodontal|scaling|hygien\w*)\b/i,
  pharmacy_tech: /\b(prescriptions?|pharmac\w*|medications?)\b/i, truck_driver_cdl: /\b(drove|driving|trucks?|tractor|haul\w*|routes?|convoys?|loads?)\b/i,
  electrician: /\b(wir\w*|conduit|panels?|electrical)\b/i, plumber: /\b(pip\w*|plumb\w*|fixtures?|drains?)\b/i, security_officer: /\b(patrol\w*|security|posts?|access control)\b/i,
  med_tech: /\b(steril\w*|patients?|ems|ambulance|imaging|specimens?)\b/i, accountant: /\b(ledger|reconcil\w*|tax|audit\w*|journal entr\w*)\b/i,
  real_estate_agent: /\b(listings?|buyers?|closings?|propert\w*)\b/i, hvac_tech: /\b(hvac|refrigerant|furnace|air condition\w*)\b/i,
  legal_assistant: /\b(legal|court|filings?|litigation|attorneys?|case files?)\b/i, instructor: /\b(students?|classroom|lessons?|curriculum|taught|teach\w*)\b/i,
  counselor: /\b(clients?|case ?load|counsel\w*|therapy)\b/i, therapist_rehab: /\b(patients?|therapy|rehab\w*)\b/i,
};
export function credentialFields(text, education) {
  const out = new Map(); // occupation → the credential that names it
  for (const id of resumeLicences(text)) { const o = LIC_OCC[id]; if (o && !out.has(o)) out.set(o, LIC_BY_ID.get(id)?.label || id); }
  for (const c of certDirections(credentialLines(text))) if (!out.has(c.occupation)) out.set(c.occupation, c.cred);
  for (const e of education || []) if (NAMING_DEGREE_OCCS.has(e.occupation) && !out.has(e.occupation)) out.set(e.occupation, `${e.degree ? `${e.degree} ` : ''}${e.field || ''}`.trim() || 'your degree');
  return out;
}
const SIDE_JOB_RE = /\b(part[- ]time|seasonal|summer|campus|student|work[- ]study|holiday)\b/i;

export function buildJobKeys({ resumeText = '', applications = [], profile = {}, now = new Date() } = {}) {
  const text = String(resumeText || '');
  const { roles, doc } = text.trim() ? resumeRoles(text, now) : { roles: [], doc: null };
  const nowMi = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const credFields = credentialFields(text, educationKeys(doc, now));
  if (credFields.size) {
    for (const r of roles) {
      if (r.kind === 'volunteer') continue;
      const unplaced = !r.occupations.length || r.occupations.every((id) => String(id).startsWith('field:') || String(id).startsWith('soc:')) || looksMilitary(`${r.title} ${r.company || ''}`);
      if (!unplaced) continue;
      const blob = `${r.title} ${(r.lines || []).join(' ')}`;
      for (const id of credFields.keys()) if (FIELD_LINE_WORDS[id] && FIELD_LINE_WORDS[id].test(blob) && !r.occupations.includes(id)) r.occupations.push(id);
    }
  }

  // Occupations held: years (overlaps once; internships and volunteer work count half), latest year, roles.
  const byOcc = new Map();
  roles.forEach((r, i) => {
    for (const id of r.occupations) {
      const cur = byOcc.get(id) || { iv: [], half: [], roles: [], level: 0, last: null, current: false };
      if (r._s != null && r._e != null) (r.kind === 'internship' || r.kind === 'volunteer' ? cur.half : cur.iv).push([r._s, r._e]);
      cur.roles.push(i);
      cur.level = Math.max(cur.level, r.level);
      const last = r.current ? yearOf(nowMi) : (r._e != null ? yearOf(r._e) : null);
      if (last != null && (cur.last == null || last > cur.last)) cur.last = last;
      if (r.current) cur.current = true;
      byOcc.set(id, cur);
    }
  });
  const occupations = [...byOcc.entries()].map(([id, v]) => {
    const o = OCC_BY_ID.get(id);
    const years = Math.round(((unionMonths(v.iv) + unionMonths(v.half) / 2) / 12) * 10) / 10;
    return { occupation: id, family: o?.family || null, label: o?.label || id, years, last_year: v.last, current: v.current, level: v.level, roles: v.roles, held: true };
  }).sort((a, b) => (b.current - a.current) || ((b.last_year || 0) - (a.last_year || 0)) || (b.years - a.years));

  const families = [];
  for (const o of occupations) {
    const f = families.find((x) => x.family === o.family);
    if (f) { f.years = Math.max(f.years, o.years); f.last_year = Math.max(f.last_year || 0, o.last_year || 0) || null; }
    else if (o.family) families.push({ family: o.family, years: o.years, last_year: o.last_year, held: true });
  }

  const regular = roles.filter((r) => r.kind !== 'internship' && r.kind !== 'volunteer');
  const specs = new Set();
  for (const r of roles) if (r.occupations.some((id) => TECH_OCCS.has(id))) for (const sp of specialisationsOf(r.title)) specs.add(sp);
  const latestEnd = (r) => (r.current ? nowMi : (r._e ?? -1));
  const lastEnd = regular.length ? Math.max(...regular.map(latestEnd)) : null;
  const currentLevel = lastEnd != null && lastEnd >= 0 ? Math.max(...regular.filter((r) => latestEnd(r) === lastEnd || r.current).map((r) => r.level)) : null;
  const allIv = regular.filter((r) => r._s != null && r._e != null).map((r) => [r._s, r._e]);
  const mgmtIv = roles.filter((r) => r.managed && r._s != null && r._e != null).map((r) => [r._s, r._e]);
  const trainIv = roles.filter((r) => r.trains && r._s != null && r._e != null).map((r) => [r._s, r._e]);
  const industries = {};
  for (const [name] of INDUSTRIES) {
    const iv = roles.filter((r) => r.industries.includes(name) && r._s != null && r._e != null).map((r) => [r._s, r._e]);
    if (iv.length) industries[name] = Math.round((unionMonths(iv) / 12) * 10) / 10;
  }
  const education = educationKeys(doc, now);
  const city = String(profile?.city || '').trim() || String(doc?.basics?.location || '').trim();

  // DIRECTION OF TRAVEL. Where the person is going: the field of their most recently started job (internships
  // count — a new graduate's audit internship), a degree completed after that job started, and any field the
  // summary says they are moving into. A field they LEFT (its last job ended before — or within a year of — the
  // new direction starting), or say they are "switching from", is never a match basis. A job held while
  // studying, in a different field from the degree they then completed, is a SIDE job: never the headline.
  const dirRoles = roles.filter((r) => r.kind !== 'volunteer' && r.kind !== 'gig' && r.occupations.length && r._s != null);
  const latestStart = dirRoles.length ? Math.max(...dirRoles.map((r) => r._s)) : null;
  const direction = new Set();
  for (const r of dirRoles) if (r._s === latestStart) r.occupations.forEach((id) => direction.add(id));
  let directionStart = latestStart;
  const degree = education.filter((e) => !e.studying && e.year).sort((a, b) => b.year - a.year)[0] || null;
  const degreeMi = degree ? degree.year * 12 + 4 : null;
  if (degree && latestStart != null && degreeMi >= latestStart - 12) { direction.add(degree.occupation); }
  // A job they still hold is their direction too — unless it is a job held through school in another field.
  for (const r of dirRoles) if (r.current && !(degree && r._s < degreeMi && !r.occupations.includes(degree.occupation) && direction.has(degree.occupation))) r.occupations.forEach((id) => direction.add(id));
  const head = summaryText(text, doc);
  const movingTo = intentOccupations((head.match(/\b(?:seeking|pursuing|looking for|moving into|transitioning into|switching (?:careers? )?(?:in)?to|(?:transitioning|moving|switching|pivoting|changing careers?) from [^.;\n]{3,60}? (?:in)?to)\s+(?:a |an )?(?:new )?(?:(?:career|role|position|job)\s)?(?:(?:in|as)\s)?([^.;\n]{3,120})/i) || [])[1]);
  const exitRe =
    // "leaving retail", "career change from nursing to…", "after 8 years in hospitality, I'm pursuing…", "ready to move on from teaching"
    /\b(?:(?:switching|transitioning|moving|pivoting|changing|stepping)\s+(?:careers?\s+)?(?:away\s+)?(?:from|out of)|career (?:change|changer|switch|pivot) from|leaving(?: behind)?(?: the| a)?|(?:ready|looking|eager) to (?:leave|move on from|move out of|transition out of)|after \d+\+? years? (?:in|as an?|of))\s+([^.;\n]{3,60}?)(?=\s+(?:in)?to\b|,|[.;\n]|\s+(?:and|i'?m|i am|now)\b|$)/i;
  const leaving = domainOccupations((head.match(exitRe) || [])[1]);
  for (const id of movingTo) if (!leaving.includes(id)) direction.add(id);
  // ORDER (round 10): stated target → the field a licence / certificate / degree names → the latest career role.
  // A student, seasonal or side job is never the direction when a credential names one.
  const credSide = (r) => SIDE_JOB_RE.test(`${r.title} ${r.company || ''} ${(r.lines || []).join(' ')}`)
    || (education.some((e) => credFields.has(e.occupation) && e.year && r._e != null && r._e <= e.year * 12 + 6 && !(r.occupations || []).includes(e.occupation)));
  if (credFields.size) {
    for (const id of credFields.keys()) if (!leaving.includes(id)) direction.add(id);
    for (const r of roles) if (!(r.occupations || []).some((id) => credFields.has(id)) && credSide(r)) for (const id of r.occupations) if (!credFields.has(id) && !movingTo.includes(id)) direction.delete(id);
  }
  // A field they say they are leaving is never their direction, even when it was their latest job.
  if (leaving.length && [...direction].some((id) => !leaving.includes(id))) for (const id of leaving) direction.delete(id);
  // UNKNOWN IS NOT A DIRECTION. When the most recently started job (or a newer degree) cannot be placed by the
  // table or the shared field reader, and the summary states no direction, the direction is unknown: older
  // fields are not promoted in its place, nothing is emailed, and the rail shows only listings whose title is
  // the current title's own job.
  const latestRolesAll = roles.filter((r) => r.kind !== 'volunteer' && r.kind !== 'gig' && r._s != null);
  const latestStartAll = latestRolesAll.length ? Math.max(...latestRolesAll.map((r) => r._s)) : null;
  const unplacedLatest = latestRolesAll.find((r) => r._s === latestStartAll && !r.occupations.length) || null;
  const noDirection = unplacedLatest && !movingTo.length && !(degree && degreeMi >= latestStartAll && direction.has(degree.occupation))
    ? { title: unplacedLatest.title, company: unplacedLatest.company || null } : null;
  for (const o of occupations) {
    const own = o.roles.map((i) => roles[i]).filter(Boolean);
    const lastEndMi = Math.max(...own.map((r) => (r.current ? nowMi : (r._e ?? -1))));
    const firstStartMi = Math.min(...own.map((r) => (r._s ?? Infinity)));
    o.left = !direction.has(o.occupation) && ((!o.current && directionStart != null && lastEndMi >= 0 && lastEndMi <= directionStart + 12) || leaving.includes(o.occupation));
    o.side = !o.left && !direction.has(o.occupation) && ((!!degree && direction.has(degree.occupation) && Number.isFinite(firstStartMi) && firstStartMi < degreeMi && lastEndMi <= degreeMi + 8)
      || (credFields.size > 0 && !credFields.has(o.occupation) && own.every((r) => credSide(r))));
  }

  return {
    v: JOB_KEYS_VERSION,
    built_at: now.toISOString(),
    resume_hash: text.trim() ? resumeHash(text) : null,
    applied_sig: appliedSignature(applications, now),
    roles: roles.map(({ _s, _e, ...r }) => r).slice(0, 15),
    occupations,
    families,
    applied: appliedKeys(applications, now),
    education,
    level: {
      highest: regular.length ? Math.max(...regular.map((r) => r.level)) : (roles.length ? 0 : null),
      current: currentLevel,
      managed_people: roles.some((r) => r.managed),
      management_years: Math.round((unionMonths(mgmtIv) / 12) * 10) / 10,
      training_years: Math.round((unionMonths(trainIv) / 12) * 10) / 10,
    },
    years_total: Math.round((unionMonths(allIv) / 12) * 10) / 10,
    direction: noDirection ? [] : [...direction],
    no_direction: noDirection,
    intent: movingTo.filter((id) => !leaving.includes(id)),
    summary_keys: summaryText(text, doc).split(/\n+/).map((l) => normLine(l)).filter((l) => l.length >= 20).slice(0, 8),
    industries,
    student: education.some((e) => e.studying),
    skills: [],
    specs: [...specs],
    credentials: resumeLicences(text),
    credential_lines: credentialLines(text),
    credential_fields: [...credFields.entries()].map(([occupation, cred]) => ({ occupation, cred })),
    cert_direction: certDirections(credentialLines(text)),
    home: { city: city.slice(0, 80) || null },
    never: [],
  };
}

/** Do the stored keys describe this résumé text and these applications, at this version? */
export function keysStale(keys, { resumeText = '', applications = null, now = new Date() } = {}) {
  if (!keys || typeof keys !== 'object') return true;
  if (keys.v !== JOB_KEYS_VERSION) return true;
  const hash = String(resumeText || '').trim() ? resumeHash(resumeText) : null;
  if ((keys.resume_hash || null) !== hash) return true;
  if (applications && keys.applied_sig !== appliedSignature(applications, now)) return true;
  return false;
}

// ── The posting side ───────────────────────────────────────────────────────────────────────────
// Domains a requirement sentence can name; each maps to the occupations whose years count for it.
const RETAIL_OCCS = ['cashier', 'retail_associate', 'grocery_clerk'];
const FOOD_OCCS = ['barista', 'cook', 'server', 'bartender', 'host', 'dishwasher', 'food_crew', 'restaurant_manager'];
const DOMAINS = [
  [/\b(cyber|information|network|application|cloud|product|it) ?security\b|\binfosec\b/i, ['security_engineer', 'security_analyst']],
  [/\bsecurity (industry|experience|operations|services|field|officer|guard|work)|\b(physical|private|armed|unarmed|protective) security\b|\bguard\b|\bloss prevention\b|\basset protection\b|\bsecurity\b(?![- ]?(clearance|engineer|architect|software))/i, ['security_officer', 'loss_prevention']],
  [/\b(nursing|acute care|med[- ]?surg|telemetry|icu|emergency department|clinical nursing|bedside)\b/i, ['registered_nurse', 'lpn', 'nurse_practitioner']],
  [/\b(patient care|caregiv\w*|home health|long[- ]term care|senior (living|care)|elderly|direct care|personal care)\b/i, ['cna', 'caregiver', 'lpn', 'registered_nurse']],
  [/\b(retail|store|sales floor|merchandising)\b/i, RETAIL_OCCS],
  [/\b(cash handling|cashier|pos|point of sale)\b/i, [...RETAIL_OCCS, ...FOOD_OCCS, 'bank_teller', 'valet']],
  [/\b(restaurant|food service|kitchen|culinary|line cook|cooking|fine[- ]dining|serving|server|bartend\w*|barista|food and beverage|food & beverage|qsr)\b/i, FOOD_OCCS],
  [/\b(warehouse|distribution|forklift|material handling|picking|packing|shipping|receiving)\b/i, ['warehouse_associate', 'inventory_specialist']],
  [/\b(inventory|cycle counts?|stock control)\b/i, ['inventory_specialist', 'warehouse_associate', 'retail_associate']],
  [/\b(driving|cdl|truck|tractor[- ]trailer|delivery|commercial driv\w*|class a)\b/i, ['truck_driver_cdl', 'delivery_driver']],
  [/\b(call center|contact center|call centre|customer support|help ?desk)\b/i, ['customer_service']],
  [/\b(customer service|customer[- ]facing|client[- ]facing|guest service)\b/i, ['customer_service', 'receptionist', 'hotel_front_desk', ...RETAIL_OCCS, ...FOOD_OCCS, 'bank_teller', 'valet', 'medical_receptionist']],
  [/\b(customer success|account management|saas)\b/i, ['customer_success', 'account_manager', 'account_executive']],
  [/\b(sales|quota|business development|selling)\b/i, ['sales_rep', 'account_executive', 'account_manager', 'sdr', 'retail_associate', 'insurance_agent', 'real_estate_agent']],
  [/\b(administrative|office|clerical|reception|data entry|executive support|workplace)\b/i, ['admin_assistant', 'receptionist', 'medical_receptionist', 'legal_assistant', 'office_manager', 'records_clerk']],
  [/\b(records?( management)?|court records|public records|court|document management|filing)\b/i, ['records_clerk', 'legal_assistant', 'medical_receptionist']],
  [/\b(school (administration|leadership|leader)|educational leadership|school administrator|district leader\w*|principal)\b/i, ['school_admin']],
  [/\b(hvac|heating|air conditioning|refrigeration)\b/i, ['hvac_tech']],
  [/\b(legal|litigation|law firm|paralegal)\b/i, ['legal_assistant', 'attorney']],
  [/\b(accounting|bookkeeping|accounts payable|accounts receivable|audit|reconciliation)\b/i, ['accountant']],
  [/\b(software (development|engineering)|programming|coding|back[- ]?end|front[- ]?end|full[- ]?stack|web development)\b/i, ['software_engineer', 'qa_engineer', 'sre', 'data_engineer']],
  [/\b(manufacturing|production|assembly|machining)\b/i, ['production_associate', 'quality_inspector', 'machinist', 'manufacturing_engineer']],
  [/\b(quality (control|assurance|inspection)|inspection)\b/i, ['quality_inspector', 'manufacturing_engineer', 'qa_engineer']],
  [/\b(maintenance|mechanical repair|facilities|industrial mechanic)\b/i, ['maintenance_tech', 'auto_mechanic', 'hvac_tech']],
  [/\b(automotive|vehicle|diesel)\b/i, ['auto_mechanic']],
  [/\belectrical (work|installation|construction|experience|trade)|\belectrician\b/i, ['electrician']],
  [/\b(marketing|social media|digital marketing|content|brand)\b/i, ['marketing']],
  [/\b(recruit\w*|talent acquisition|staffing)\b/i, ['recruiter', 'hr_generalist']],
  [/\b(human resources|\bhr\b|people operations)\b/i, ['hr_generalist', 'recruiter']],
  [/\b(teaching|classroom|education|tutoring|instruction)\b/i, ['instructor', 'tutor', 'teaching_assistant']],
  [/\b(child ?care|early childhood|daycare)\b/i, ['childcare', 'teaching_assistant']],
  [/\b(operations|logistics|supply chain)\b/i, ['operations', 'logistics_coordinator']],
  [/\b(hotel|hospitality|front desk)\b/i, ['hotel_front_desk', 'receptionist', 'housekeeper', ...FOOD_OCCS]],
  [/\b(housekeeping|janitorial|custodial|cleaning)\b/i, ['housekeeper']],
  [/\b(behavior(al)? (analysis|therapy|technician)|aba|autism)\b/i, ['behavior_tech', 'counselor']],
  [/\b(data analysis|analytics|business intelligence|sql)\b/i, ['data_analyst', 'data_scientist', 'data_engineer']],
  [/\b(banking|bank|financial services|payments|card (operations|services|programs?|issuing)|payment network|payment processing|fintech|lending|credit union|brokerage|investment operations|fund accounting)\b/i, ['bank_teller', 'financial_analyst', 'accountant']],
];
const JUNIOR_RE = /\b(apprentice|apprenticeship|trainee|in training|helper|aide|junior|jr|intern|internship|extern|co ?op|adjunct|entry level)\b/;
const ASSISTANT_OF_RE = /\bassistant (\w+ ){0,2}(manager|director|supervisor|superintendent|principal|controller)\b/;
const TECH_OCCS = new Set(['software_engineer', 'qa_engineer', 'sre', 'data_engineer', 'data_scientist', 'security_engineer']);
// Specialisations a software engineer does not hold by default (resumeJobMatch.js's list).
const DISTINCT_SPECS = new Set(['frontend', 'fullstack', 'mobile', 'embedded', 'ml', 'security', 'qa', 'game', 'field']);
const RETAIL_IDS = new Set(['cashier', 'retail_associate']);
const STORE_CUE = /\b(stores?|retail|shop|boutique|outlet|registers?|checkout|sales floor|merchandis\w*|planograms?|stocking shelves|shelves|grocery|supermarket|market|showroom|pos|point of sale|front end)\b/i;
// The junior job a person is promoted OUT of: holding the successor (as recently or later) means the junior
// listing is a step down, not a match — unless they applied to that kind of job lately.
const SUCCESSORS = {
  sdr: ['account_executive', 'account_manager'],
  sales_rep: ['account_executive'],
  customer_service: ['customer_success', 'account_manager'],
  cna: ['registered_nurse', 'lpn', 'nurse_practitioner', 'physician'],
  caregiver: ['registered_nurse', 'lpn', 'nurse_practitioner', 'physician'],
  medical_assistant: ['registered_nurse', 'lpn', 'nurse_practitioner', 'physician'],
  lpn: ['registered_nurse', 'nurse_practitioner'],
  registered_nurse: ['nurse_practitioner', 'physician'],
  teaching_assistant: ['instructor'],
  tutor: ['instructor'],
  receptionist: ['admin_assistant', 'legal_assistant'],
  delivery_driver: ['truck_driver_cdl'],
  it_support: ['software_engineer', 'sre', 'network_admin', 'security_engineer'],
  data_analyst: ['data_scientist', 'data_engineer'],
  production_associate: ['manufacturing_engineer'],
  quality_inspector: ['manufacturing_engineer'],
  dishwasher: ['cook'],
  host: ['server', 'bartender'],
};
const HOURLY_FAMILIES = new Set(['retail', 'food_service', 'warehouse', 'delivery_logistics', 'valet_parking', 'hospitality', 'customer_service', 'security', 'healthcare_support', 'skilled_trades', 'manufacturing', 'personal_services', 'fitness']);
const INDUSTRY_AGNOSTIC = new Set(['sales_operations', 'sales_engineer', 'account_manager', 'account_executive', 'sales_rep', 'sdr', 'customer_success', 'customer_service', 'admin_assistant', 'receptionist', 'operations', 'logistics_coordinator', 'project_manager', 'hr_generalist', 'recruiter', 'marketing', 'data_analyst', 'accountant', 'financial_analyst', 'it_support', 'instructor']);
// Industries a sales job is tied to: field sales in them takes years selling there (or a recent application).
export const INDUSTRIES = [
  ['life sciences', /\b(pharma\w*|therapeutics?|biotech\w*|biopharma\w*|medical devices?|med ?tech|life sciences|clinical (trials?|research)|oncology|specialty pharmacy|dermatology|cardiology|surgical (products|devices))\b/gi],
  ['insurance', /\b(insurance|underwrit\w*|policyholders?|claims adjust\w*|p&c|annuit\w*)\b/gi],
  ['real estate', /\b(real estate|realtors?|brokerage|property management|mortgages?)\b/gi],
  ['automotive', /\b(automotive|dealerships?|car sales|vehicle sales|auto dealers?)\b/gi],
  ['industrial', /\b(industrial (equipment|supply|supplies|products|distribution)|chemicals?|chemistry|lab(oratory)? (instruments|equipment)|oil and gas|heavy equipment)\b/gi],
];
const FIELD_SALES = new Set(['account_executive', 'account_manager', 'sales_rep', 'sdr', 'sales_engineer', 'customer_success']);
const SPECIAL_DOMAINS = [
  { id: 'security', re: /\b(physical security|security (officers?|guards?|services|solutions|provider|company|industry|operations|personnel|patrol|post orders?)|protective services|guard (services|card)|post orders|armed|unarmed)\b/gi, ids: ['security_officer', 'loss_prevention'] },
  { id: 'nursing', re: /\b(registered nurses?|rns?\b|lpns?|lvns?|nursing (staff|care|agency|services)|patient care|clinical staff)\b/gi, ids: ['registered_nurse', 'lpn', 'cna', 'caregiver', 'nurse_practitioner', 'medical_assistant', 'medical_receptionist'] },
  { id: 'trucking', re: /\b(cdl|tractor[- ]trailers?|over[- ]the[- ]road|otr|freight carrier|dispatch(ers)?|truckload)\b/gi, ids: ['truck_driver_cdl', 'delivery_driver', 'logistics_coordinator'] },
];
const MANAGEMENT_RE =/\b(supervis\w*|(?<!(records?|project|case|property|inventory|data|information|document|account|time|risk|change|quality|vendor|content|product|food safety|records) )management|managing|manager|leadership|leading (a )?teams?|people leader|lead(ing)? (a |an |the )?(\w+ ){0,2}(teams?|crews?|staff|shifts?|school|department|unit|squad|clerks|drivers|associates)|team lead)\b/i;
const NUM_WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15 };
// Every gap is a single optional space (\s?), so no two quantifiers can share the same characters (linear time).
const YEARS_RE = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)(?: ?\(\d{1,2}\))? ?(?:\+|plus|or more)? ?(?:(?:-|–|to) ?(?:\d{1,2}|two|three|four|five|six|seven|eight|ten) ?)?(?:years?|yrs?)\b/i;
const NOT_EXPERIENCE_RE = /\b(401 ?k|401\(k\)|vest\w*|pto|paid time off|vacation|tuition|of service|sign[- ]on|retention bonus|warranty|lease term|contract term|years? (old|of age|in business|of service to|serving)|founded|for (over|more than) \d+ years|age(d)? \d+|\d+ years? (warranty|lease|contract term)|celebrat\w+|anniversary|in operation|history of|legacy of|been (in business|around))\b/i;
const PREFERRED_RE = /\b(prefer\w*|a plus|nice to have|bonus|desired|ideally|ideal candidate|advantageous|is helpful|helpful)\b/i;

/** Required experience minimums a posting states: [{ years, domains: [occupation ids], management, text }]. */
const _minsMemo = new Map();
/** Memoised: the same listing is read for every person in a run (bounded, by title + text). */
export function statedMinimums(job) {
  const k = `${job?.title || ''}\u0001${job?.description || ''}`;
  if (_minsMemo.has(k)) return _minsMemo.get(k);
  const out = statedMinimumsRaw(job);
  if (_minsMemo.size > 4000) _minsMemo.clear();
  _minsMemo.set(k, out);
  return out;
}
function statedMinimumsRaw(job) {
  const desc = String(job?.description || '');
  const out = [];
  const seen = new Set();
  const add = (years, sentence) => {
    if (!Number.isFinite(years) || years < 1 || years > 30) return;
    const s = String(sentence || '').slice(0, 300);
    if (NOT_EXPERIENCE_RE.test(s)) return; // "401k match after one year of service" is a benefit, not a requirement
    const key = `${years}|${s.slice(0, 120).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const domains = new Set();
    const groups = [];
    for (const [re, ids] of DOMAINS) if (re.test(s)) { groups.push(ids); for (const id of ids) domains.add(id); }
    // "security or operations" = either; "operations experience in banking" = both.
    // "warehouse operations" / "food service management" is one field named twice, not two fields required
    const anyOf = groups.length < 2 || /\bor\b|\/|\beither\b|\bsimilar\b|\brelated\b/i.test(s) || !/\b(and|as well as|plus|both)\b|\b(in|within) (a |an |the )?\w+ (industry|setting|environment|company|firm)\b/i.test(s);
    // leading people is asked only when the clause that holds the number says so ("Lead the department; 5+ years
    // teaching mathematics" asks for teaching years, not management years)
    const clause = s.split(/[;.]\s+/).find((c) => /\d+\+?\s*(?:\(\d+\)\s*)?(years?|yrs?)|\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(years?|yrs?)/i.test(c)) || s;
    out.push({ years, domains: [...domains], groups, anyOf, management: MANAGEMENT_RE.test(clause), text: s });
  };
  // The optimizer's one reading of the posting (lib/optimizer/extractJobFacts.js), required years only.
  let facts = null;
  try { facts = extractJobFacts(desc, { jobTitle: String(job?.title || '') }); } catch { facts = null; }
  if (Array.isArray(facts)) {
    for (const f of facts) {
      if (f?.factType !== 'constraint' || f.kind !== 'years' || f.importance !== 'required') continue;
      const alts = Array.isArray(f.alternatives) ? f.alternatives : [];
      // "a degree OR 3 years" — a degree route exists; only a pure years requirement gates here.
      if (alts.some((a) => a && Number(a.degree) > 0 && !(Number(a.years) > 0))) continue;
      add(Number(f.value), f.evidence || f.label);
    }
  }
  // Backstop for sentences the reading leaves out (teasers, odd formatting): a stated minimum of years of
  // experience in a sentence that is not "preferred" and not a fact about the company.
  let preferredSection = false;
  for (const line of desc.replace(/\r/g, '').split(/\n+/)) {
    const head = line.trim();
    // A short heading line switches between required and preferred sections.
    if (head.length <= 60 && !/[.!?]$/.test(head) && /^[A-Z•\s]/.test(head)) {
      if (/\b(preferred|nice to have|bonus|desired|pluses|a plus|good to have|ideal|benefits|perks|what we offer|compensation|why join)\b/i.test(head)) { preferredSection = true; continue; }
      if (/\b(required|requirements|minimum|qualifications|must have|what you need|who you are|responsibilities|about|benefits|duties|skills)\b/i.test(head)) { preferredSection = false; }
    }
    if (preferredSection) continue;
    for (const s of sentencesOf(line)) {
    if (NOT_EXPERIENCE_RE.test(s) || PREFERRED_RE.test(s)) continue;
    const m = s.match(YEARS_RE);
    if (!m) continue;
    // "5+ years closing complex Enterprise deals", "2+ years supervising warehouse teams": a minimum of years
    // of doing something, with or without the word "experience" — but never "within 2 years", "every 3 years".
    const before = s.slice(Math.max(0, m.index - 14), m.index);
    if (/\b(within|after|every|per|over|next|first|last|past|for up to)\s$/i.test(before)) continue;
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 60);
    if (!/\bexperience|experienced\b/i.test(s) && !/^\s*(of\b|in\b|as\b|with\b|leading|managing|supervising|closing|selling|working|running|carrying|building|developing|teaching|training|driving|performing|providing|handling|serving|operating|\w+ing\b)/i.test(after)) continue;
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORD[m[1].toLowerCase()];
    add(n, s);
    }
  }
  // Keep the strictest per domain set (the optimizer and the backstop can read one sentence twice).
  return out;
}

/** Does the posting say no experience is needed / entry level? */
export function saysEntryLevel(job) {
  return /\b(no (prior |previous )?experience (is )?(required|necessary|needed)|entry[- ]level|will train|we train|training provided|paid training|no experience)\b/i.test(`${job?.title || ''} ${job?.description || ''}`);
}

// ── The match rule ─────────────────────────────────────────────────────────────────────────────
function roleSpan(r) {
  const a = r.start ? Number(r.start.slice(0, 4)) : null;
  if (r.current) return a ? `since ${a}` : 'now';
  const b = r.end ? Number(r.end.slice(0, 4)) : null;
  if (a && b) return a === b ? `${a}` : `${a}–${b}`;
  return a ? `${a}` : b ? `until ${b}` : '';
}
function roleSentence(r, { close = false } = {}) {
  const at = r.company ? ` at ${r.company}` : '';
  const span = roleSpan(r);
  if (close) return `Close to your ${r.title} job${at}${span ? ` (${span})` : ''}.`;
  if (r.current) return `You're ${article(r.title)} ${r.title}${at}${span ? ` (${span})` : ''}.`;
  return `You were ${article(r.title)} ${r.title}${at}${span ? ` (${span})` : ''}.`;
}
const fmtDay = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isFinite(d.getTime()) ? `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` : iso; };

const SUBJECT_STOP = new Set(['experience', 'experienced', 'related', 'relevant', 'professional', 'work', 'working', 'industry', 'field', 'role', 'roles', 'position', 'environment', 'setting', 'progressive', 'hands', 'direct', 'proven', 'minimum', 'least', 'years', 'year', 'with', 'from', 'that', 'this', 'including', 'similar', 'equivalent', 'combination', 'education', 'training', 'demonstrated', 'successful', 'strong', 'full', 'time', 'paid', 'post', 'recent', 'current']);
/** The specific subject of a years requirement ("sterile compounding", "tanker"), as stems — [] when generic. */
function subjectWords(text) {
  const m = String(text || '').match(/\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\+?\s*(?:\(\d+\)\s*)?(?:years?|yrs?)\s+(?:of\s+)?([a-z][a-z /&-]{3,50})/i);
  if (!m) return [];
  const words = m[1].toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !SUBJECT_STOP.has(w) && !/^(journey|level|including|such|plus|more|than|over|least|some|both|each|this|that|your|their|with|from|into|year|years)$/.test(w));
  // a gerund names the doing, not the subject ("Caring for ventilated patients", "Programming building automation")
  const nouns = words.filter((w) => !/ing$/.test(w));
  return (nouns.length ? nouns : words).slice(0, 2).map((w) => w.slice(0, 6));
}
const TITLE_NOUN_RE = /\b(manager|director|supervisor|lead|leader|engineer|nurse|technician|specialist|teacher|electrician|plumber|driver|accountant|analyst|developer|chef|cook|cashier|associate|representative|agent|officer|coordinator|administrator|principal|attorney|paralegal|pharmacist|therapist|mechanic|operator|clerk|teller|banker|recruiter|designer|consultant|advisor|architect|scientist|foreman|superintendent|producer|hygienist|instructor)s?\b/i;
/** "3+ years as a restaurant general manager" / "in a supervisory role" → the title asked for, or null. */
export function asTitleOf(text) {
  const m = String(text || '').match(/\b(?:as an?|as the|in an?)\s+([a-z][a-z /&-]{2,50}?)(?:\s+(?:role|position|capacity))?(?=\s+(?:required|preferred|is required|or higher|or above|with|at|in|for)\b|[.,;:)]|$)/i);
  if (!m) return null;
  const p = m[1].trim();
  if (/\b(or equivalent|or similar|or related|or comparable)\b/i.test(p) || !TITLE_NOUN_RE.test(p)) return null;
  return p;
}
function yearsAsTitle(keys, phrase, now) {
  const want = classifyRaw(phrase, '');
  const lv = levelOf(phrase);
  const idx = (keys.roles || []).map((r, i) => {
    if (r.kind === 'volunteer') return -1;
    if (sameJobTitle(phrase, r.title)) return i;
    if (want && (r.occupations || []).includes(want.id) && (r.level || levelOf(r.title)) >= lv) return i;
    return -1;
  }).filter((i) => i >= 0);
  return titleYearParts(keys, idx, now).reduce((a, p) => a + p.years, 0);
}
/** Years the person has in a set of occupations (their own years in each; overlaps are not added). */
function yearsIn(keys, ids) {
  let best = 0;
  for (const o of keys.occupations || []) if (ids.includes(o.occupation)) best = Math.max(best, Number(o.years) || 0);
  return best;
}
function groupOf(occId) {
  const o = OCC_BY_ID.get(occId);
  return o ? [o.id, ...o.adj] : [occId];
}
/**
 * "2+ years of cath lab or interventional radiology nursing": the field (nursing) comes with a specialty in front
 * of it. Each "or" alternative must be the field alone, or its specialty words must be on the résumé.
 */
function qualifierUnmet(text, keys) {
  const m = String(text || '').match(/\b(?:years?|yrs?)\s+(?:of\s+|in\s+|as\s+(?:an?\s+)?)?([a-z][a-z /&-]{2,80})/i);
  if (!m) return false;
  const phrase = m[1].split(/\b(?:in|within|at|for|with|including|experience|preferred|required)\b|[,;:(]/i)[0].trim();
  if (!phrase) return false;
  const hay = [...(keys.roles || []).flatMap((r) => [r.title, ...(r.lines || [])]), ...(keys.credential_lines || []), ...(keys.summary_keys || [])].map(normLine).join(' ');
  const alts = phrase.split(/\s+or\s+|\s*\/\s*/i).map((x) => x.trim()).filter(Boolean);
  const words = (x) => String(x).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !SUBJECT_STOP.has(w) && !/^(and|the|any|all|both|general|hands|daily|full|cycle|similar|related|clinical|direct|team|teams|level|journey|working|building|facility|facilities|light|other)$/.test(w));
  const okAlt = (alt) => {
    // only the words IN FRONT of the field word are a specialty ("cath lab … nursing"); words after it are the
    // field's own ("warehouse operations", "nursing in a hospital")
    let at = -1;
    for (const [re] of DOMAINS) { const h = alt.match(new RegExp(re.source, 'i')); if (h && (at < 0 || h.index < at)) at = h.index; }
    if (at < 0) return alts.length > 1 && !false ? words(alt).every((w) => hay.includes(w.slice(0, Math.max(4, Math.min(6, w.length))))) : true;
    const rest = alt.slice(0, at);
    if (!rest.trim()) return true;
    return words(rest).every((w) => hay.includes(w.slice(0, Math.max(4, Math.min(6, w.length)))));
  };
  return !alts.some(okAlt);
}
// No shortfall inside a match: every stated minimum is met in full (round 5 — a match never prints a number under the ask).
const meets = (have, need) => have >= need;

/**
 * THE match rule (rail and email). Pure: no I/O. Place and liveness are the caller's (placeMatch / the read).
 * @param {object} job  a jobs row (title, company, description, …)
 * @param {object} keys buildJobKeys(...)
 * @returns {{ ok: true, occupation: string, basis: 'title'|'held'|'close'|'applied'|'education', reason: string, rank: number, need: number|null, have: number|null }
 *          | { ok: false, why: string }}
 */
// Entry-rung words: a title carrying one is a rung under a title in the same job type that does not.
const LOW_RUNG_RE = /\b(development representative|equipment operator|adjunct|intern|co ?op|apprentice|helper|trainee|(?<!process )assistant|installer|clerk|associate|laborer|aide|coordinator|receptionist|tier 1|material handler|picker|packer|junior|jr|entry level)\b/;
const rungOf = (t) => { const n = normTitle(t); if (ASSISTANT_OF_RE.test(n) && !JUNIOR_RE.test(n)) return levelOf(t) * 2 + 1; return levelOf(t) * 2 - (LOW_RUNG_RE.test(n) ? 1 : 0); };
/**
 * Step-down computed from the person's own history: a listing in a job type where they held a title and were
 * then promoted (a later title in the same job type, a higher rung — or the next title at the same employer),
 * when the listing IS that old title (same job noun) or carries the same entry-rung kind of word the old title
 * carried and the newer title does not. A title they hold now is never a step-down.
 */
const ENTRY_POSTING_RE = /\b(no (prior |previous )?experience (is )?(required|needed|necessary)|no experience\b|entry[- ]level (position|role|job)|we will train you|will train the right)/i;
export function stepDownFromHistory(title, occId, keys, now = new Date(), desc = '') {
  // The ladder: their roles in this job type and its close neighbours (cashier → key holder → assistant store
  // manager crosses three of this table's job types; it is one ladder).
  const o0 = OCC_BY_ID.get(occId);
  const near = new Set([occId, ...(o0?.adj || []), ...OCCUPATIONS.filter((o) => (o.adj || []).includes(occId)).map((o) => o.id)]);
  const roles = (keys?.roles || []).filter((r) => (r.occupations || []).some((id) => near.has(id)) && r.kind !== 'internship' && r.kind !== 'volunteer');
  if (roles.length < 2) return false;
  const mi = (v) => (v ? monthIndex(v, { now }) : null);
  // The title itself with its level words ("Senior Accountant" is not "Staff Accountant"), qualifiers dropped.
  const strongKey = (t) => normTitle(String(t || '').replace(/\([^)]*\)/g, ' ').split(/\s+[-–—|]\s+|,/)[0]);
  const lt = normTitle(title); const lNoun = strongKey(title);
  const lLow = LOW_RUNG_RE.test(lt);
  const nouns = new Set((keys.roles || []).filter((r) => r.current).map((r) => strongKey(r.title)));
  if (nouns.has(lNoun)) return false;
  // "Senior X" → "X" at another employer is the same job (a senior pharmaceutical rep and a pharmaceutical rep)
  const plain = (t) => strongKey(t).replace(/\b(senior|sr|ii|iii|iv)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if ((keys.roles || []).some((r) => r.current && plain(r.title) === plain(title))) return false;
  const top = latestRole(roles);
  // A manager's ladder: the supervisory rung under their management job, which they held on the way up
  // (a store manager → "Keyholder", having been an assistant store manager).
  if (levelOf(top.title) >= 3 && levelOf(title) < levelOf(top.title) && /\b(lead|leader|supervisor|key ?holder|assistant (\w+ ){0,2}manager|foreman|crew chief|charge)\b/.test(lt)
    && roles.some((r) => r !== top && levelOf(r.title) === levelOf(title))) return true;
  for (const old of roles) {
    if (old === top) continue;
    const oS = mi(old.start); if (oS == null) continue;
    const later = roles.filter((r) => r !== old && mi(r.start) != null && mi(r.start) > oS);
    const promoted = later.some((r) => rungOf(r.title) > rungOf(old.title) || (r.company && old.company && normTitle(r.company).split(' ')[0] === normTitle(old.company).split(' ')[0] && jobNounKey(r.title) !== jobNounKey(old.title)));
    if (!promoted) continue;
    if (strongKey(old.title) === lNoun) return true;
    // An entry-level posting ("no experience required") in a ladder they have climbed.
    if (ENTRY_POSTING_RE.test(desc) && rungOf(title) < rungOf(top.title) && rungOf(title) <= rungOf(old.title) + 1) return true;
    // the same entry-rung word as the old title ("Warehouse Associate" after "Fulfillment Associate"), not merely any
    const oldMark = (normTitle(old.title).match(LOW_RUNG_RE) || [])[0]; const lMark = (lt.match(LOW_RUNG_RE) || [])[0];
    if (ENTRY_POSTING_RE.test(desc) && lLow && oldMark && oldMark === lMark && (old.occupations || []).includes(occId) && !LOW_RUNG_RE.test(normTitle(top.title)) && rungOf(title) <= rungOf(old.title)) return true;
  }
  return false;
}
export function matchListing(job, keys, { now = new Date(), alert = false, mode = 'rail' } = {}) {
  if (!job || !keys) return { ok: false, why: 'no_input' };
  const title = String(job.title || '').trim();
  if (!title) return { ok: false, why: 'no_title' };
  const desc = String(job.description || '');
  const occ = classifyListing(title, job.company || '', desc);
  if (!occ || occ.id === 'ai_training') return { ok: false, why: 'field_unknown' };
  // A job that manages managers ("hire and develop 30 crew and 4 managers") is a level above a plain manager.
  const managesManagers = /\b(hire|hiring|develop\w*|lead\w*|supervis\w*|manag\w*|oversee\w*|coach\w*|direct\w*)\b[^.\n]{0,60}\b(\d+\s+)?(assistant |shift |department |restaurant |store |unit |area )?managers\b/i.test(desc);
  const oneSiteDirector = /\bdirector\b/i.test(title) && /\b(store|restaurant|location|site|branch|franchise|unit|clinic|center|centre|shop|cafe|property|hotel)\b/i.test(`${title} ${desc.slice(0, 400)}`);
  const listLevel = oneSiteDirector && !managesManagers ? Math.min(3, levelOf(title)) : Math.max(levelOf(title), managesManagers ? 4 : 0);
  const nowYear = now.getUTCFullYear();
  const occs = keys.occupations || [];

  // (a) Field: held, close neighbour, applied to, or studied.
  // A field counts as held when the work was real: six months or more, current, or within the last year.
  const appliedHere = (id) => (keys.applied || []).some((a) => a.occupation === id);
  const substantial = (o) => o.held && (!o.left || appliedHere(o.occupation)) && (o.years >= 0.5 || o.current || (o.last_year && nowYear - o.last_year <= 1));
  let held = occs.find((o) => o.occupation === occ.id && substantial(o));
  // A neighbouring field lends its years only when that work is recent (last 3 years) or long (2+ years).
  const lends = (o) => substantial(o) && (o.current || o.years >= 2 || (o.last_year && nowYear - o.last_year <= 3));
  let close = held ? null : occs.filter((o) => lends(o) && ((OCC_BY_ID.get(o.occupation)?.adj || []).includes(occ.id) || (OCC_BY_ID.get(occ.id)?.adj || []).includes(o.occupation)))
    .sort((a, b) => b.years - a.years)[0] || null;
  // A store or restaurant manager runs operations: a multi-unit / area OPERATIONS manager role is next to it.
  let closeOps = null;
  if (!held && !close && occ.id === 'operations' && listLevel >= 3) closeOps = occs.find((o) => substantial(o) && ['retail_associate', 'cashier', 'grocery_clerk', 'food_crew', 'cook', 'barista', 'hotel_front_desk', 'restaurant_manager'].includes(o.occupation) && (o.level || 0) >= (oneSiteDirector ? 2 : 3)) || null;
  if (!close && closeOps) close = closeOps;
  // Where one side was placed only by the shared field reader ("field:…"), the FIELD decides: the same field
  // is the job they hold; a field the reader calls adjacent is a neighbour.
  if (!held && !close) {
    const lk = primaryField(occ);
    const fieldLevel = occs.filter((o) => substantial(o) && (String(o.occupation).startsWith('field:') || occ.fieldKey));
    held = fieldLevel.filter((o) => primaryField(occupation(o.occupation)) === lk).sort((a, b) => b.years - a.years)[0] || null;
    if (!held) close = fieldLevel.filter((o) => lends(o) && areAdjacent(primaryField(occupation(o.occupation)), lk) && primaryField(occupation(o.occupation)) !== lk).sort((a, b) => b.years - a.years)[0] || null;
  }
  // THE PERSON'S OWN JOB INSIDE THE LISTING TITLE ("LPN" → "LPN Charge Nurse", "RN" → "RN Team Lead",
  // "Math Teacher" → "Math Department Chair"): when a job they hold names itself in the listing title — or its
  // licence does — and the listing sits in the same family of work, the field is theirs and the extra words are
  // a LEVEL, which the level rules below judge from their history.
  if (!held && !close) {
    const lt = ` ${normTitle(title)} `;
    const LEVEL_WORDS = /^(senior|sr|junior|jr|lead|head|chief|staff|principal|i|ii|iii|iv|the|of|and|team|charge|shift)$/;
    for (const o of occs.filter((x) => substantial(x) && (x.current || (keys.direction || []).includes(x.occupation)))) {
      const def = OCC_BY_ID.get(o.occupation);
      const sameFamily = !!def && (def.family === occ.family || String(occ.id).startsWith('field:') || String(occ.id).startsWith('soc:'));
      if (!sameFamily) continue;
      const lic = def?.lic && /^(rn|lpn|cna|rdh|np)$/.test(def.lic) ? def.lic : null;
      const named = (o.roles || []).map((i) => keys.roles[i]).filter(Boolean).some((r) => {
        const words = jobNounKey(r.title).split(' ').filter((w) => w && !LEVEL_WORDS.test(w));
        return words.length && words.every((w) => lt.includes(` ${w} `) || lt.includes(` ${w}s `));
      }) || (lic && lt.includes(` ${lic} `));
      if (named) { held = o; break; }
    }
  }
  const applied = (keys.applied || []).find((a) => a.occupation === occ.id) || null;
  // A degree opens entry-level work in its field only for students, recent graduates (within a year) and
  // people with under a year of regular work — never for a 10-year support lead with a 2016 B.A.
  const eduOk = (e) => e.studying || (e.year && nowYear - e.year <= 1) || (Number(keys.years_total) || 0) < 1;
  let edu = (keys.education || []).find((e) => e.occupation === occ.id && eduOk(e)) || null;
  // "<Field> Research Assistant" for a recent graduate in that field (psychology, biology, economics…)
  if (!edu && occ.id === 'research_assistant') edu = (keys.education || []).find((e) => eduOk(e) && e.field && String(e.field).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5).some((w) => normTitle(title).includes(w.slice(0, 6)))) || null;
  // Transferable work (TRANSFER): teaching → training / learning design when they applied to it lately;
  // training people inside another job (a support lead who onboards agents) → trainer roles.
  const transfer = held || close ? null : transferFrom(keys, occ.id, !!applied, nowYear);
  if (keys.no_direction && !alert) {
    // Direction unknown: only the current title's own job (its job-noun words), or a job type applied to lately.
    const cur = (keys.roles || []).findIndex((r) => r.title === keys.no_direction.title);
    if (!applied) {
      if (cur < 0 || !sameJobTitle(title, keys.no_direction.title)) return { ok: false, why: 'no_direction' };
      const role = keys.roles[cur];
      const roleYears = titleYearParts(keys, [cur], now)[0]?.years || 0;
      if (listLevel > (role.level || 1) + 1) return { ok: false, why: 'level' };
      for (const m of statedMinimums(job)) if (!(roleYears >= m.years)) return { ok: false, why: `years:${m.years}`, need: m.years, have: roleYears };
      const lic0 = requiredLicences(job).filter((id) => !(keys.credentials || []).includes(id));
      if (lic0.length) return { ok: false, why: `licence:${lic0[0]}` };
      return { ok: true, occupation: occ.id, basis: 'title', reason: roleSentence(role), rank: 400, need: null, have: null, level: listLevel, summaryOnly: isTeaser(job), side: false };
    }
  }
  // A field the summary says they are moving into ("transitioning into project management"): entry level only,
  // like a field they applied to.
  const intent = (keys.intent || []).includes(occ.id) || (keys.intent || []).some((id) => String(id).startsWith('field:') && id === `field:${primaryField(occ)}`);
  // A named certification of this job's line of work, for someone with no job in it yet: an ENTRY job only.
  const cert = (keys.credential_fields || []).find((c) => c.occupation === occ.id) || (keys.cert_direction || []).find((c) => c.occupation === occ.id || (OCC_BY_ID.get(c.occupation)?.adj || []).includes(occ.id)) || null;
  let basis = held ? 'held' : close ? 'close' : transfer && !applied ? 'transfer' : applied ? 'applied' : intent ? 'intent' : edu ? 'education' : cert ? 'credential' : alert ? 'alert' : null;
  // SIDE-STEP (the knowledge base's 'related'): a different occupation O*NET lists as related to a job they hold
  // now, accepted only when the résumé states that target or holds a credential the posting names (HACCP for a
  // food-safety technician, CDL for a driver). The reason says which job it steps from and why.
  // THE POSTING NAMES THEIR FIELD AS QUALIFYING ("2 years of retail or restaurant supervisory experience"): the
  // field gate is answered by the posting itself when they have a job in one of the fields its years sentence names.
  // (Never for a job a field reaches only by transfer when they did not ask — a teacher is not sent trainer jobs unasked.)
  if (!basis && !(TRANSFER[occ.id] || []).some((r) => r.needApplied)) {
    for (const m of statedMinimums(job)) {
      // the alternatives must be FIELDS listed before "experience" ("retail or restaurant supervisory experience"),
      // not tools or subjects ("programming experience in PLC or industrial controllers")
      const alt = m.text.match(/\b((?:[a-z]+,\s*)*[a-z]+\s+or\s+[a-z]+)\s+(?:(?:supervisory|management|leadership|customer[- ]facing|front[- ]line|work|industry)\s+)?experience\b/i);
      if (!m.domains.length || !alt) continue;
      const o = occs.filter((x) => substantial(x) && m.domains.includes(x.occupation) && DOMAINS.some(([re, ids]) => ids.includes(x.occupation) && re.test(alt[1]))).sort((a, b) => b.years - a.years)[0];
      if (o) { close = o; basis = 'posting'; break; }
    }
  }
  if (!basis) return { ok: false, why: 'different_field' };
  if (keys.no_direction && basis !== 'applied' && basis !== 'alert' && basis !== 'intent') return { ok: false, why: 'no_direction' };
  // A field they left four or more years ago for other work (an electrician's warehouse job in 2015, a
  // retail lead's call-center year in 2016) is behind them — unless they applied to that kind of job lately.
  const fieldOcc = held || close;
  if (fieldOcc && !applied && !fieldOcc.current && fieldOcc.last_year && nowYear - fieldOcc.last_year >= 4
    && occs.some((o) => o !== fieldOcc && substantial(o) && (o.current || (o.last_year && o.last_year > fieldOcc.last_year)))) return { ok: false, why: 'left_field' };
  if ((keys.never || []).includes(occ.id)) return { ok: false, why: 'never' };
  // Their own old title in a field they left (a lube tech's Jiffy Lube years before HVAC) is behind them, even
  // when a neighbour of their current job makes it look close.
  if (!applied && !(keys.direction || []).includes(occ.id)) {
    const lNoun = jobNounKey(title);
    const oldLeft = (keys.roles || []).some((r) => !r.current && jobNounKey(r.title) === lNoun && (r.occupations || []).length
      && (r.occupations || []).every((id) => { const o = occs.find((x) => x.occupation === id); return o && (o.left || o.side); }));
    if (oldLeft) {
      // the rung under a job they hold NOW in the same line of work is a step down, not a field left
      const nearNow = (keys.roles || []).some((r) => r.current && (r.occupations || []).some((id) => id === occ.id || (OCC_BY_ID.get(id)?.adj || []).includes(occ.id) || (OCC_BY_ID.get(occ.id)?.adj || []).includes(id)));
      return { ok: false, why: nearNow ? 'step_down_held' : 'left_field' };
    }
  }

  // (a2) A tech listing that names a specialisation the person's tech titles never held (frontend for a
  // backend engineer, embedded, ML, security…) is a different job.
  if (TECH_OCCS.has(occ.id) && (basis === 'held' || basis === 'close')) {
    const mine = new Set(keys.specs || []);
    if (mine.size) {
      // A frontend / mobile developer has not held backend, data or SRE work either.
      const clientOnly = [...mine].every((x) => ['frontend', 'mobile', 'fullstack'].includes(x));
      const specTitle = String(title).split(/\s+[-–—|]\s+|,|\(|\)/).filter((seg) => !/\bteam\b/i.test(seg)).join(' ');
      const foreign = [...specialisationsOf(specTitle)].filter((s) => (DISTINCT_SPECS.has(s) || (clientOnly && ['backend', 'data', 'sre'].includes(s))) && !mine.has(s) && !(s === 'frontend' && mine.has('fullstack')));
      if (foreign.length) return { ok: false, why: `specialisation:${foreign[0]}` };
      if (clientOnly && (basis === 'close' || /\b(observability|infrastructure|devops|platform|distributed|back[- ]?end|data|hpc|cloud|kernel|compiler)\b/i.test(title))) return { ok: false, why: 'specialisation:backend' };
    }
  }

  // A title they hold NOW is never a step down, whatever its rung words ("Assistant General Manager" for an AGM).
  const holdsNow = (keys.roles || []).some((r) => r.current && sameJobTitle(title, r.title) && jobNounKey(title) === jobNounKey(r.title));
  // (a3) STEP-DOWN: the junior job they were promoted out of (an account executive's SDR years, an RN's
  // patient-care-tech job in school, a teacher's aide years), or a listing two levels under where they
  // work now — unless they applied to that kind of job lately.
  if (!applied && !holdsNow) {
    const juniorLast = held ? (held.current ? nowYear : held.last_year || 0) : -1;
    const promoted = (SUCCESSORS[occ.id] || []).some((sid) => {
      const s = occs.find((o) => o.occupation === sid && substantial(o));
      return s && (s.current ? nowYear : s.last_year || 0) >= juniorLast;
    });
    if (promoted) return { ok: false, why: 'step_down' };
    // STEP-DOWN IS A RULE: the person's own job type with a junior marker (apprentice, trainee, helper, aide,
    // junior, "in training", "assistant <manager>") while they hold or held the full title is a step down —
    // journeyman plumber → "Plumbing Apprentice", pharmacy technician → "Technician Trainee".
    const tl = normTitle(title);
    const marker = JUNIOR_RE.test(tl) || ASSISTANT_OF_RE.test(tl);
    const fieldOcc = held || close;
    if (marker && fieldOcc) {
      // an "assistant <manager>" title is a step down only from a job above it (a principal → assistant principal),
      // never for a shift supervisor, for whom an assistant manager job is the next rung up
      const assistantOnly = !JUNIOR_RE.test(tl) && ASSISTANT_OF_RE.test(tl);
      const fullHeld = (fieldOcc.roles || []).map((i) => keys.roles[i]).filter(Boolean).some((r) => !JUNIOR_RE.test(normTitle(r.title)) && !ASSISTANT_OF_RE.test(normTitle(r.title)) && r.kind !== 'internship' && (r.current || r.years >= 0.5) && (!assistantOnly || (r.level || levelOf(r.title)) > listLevel));
      if (fullHeld) return { ok: false, why: 'step_down_junior' };
    }
    const cur = Number(keys.level?.current);
    if (Number.isFinite(cur) && listLevel >= 1 && listLevel <= cur - 2 && (held || close) && !(held && held.left)) return { ok: false, why: 'step_down_level' };
    // Below EVERY job they held in the last five years, in a field they hold: a step down (an assistant after a
    // specialist, an SDR after a senior field rep, an equipment operator after an E-5 logistics specialist).
    if ((held || close) && !(keys.intent || []).includes(occ.id)) {
      // only an entry-rung title (assistant, associate, clerk, operator, development representative…) under a history
      // that is all specialist / senior / lead or higher — never a lateral move between two plain jobs
      const recent = (keys.roles || []).filter((r) => r.kind === 'regular' && (r.current || (r.end && nowYear - Number(String(r.end).slice(0, 4)) <= 5)));
      const seniorish = (r) => (r.level || levelOf(r.title)) >= 2 || /\b(specialist|senior|sr|lead|supervisor|manager|coordinator|analyst|executive|officer|engineer|technician)\b/i.test(r.title);
      const latest = latestRole(recent);
      // (measured: judging every recent job cost recall on both halves; the latest job alone held it)
      const pool5 = latest ? [latest] : [];
      // In their OWN job type a rung word (clerk, coordinator, representative, assistant) is the employer's naming;
      // it is a step down only when what the listing ASKS sits clearly below their history (an entry posting, or at
      // most a year asked of someone with four or more).
      const ownType = !!held && held.occupation === occ.id;
      const asksBelow = () => ENTRY_POSTING_RE.test(desc) || (() => { const ms = statedMinimums(job); const mx = ms.length ? Math.max(...ms.map((m) => m.years)) : 0; return mx <= 1 && (Number(held.years) || 0) >= 4; })();
      if (LOW_RUNG_RE.test(normTitle(title)) && pool5.length && pool5.every((r) => seniorish(r) && !LOW_RUNG_RE.test(normTitle(r.title)) && rungOf(r.title) > rungOf(title)) && (!ownType || asksBelow())) return { ok: false, why: 'step_down_level' };
    }
    // THE PERSON'S OWN LADDER: a rung they held in this job type and were promoted out of (their own earlier
    // title, or the same entry-rung kind of title — "Warehouse Associate" for a Tier 1 associate made PA).
    if (stepDownFromHistory(title, occ.id, keys, now, desc)) return { ok: false, why: 'step_down_held' };
  }

  // (b) Licences the posting requires.
  const creds = new Set(keys.credentials || []);
  for (const o of occs) {
    if (!(o.years > 0)) continue;
    for (const l of LICENCES) if (l.implied.includes(o.occupation)) creds.add(l.id);
  }
  // A role titled with a licence grade holds it ("Journeyman Electrician", "Master Plumber", "Class A Driver").
  for (const r of keys.roles || []) {
    if (!(r.years > 0) && !r.current) continue;
    for (const l of LICENCES) if (l.impliedTitle && l.impliedTitle.test(r.title)) creds.add(l.id);
  }
  for (const id of [...creds]) for (const lower of LICENCE_COVERS[id] || []) creds.add(lower);
  const lic = requiredLicences(job).filter((id) => !creds.has(id));
  if (lic.length) return { ok: false, why: `licence:${lic[0]}` };
  for (const need of requiredNamedCredentials(job)) if (!namesCredential(need, keys)) return { ok: false, why: `credential:${need.kind === 'degree' ? 'degree' : (need.acr[0] || need.words.join(' '))}` };
  for (const need0 of requiredStateCredentials(job)) {
    const lines = (keys.credential_lines || []).join('\n');
    if (need0.kind === 'state' && /\b(compact|multistate|multi-state)\b/i.test(need0.text) && /\b(compact|multistate|multi-state)\b/i.test(lines)) continue;
    if (need0.kind === 'state' && !(new RegExp(`\\b${escapeRegExp(need0.state)}\\b`, 'i').test(lines) || new RegExp(`\\b${escapeRegExp(need0.code)}\\b`).test(lines))) return { ok: false, why: `licence:state:${need0.code}` };
    if (need0.kind === 'permit' && !lines.toLowerCase().includes(need0.words)) return { ok: false, why: 'licence:permit' };
  }

  // (b2) A title that does not name an industry ("Account Manager", "Operations Coordinator") at an
  // employer whose posting is about a licensed field (a security company, a nursing agency, a carrier):
  // the job is that field's work, even when the posting is only a teaser. No years there → not a match.
  if (INDUSTRY_AGNOSTIC.has(occ.id)) {
    for (const d of SPECIAL_DOMAINS) {
      const hits = (desc.match(d.re) || []).length + (d.re.test(String(job.company || '')) ? 2 : 0);
      d.re.lastIndex = 0;
      if (hits >= 3 && !(yearsIn(keys, d.ids) > 0)) return { ok: false, why: `industry:${d.id}` };
    }
  }
  // (b2b) Field sales tied to a specialised industry (a therapeutics territory, an insurance book, a dealership):
  // years selling in that industry, or a recent application there.
  if (FIELD_SALES.has(occ.id) && !(applied && industryOf(`${applied.title} ${applied.company || ''}`).length)) {
    for (const ind of industryOf(`${job.company || ''} ${job.company || ''} ${desc}`, 3)) {
      if (!(Number(keys.industries?.[ind]) > 0)) return { ok: false, why: `industry:${ind}` };
    }
  }
  // (b3) A "sales associate" at a construction-rental yard is not store work: a retail title whose readable
  // posting never mentions a store, shop, register or customers on a floor is not the retail job.
  if (RETAIL_IDS.has(occ.id) && desc.length >= 700 && !/(…|\.\.\.)$/.test(desc.trim()) && !STORE_CUE.test(`${job.company || ''} ${desc}`)) return { ok: false, why: 'not_store_work' };

  // (c) Level: one step above the highest level held in this field; managers need people-management.
  const fieldOccs = held ? [held] : close ? [close] : [];
  const fieldLevel = fieldOccs.length ? Math.max(...fieldOccs.map((o) => Number(o.level) || 0)) : basis === 'alert' ? (Number(keys.level?.highest) || 1) : (basis === 'education' && edu?.studying ? 0 : 1);
  if (listLevel === 0) {
    const recentGrad = (keys.education || []).some((e) => e.studying || (e.year && nowYear - e.year <= 1));
    if (!recentGrad || ((keys.years_total || 0) >= 3 && !keys.student)) return { ok: false, why: 'internship_for_experienced' };
  } else {
    if (basis === 'education' && edu?.studying) return { ok: false, why: 'student_not_entry' };
    const ceiling = basis === 'close' && close === closeOps ? fieldLevel + 1
      : basis === 'transfer' ? Math.min(2, transfer.level)
      : basis === 'applied' ? (transfer ? Math.max(1, Math.min(2, transfer.level)) : 1)
      : basis === 'education' || basis === 'intent' || basis === 'credential' ? 1 : basis === 'close' ? fieldLevel : fieldLevel + 1; // 'posting' and 'held': one rung up
    if (listLevel > ceiling) return { ok: false, why: 'level' };
    // "Director of Marketing" / "Director, HR" manages managers across a company — it takes years of leading people;
    // "Director of Operations" of one store or franchise location is one step above a store / restaurant manager.
    if (listLevel >= 4 && /\bdirector\b/.test(normTitle(title))) {
      const oneSite = /\b(store|restaurant|location|site|branch|franchise|unit|clinic|center|centre|shop|cafe|property|hotel|school)\b/i.test(`${title} ${desc.slice(0, 400)}`);
      if (!oneSite && (Number(keys.level?.management_years) || 0) < 8) return { ok: false, why: 'level' };
    }
    if (listLevel >= 3 && !(keys.level?.managed_people)) return { ok: false, why: 'management' };
    // A supervisor / manager title means managing people: the résumé must show it. A "lead" title: managing or training people.
    const nt = normTitle(title);
    if (/\b(supervisor|foreman|superintendent|manager)\b/.test(nt) && !NOT_PEOPLE_MANAGER.test(nt) && !(keys.level?.managed_people)) return { ok: false, why: 'management' };
    if (/\blead\b/.test(nt) && listLevel >= 2 && !(keys.level?.managed_people) && !(Number(keys.level?.training_years) > 0)) return { ok: false, why: 'management' };
    // A senior / lead / manager title takes years in the field, even when the posting does not say how many.
    if (basis === 'held' || basis === 'close' || basis === 'posting') {
      const hourly = HOURLY_FAMILIES.has(occ.family);
      const needForLevel = listLevel >= 4 ? 8 : listLevel === 3 ? (hourly ? 2 : 5) : listLevel === 2 ? (hourly ? 1 : 3) : 0;
      const fy = (held || close).years;
      if (needForLevel && fy < needForLevel) return { ok: false, why: 'level_years' };
    }
  }

  // (d) Every stated required minimum of years, in its own field. Years are one occupation's own years
  // (never added across jobs), and the reason says which job they come from.
  const mins = statedMinimums(job);
  const group = held ? groupOf(occ.id) : close ? [close.occupation, occ.id] : [occ.id];
  let need = null; let have = null; let haveFrom = null; let needSubject = false;
  const checked = []; // every stated minimum this rule met, with the years it credited and whether it named a subject
  if (basis === 'intent' && (listLevel > 1 || !(saysEntryLevel(job) || /\b(entry[- ]level|junior|jr|assistant|associate|coordinator|trainee|apprentice|intern)\b/i.test(title)))) return { ok: false, why: 'intent_not_entry' };
  if (basis === 'intent' && !saysEntryLevel(job)) return { ok: false, why: 'intent_not_entry' };
  if ((basis === 'intent' || basis === 'credential') && mins.length) {
    // A stated move into a new field: a minimum is met only by years the résumé shows in the field the sentence
    // names ("1+ year in food production or food service" — a chef's kitchen years), or by leading people.
    for (const m of mins) {
      const per = (m.groups && m.groups.length ? m.groups : (m.domains.length ? [m.domains] : [])).map((g) => bestYears(keys, g));
      let h = per.length ? per.reduce((a, b) => (b.years > a.years ? b : a)) : null;
      if (m.management) { const mg = { years: Number(keys.level?.management_years) || 0, occ: 'management' }; h = h ? (h.years < mg.years ? h : mg) : mg; }
      if (!h) return { ok: false, why: 'years_unproven' };
      if (!(h.years > 0) || !meets(h.years, m.years)) return { ok: false, why: `years:${m.years}`, need: m.years, have: h.years };
      checked.push({ years: m.years, have: h.years, text: m.text, subject: true });
      if (need == null || m.years > need) { need = m.years; have = h.years; haveFrom = h.occ; needSubject = true; }
    }
    if (listLevel > 2) return { ok: false, why: 'level' };
  } else if ((basis === 'applied' && !transfer) || basis === 'education' || basis === 'intent') {
    if (mins.length) return { ok: false, why: 'years_unproven' };
    if (listLevel > 1) return { ok: false, why: 'level' };
  } else if (basis === 'transfer' || basis === 'applied') {
    // Only the transferable years count, and only for a minimum in this field or in no named field.
    for (const m of mins) {
      // A minimum in a field the person really worked ("2 years of call center experience") is met by their
      // own years there; a training / teaching minimum, or one in no named field, by the transferable years.
      const named = m.domains.length && !m.domains.some((d) => TRAINING_DOMAIN.has(d));
      let h = { years: transfer.years, occ: transfer.from };
      if (named) {
        const per = (m.groups && m.groups.length ? m.groups : [m.domains]).map((g) => bestYears(keys, g));
        h = m.anyOf === false ? per.reduce((x, y) => (y.years < x.years ? y : x)) : per.reduce((x, y) => (y.years > x.years ? y : x));
      }
      if (m.management) { const mg = Number(keys.level?.management_years) || 0; if (mg < h.years) h = { years: mg, occ: 'management' }; }
      if (!(h.years > 0) || !meets(h.years, m.years)) return { ok: false, why: `years:${m.years}`, need: m.years, have: h.years };
      if (need == null || m.years > need) { need = m.years; have = h.years; haveFrom = h.occ; }
    }
  } else {
    for (const m of mins) {
      // "3+ years as a restaurant general manager": years IN THAT ROLE — months in the title or in its job type at
      // that level — never leading people in another job.
      const asTitle = asTitleOf(m.text);
      if (asTitle) {
        const y = yearsAsTitle(keys, asTitle, now);
        if (!meets(y, m.years)) return { ok: false, why: `years_as_title:${m.years}`, need: m.years, have: y };
      }
      let groups = Array.isArray(m.groups) && m.groups.length ? m.groups : (m.domains.length ? [m.domains] : []);
      // "HR experience in manufacturing": an industry after "in / within" is a setting, not a second field.
      if (groups.length > 1 && /\b(in|within) (a |an |the )?(manufactur\w*|healthcare|retail|hospitality|tech\w*|financial services|banking|nonprofit|government)\b/i.test(m.text)) {
        groups = groups.filter((g) => !g.includes('production_associate') && !g.includes('bank_teller'));
      }
      // The listing's own job type counts alone where the sentence names it ("2+ years of account management"
      // for an account manager = years as an account manager, not retail sales). A minimum is checked in the LISTING's job: a neighbour's years count only where the sentence names a
      // field the neighbour is in ("1+ year of retail experience" — a cashier's years); a minimum in no named
      // field is the listing's own job ("4+ years" on a deal-desk posting is deal-desk years).
      const own = occ.id;
      const per = groups.map((g) => {
        if (held && g.includes(occ.id)) return bestYears(keys, [occ.id]);
        if (close && g.includes(occ.id)) return bestYears(keys, g.filter((id) => group.includes(id)));
        const inside = g.filter((id) => group.includes(id));
        return bestYears(keys, inside.length ? inside : g);
      });
      let h = null;
      if (per.length) h = m.anyOf === false ? per.reduce((a, b) => (b.years < a.years ? b : a)) : per.reduce((a, b) => (b.years > a.years ? b : a));
      if (m.management) {
        const mg = { years: Number(keys.level?.management_years) || 0, occ: 'management' };
        // "2+ years leading drivers or dispatch" for a squad leader of drivers: leading people in this very job
        // type meets it, even when the other field named (dispatch) is not theirs
        h = h && !(h.years === 0 && held && m.anyOf && (keys.roles || []).some((r) => r.managed && (r.occupations || []).includes(occ.id))) ? (h.years < mg.years ? h : mg) : mg;
      } else if (!h) {
        h = bestYears(keys, [own]);
        // A subject no field table names ("1+ year sterile compounding", "2+ years tanker experience"): only the
        // roles whose title or bullets name it count.
        const subj = subjectWords(m.text);
        if (subj.length) {
          const idx = (keys.roles || []).map((r, i) => (subj.every((w) => `${normLine(r.title)} ${(r.lines || []).join(' ')}`.includes(w)) ? i : -1)).filter((i) => i >= 0);
          const y = titleYearParts(keys, idx, now).reduce((a, p) => a + p.years, 0);
          h = { years: Math.min(h.years, y), occ: idx.length ? `subject:${subj[0]}` : own };
        }
      }
      // "1+ year building software, including internships": internship months count in full.
      if (/\binternships?\b/i.test(m.text) && h && !m.management) {
        const o = (keys.occupations || []).find((x) => x.occupation === (held || close)?.occupation);
        if (o) h = { years: Math.max(h.years, titleYearParts(keys, o.roles, now).reduce((a, p) => a + p.years, 0)), occ: h.occ };
      }
      // "4+ years as a licensed master electrician": years AT that grade, from the roles titled with it.
      const grade = (m.text.match(GRADE_RE) || [])[1];
      if (grade) {
        const gradeRoles = (held || close)?.roles || [];
        const y = gradeYears(keys, gradeRoles, grade, now);
        h = { years: y, occ: `grade:${grade.toLowerCase()}` };
      }
      if (m.domains.length && !m.management && qualifierUnmet(m.text, keys)) return { ok: false, why: `years_specialty:${m.years}`, need: m.years, have: 0 };
      if (!(h.years > 0) || !meets(h.years, m.years)) return { ok: false, why: `years:${m.years}`, need: m.years, have: h.years };
      checked.push({ years: m.years, have: h.years, text: m.text, subject: !!(m.domains.length || grade || m.management || String(h.occ || '').startsWith('subject:')) });
      if (need == null || m.years > need) { need = m.years; have = h.years; haveFrom = h.occ; needSubject = !!(m.domains.length || grade || m.management); }
    }
  }
  // A TEASER (a ~500-char summary: Adzuna rows, cut-off previews) hides its requirements — the GSG incident.
  // Email mode returns it flagged `summaryOnly`; the cron reads the full posting and runs this rule again,
  // and drops it when that fails or the posting cannot be read. The rail shows one only for the person's own
  // current title or a job type they applied to, and says it is a summary.
  const teaser = isTeaser(job);
  // ONE teaser decision for the rail and the email (the email may never accept what the rail refuses): a summary
  // is enough only for a job they hold or held at the same level (the same title), or the job type they hold now /
  // say they are moving into at or under their level, or a job type they applied to. The cron reads the full
  // posting before sending; when it cannot, a same-title teaser rides only as a non-headline line.
  let sameRung = false;
  if (teaser && basis !== 'alert') {
    const pool = held && !held.left && !held.side ? held : (close && !close.left && !close.side ? close : null);
    sameRung = !!pool && (pool.roles || []).some((i) => keys.roles[i] && sameJobTitle(title, keys.roles[i].title) && (keys.roles[i].level || levelOf(keys.roles[i].title)) === listLevel);
    const inDirection = (keys.direction || []).includes(occ.id) && (basis === 'intent' || ((basis === 'held' || basis === 'title') && !!held?.current));
    if (!sameRung && basis !== 'applied' && !(inDirection && listLevel <= fieldLevel)) return { ok: false, why: 'teaser' };
  }

  // A job alert's own field (the person chose the words): requirements checked, the alert is the reason.
  if (basis === 'alert') return { ok: true, occupation: occ.id, basis, reason: '', rank: 0, need, have, level: listLevel };

  // The reason — built from the keys, never from the listing alone.
  const roles = keys.roles || [];
  let reason = ''; let rank = 0; let side = false;
  if (basis === 'posting') {
    const best = latestRole(close.roles.map((i) => roles[i]).filter(Boolean));
    if (!best) return { ok: false, why: 'no_reason' };
    const named = (mins.find((m) => m.domains.includes(close.occupation))?.text || '').match(/\b(?:of|in)\s+([a-z][a-z ,/-]{3,60}?)\s+experience\b/i);
    reason = `${roleSentence(best)} The posting counts ${named ? named[1].trim() : 'your kind of'} experience.`;
    if (need != null) reason += ` ${yearsClause(keys, need, have, haveFrom, now, needSubject)}`;
    rank = 230 + (close.current ? 60 : 0);
  } else if (basis === 'held' || basis === 'close') {
    const o = held || close;
    const best = latestRole(o.roles.map((i) => roles[i]).filter(Boolean));
    if (!best) return { ok: false, why: 'no_reason' };
    const own = o.roles.map((i) => roles[i]).filter(Boolean);
    const sameTitle = own.some((r) => sameJobTitle(title, r.title));
    reason = roleSentence(best, { close: basis === 'close' });
    if (need != null) reason += ` ${yearsClause(keys, need, have, haveFrom, now, needSubject)}`;
    if (basis === 'held' && sameTitle) basis = 'title';
    const lastYear = o.current ? nowYear : (o.last_year || 0);
    // Recent work outranks an old title match: a 2017 job is a weaker reason than today's.
    rank = (basis === 'title' ? 300 : basis === 'held' ? 250 : 180) + (o.current ? 120 : Math.max(0, 120 - (nowYear - lastYear) * 25)) + Math.min(20, o.years * 3);
    // Where they are going outranks where they have been; a job held through school is never the headline.
    if ((keys.direction || []).includes(o.occupation)) rank += 150;
    // A job held only through school, before a degree in another field, is behind them (labelling rule 2).
    if (o.side && !applied) return { ok: false, why: 'side_job' };
    if (o.side) { rank -= 300; side = true; }
  } else if (basis === 'transfer') {
    const r = transfer.role;
    const at = r.company ? ` at ${r.company}` : '';
    const span = roleSpan(r);
    reason = `You ${transfer.kind === 'teach' ? 'teach' : 'train people'} as ${article(r.title)} ${r.title}${at}${span ? ` (${span})` : ''}.`;
    if (need != null) reason += ` ${haveFrom === transfer.from ? `They ask for ${need}+ year${need === 1 ? '' : 's'}; you have ${yearsWords(have)} ${transfer.kind === 'teach' ? 'teaching' : 'training people'}.` : yearsClause(keys, need, have, haveFrom, now)}`;
    rank = 190;
  } else if (basis === 'credential') {
    const intern = latestRole((keys.roles || []).filter((r) => r.kind === 'internship' && (r.occupations || []).some((id) => id === occ.id || id === cert.occupation)));
    reason = `You hold ${cert.cred}${intern ? ` and interned as ${article(intern.title)} ${intern.title}${intern.company ? ` at ${intern.company}` : ''}` : ''}.`;
    if (need != null) reason += ` ${yearsClause(keys, need, have, haveFrom, now, needSubject)}`;
    rank = 205;
  } else if (basis === 'intent') {
    // every clause is a check that passed: the stated target, and the posting's own entry-level statement
    reason = `Your summary says you're moving into ${occ.label.replace(/ work$/, '')}, and this posting says it is entry level.`;
    if (need != null) reason += ` ${yearsClause(keys, need, have, haveFrom, now, needSubject)}`;
    rank = 210;
  } else if (basis === 'applied') {
    reason = `Similar to the ${applied.title} job${applied.company ? ` at ${applied.company}` : ''} you applied to on ${fmtDay(applied.at)}.`;
    if (need != null && transfer) reason += ` ${haveFrom === transfer.from ? `They ask for ${need}+ year${need === 1 ? '' : 's'}; you have ${yearsWords(have)} ${transfer.kind === 'teach' ? 'teaching' : 'training people'}.` : yearsClause(keys, need, have, haveFrom, now)}`;
    rank = 200;
  } else {
    reason = edu.studying
      ? `An internship in your field: you're studying ${edu.field || edu.degree}${edu.school ? ` at ${edu.school}` : ''}.`
      : `Entry level in your field: your ${[edu.degree, edu.field].filter(Boolean).join(' in ')}${edu.year ? ` (${edu.year})` : ''}.`;
    rank = 170;
  }
  if (applied && basis !== 'applied') rank += 15; // like something they applied to recently
  if (basis === 'education' || basis === 'applied' || basis === 'transfer') { if ((keys.direction || []).includes(occ.id)) rank += 150; }
  return { ok: true, occupation: occ.id, basis, reason, rank, need, have, haveFrom, level: listLevel, summaryOnly: teaser, sameRung, side, checked };
}

/** Industries a text is about: names with at least `min` hits (a company name counts twice when passed twice). */
export function industryOf(text, min = 1) {
  const out = [];
  for (const [name, re] of INDUSTRIES) { const n = (String(text || '').match(re) || []).length; re.lastIndex = 0; if (n >= min) out.push(name); }
  return out;
}

/** A summary, not a posting: an Adzuna teaser, a cut-off preview, or under 700 characters. */
export function isTeaser(job) {
  const d = String(job?.description || '').replace(/\s+/g, ' ').trim();
  if (isDescriptionPreview(job) || /(…|\.\.\.)$/.test(d)) return true;
  // A short posting that is not cut off and states what it asks for ("1 year of restaurant leadership experience",
  // "RN license required") is the whole posting, not a summary.
  if (d.length < MIN_FULL) return !(d.length >= 60 && /\b(\d+\+?\s*(years?|yrs?|months?)|required|must have|license|licence|certification|no experience|experience)\b/i.test(d));
  return false;
}
const MIN_FULL = 700;

// Transferable work → job types it carries into. `needApplied`: only when they applied to that job type
// in the last 60 days (a teacher is not sent trainer jobs unasked); `trains`: a role whose bullets say
// they train, coach or onboard people (outside teaching).
const TEACHING = ['instructor', 'tutor', 'teaching_assistant', 'instructional_designer'];
const TRANSFER = {
  corporate_trainer: [{ from: TEACHING, needApplied: true, kind: 'teach' }, { trains: true }],
  instructional_designer: [{ from: ['instructor', 'corporate_trainer'], needApplied: true, kind: 'teach' }],
};
const TRAINER_FAMILIES = new Set(['customer_service', 'administrative', 'sales', 'hr', 'healthcare_support', 'clinical', 'training', 'operations', 'it']);
const TRAINING_DOMAIN = new Set(['instructor', 'tutor', 'teaching_assistant', 'corporate_trainer', 'instructional_designer']);
function transferFrom(keys, target, applied, nowYear) {
  const rules = TRANSFER[target];
  if (!rules) return null;
  const roles = keys.roles || [];
  for (const rule of rules) {
    if (rule.needApplied && !applied) continue;
    if (rule.from) {
      const o = (keys.occupations || []).filter((x) => rule.from.includes(x.occupation) && x.years > 0 && (x.current || (x.last_year && nowYear - x.last_year <= 3))).sort((a, b) => b.years - a.years)[0];
      if (!o) continue;
      const role = latestRole(o.roles.map((i) => roles[i]).filter(Boolean));
      if (role) return { kind: rule.kind || 'teach', years: o.years, from: o.occupation, level: o.level || 1, role };
    }
    if (rule.trains) {
      // A lead / supervisor in office, support, sales, HR or care work who trains people — not a cashier who
      // showed two new hires the register.
      const list = roles.filter((r) => r.trains && r.kind !== 'volunteer' && (r.level || 1) >= 2 && TRAINER_FAMILIES.has(r.family) && !r.occupations.some((id) => TEACHING.includes(id)) && (r.current || (r.end && nowYear - Number(String(r.end).slice(0, 4)) <= 3)));
      const role = latestRole(list);
      const years = Number(keys.level?.training_years) || 0;
      if (role && years > 0) return { kind: 'trains', years, from: 'training', level: role.level || 1, role };
    }
  }
  return null;
}

/** The most recent role of a set (current first, then the latest end). */
function latestRole(list) {
  const endKey = (r) => (r.current ? '9999' : String(r.end || r.start || ''));
  return [...list].sort((a, b) => endKey(b).localeCompare(endKey(a)))[0] || null;
}
/** One occupation's own years, the best of a set → { years, occ }. */
function bestYears(keys, ids) {
  let best = { years: 0, occ: null };
  for (const o of keys.occupations || []) if (ids.includes(o.occupation) && (Number(o.years) || 0) > best.years) best = { years: Number(o.years) || 0, occ: o.occupation };
  return best;
}
/** Shown years: whole years, at least 1 (a stated minimum is never met by under half a year). */
/** Shown years: floored to the half year, never rounded up (3.5 → "3.5", 7.3 → "7"). */
export const shownYears = (y) => Math.floor((Number(y) || 0) * 2) / 2;
const yearsWords = (y) => { const n = shownYears(y); return n < 1 ? 'under a year' : `about ${n} year${n === 1 ? '' : 's'}`; };
/** "They ask for 3+ years; you have about 4 as a Cashier." — the number and the job both come from the keys. */
function yearsClause(keys, need, have, from, now = new Date(), subject = false) {
  const ask = `They ask for ${need}+ year${need === 1 ? '' : 's'}`;
  if (from === 'management') {
    const r = latestRole((keys.roles || []).filter((x) => x.managed));
    return `${ask} leading people; you have ${yearsWords(have)}${r ? `, most recently as ${article(r.title)} ${r.title}` : ''}.`;
  }
  // Years are said per exact job title, from the dated roles — never a promotion ladder summed into the top title.
  let idx = [];
  if (String(from || '').startsWith('grade:')) {
    const g = from.slice(6);
    idx = (keys.roles || []).map((r, i) => (new RegExp(`\\b${escapeRegExp(g)}\\b`, 'i').test(r.title) ? i : -1)).filter((i) => i >= 0);
  } else {
    const o = (keys.occupations || []).find((x) => x.occupation === from);
    idx = o ? o.roles : [];
  }
  const parts = titleYearParts(keys, idx, now);
  if (!parts.length) return '';
  const said = parts.slice(0, 2).map((p) => `${yearsWords(p.years)} as ${article(p.title)} ${p.title}`);
  // Two titles: say the total first, so "1.5 as a Line Cook and under a year as a Prep Cook" never reads as short.
  // never an "in all" total against a requirement with a subject (years OF recruiting, OF tanker driving)
  if (!subject && parts.length >= 2 && shownYears(have) >= 1 && shownYears(have) > Math.max(...parts.slice(0, 2).map((p) => shownYears(p.years)))) return `${ask}; you have about ${shownYears(have)} year${shownYears(have) === 1 ? '' : 's'} in all — ${said.join(' and ')}.`;
  return `${ask}; you have ${said.join(' and ')}.`;
}

/** Years per exact job title among some roles, most recent title first: [{ title, years }]. */
export function titleYearParts(keys, roleIdx, now = new Date()) {
  const nowMi = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const groups = new Map();
  for (const i of roleIdx) {
    const r = (keys.roles || [])[i];
    if (!r) continue;
    // The same job title in several roles is one job ("Warehouse Associate" + "Warehouse Associate (temp)").
    const k = normTitle(String(r.title).replace(/\([^)]*\)/g, ' ')) || jobNounKey(r.title);
    const g = groups.get(k) || { title: r.title, iv: [], last: -1 };
    const s = r.start ? monthIndex(r.start, { now }) : null;
    const e = r.current ? nowMi : (r.end ? monthIndex(r.end, { now }) : null);
    if (s != null && e != null && e >= s) g.iv.push([s, e]);
    g.last = Math.max(g.last, e ?? -1);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({ title: g.title, years: Math.round((unionMonths(g.iv) / 12) * 10) / 10, last: g.last }))
    .sort((a, b) => b.last - a.last).map(({ title, years }) => ({ title, years }));
}
// Licence grades in a years requirement ("as a licensed master electrician", "journeyman experience").
const GRADE_RE = /\b(master|journeyman)\b/i;
function gradeYears(keys, roleIdx, grade, now) {
  const re = new RegExp(`\\b${escapeRegExp(grade)}\\b`, 'i');
  const idx = roleIdx.filter((i) => re.test((keys.roles || [])[i]?.title || ''));
  return titleYearParts(keys, idx, now).reduce((a, p) => Math.max(a, p.years), 0);
}
// "an HR Manager", "an MRI Tech", "a Unit Supervisor": by sound, for initialisms too.
const article = (w) => { const x = String(w || '').trim(); if (/^(hr|hvac|mri|rn|lpn|lvn|fbi|nfl|mba|md|ms|ma|emt|lvn|sre|seo|sdr|x-ray|f|lpc|lcsw|rbt|ehs|fsqa)\b/i.test(x)) return 'an'; if (/^(uni|use|usu|eu|one|once)/i.test(x)) return 'a'; return /^[aeiou]/i.test(x) ? 'an' : 'a'; };

// The job noun of a title, for "is this the person's own job?": the part before " - ", ",", "|", "(" (a shift,
// site or specialty qualifier is not the job), level and schedule words dropped, trade word order made one
// ("electrical journeyman" = "journeyman electrician"), words sorted.
const NOUN_SYNONYMS = [[/\belectrical journeyman\b/g, 'journeyman electrician'], [/\bjourneyman electrical\b/g, 'journeyman electrician'], [/\bkey ?holder\b/g, 'keyholder'], [/\bfront ?end\b/g, 'frontend'], [/\bback ?end\b/g, 'backend'], [/\bfull ?stack\b/g, 'fullstack'], [/\brn\b/g, 'registered nurse'], [/\bcna\b/g, 'certified nursing assistant']];
export function jobNounKey(t) {
  let h = normTitle(String(t || '').replace(/\([^)]*\)/g, ' ').split(/\s+[-–—|]\s+|,|\|/)[0]);
  for (const [re, to] of NOUN_SYNONYMS) h = h.replace(re, to);
  h = h.replace(/\b(senior|sr|junior|jr|i|ii|iii|iv|part time|full time|seasonal|temporary|temp|remote|hybrid|\d+(st|nd|rd|th)?|shift|days|nights|night|weekend|ft|pt|level|per diem|prn|travel|the|of|and|&)\b/g, ' ');
  return h.split(/\s+/).filter(Boolean).sort().join(' ');
}
/** Same job: the job nouns are equal, or one's words all sit in the other's (either part of a "/" title). */
export function sameJobTitle(listing, role) {
  const a = jobNounKey(listing).split(' ').filter(Boolean);
  if (!a.length) return false;
  return String(role || '').split(/\s*\/\s*/).some((part) => {
    const b = jobNounKey(part).split(' ').filter(Boolean);
    if (!b.length) return false;
    const A = new Set(a); const B = new Set(b);
    return a.every((w) => B.has(w)) || b.every((w) => A.has(w));
  });
}


const FOREIGN_RE = /\b(canada|canadian|mexico|uk|eu|united kingdom|england|london|ireland|dublin|germany|german|berlin|munich|dusseldorf|france|paris|spain|madrid|portugal|italy|netherlands|amsterdam|poland|norway|sweden|denmark|finland|europe|european|emea|apac|latam|dach|india|bangalore|philippines|manila|australia|sydney|brisbane|singapore|japan|tokyo|brazil|argentina|colombia|senegal|nigeria|kenya|south africa|israel|uae|dubai|taiwan|korea|vietnam|worldwide|global)\b/i;

// "based in Germany", "must reside in Canada", "hybrid from our London office" — built once from the literal
// FOREIGN_RE above (no listing text ever reaches a RegExp constructor).
const FOREIGN_NAMES = FOREIGN_RE.source.replace(/^\\b\(|\)\\b$/g, '').replace(/\|worldwide\|global/, '');
const TIED_ABROAD_RE = new RegExp(`\\b(based (in|out of)|reside (in|within)|residing in|located in|live in|living in|resident of|from our|office in|offices in|eligible to work in|right to work in|hybrid (in|from)) (the )?(${FOREIGN_NAMES})\\b`, 'i');

const REGION_RE = /\b(east|west|north|south|central|northeast|southeast|midwest|northwest|southwest|mid-?atlantic|great plains|pacific northwest|new england|gulf coast|mountain west|tola)\b(\s+(region|territory|coast))?/i;
const NOT_A_PLACE = /\d|\b(remote|hybrid|on-?site|onsite|shift|time|seasonal|level|senior|junior|lead|days|nights|weekend|team|store|partnership|program|engineering|operations|platform|product|security|payments|healthcare|fraud|sales|customer|support|research|intern|contract|temp|per diem|prn|full|part)\b/i;
/** The US place a title names after its job noun ("- Columbus, OH", "(Bay Area)"), or null. */
export function titlePlace(title, geo) {
  const raw = String(title || '');
  const cands = [];
  const dash = raw.split(/\s+[-–—|]\s+/);
  if (dash.length > 1) cands.push(dash.slice(1).join(', '), ...dash.slice(1));
  for (const m of raw.matchAll(/\(([^)]{2,40})\)/g)) cands.push(m[1]);
  const commas = raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (commas.length >= 2) cands.push(commas.slice(1).join(', '), commas.slice(-2).join(', '), commas[commas.length - 1]);
  for (const c0 of cands) {
    const c = c0.replace(/\([^)]*\)/g, ' ').trim();
    if (c.length < 2 || c.length > 50 || NOT_A_PLACE.test(c)) continue;
    let g = null;
    try { g = geo.geocodePlace(c); } catch { g = null; }
    if (!g) continue;
    return g; // geocodePlace is strict: unknown words ("Supercompute", "Outbound Night Shift") place nowhere
  }
  return null;
}

// ── Place ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Is a listing within `miles` of home, or genuinely remote (US)? geo = lib/geo/usPlaces.js (or null →
 * text match on the city name). → { ok, remote, miles }
 */
export function placeMatch(job, home, geo, miles = 30) {
  const loc = String(job?.location || '');
  const scope = locationScope(loc);
  if (scope === 'non_us') return { ok: false, remote: false, miles: null };
  const head = String(job?.description || '').slice(0, 2500);
  const hybrid = /\bhybrid\b/i.test(`${loc} ${job?.type || ''}`);
  const remoteWord = /\b(remote|work from home|wfh|anywhere|telecommute|virtual|distributed)\b/i;
  // "United States" alone as the location, with a posting that says it is remote, is US-remote.
  const countryOnly = /^(united states( of america)?|usa|u\.s\.a?\.?|us)$/i.test(loc.trim());
  const remote = !hybrid && (remoteWord.test(`${loc} ${job?.type || ''}`) || (countryOnly && /\b(fully remote|100% remote|remote (role|position|job|work|opportunity)|work remotely|work from home)\b/i.test(head)));
  // A place named in the TITLE ("Territory Manager - Columbus, OH", "(Bay Area)") is where the job is when the
  // location line says only "Remote" / "US Remote" or names nothing placeable — a field territory in another
  // state is out of area. A sales region with no place ("East Region") on a remote line cannot be checked: out.
  const rowPlaced = (Number.isFinite(Number(job?.lat)) && Number(job?.lat) !== 0) || !!(geo && typeof geo.geocodePlace === 'function' && (() => { try { const g = geo.geocodePlace(loc); return g && !g.stateOnly; } catch { return false; } })());
  if (!rowPlaced && geo && typeof geo.geocodePlace === 'function') {
    const tp = titlePlace(job?.title, geo);
    if (tp) {
      if (tp.stateOnly) {
        let homeState = null;
        try { homeState = geo.geocodePlace(home?.city || '')?.state || null; } catch { homeState = null; }
        return { ok: !!homeState && homeState === tp.state, remote: false, miles: null };
      }
      if (home?.point && typeof geo.distanceMiles === 'function') {
        const d = geo.distanceMiles(home.point, tp);
        return { ok: Number.isFinite(d) && d <= miles + 0.5, remote: false, miles: Number.isFinite(d) ? Math.round(d) : null };
      }
      return { ok: false, remote: false, miles: null };
    }
    if (REGION_RE.test(String(job?.title || ''))) return { ok: false, remote: false, miles: null };
  }
  if (remote) {
    // Remote is not a passport: US-remote only. A region or a country abroad in the title, the location
    // or the top of the posting → not here; a bare "Remote"/"Worldwide" needs the posting to say the US.
    if (FOREIGN_RE.test(`${job?.title || ''} ${loc}`) || /\b(european|europe|emea|latam|apac)\b/i.test(`${job?.title || ''} ${loc}`)) return { ok: false, remote: true, miles: null };
    // Plain "Remote" from a US board is US-remote; it is out when the posting ties the job to another
    // country ("based in Germany", "must reside in Canada", "hybrid from our London office") or says worldwide.
    if (/\b(worldwide|global)\b/i.test(loc) || TIED_ABROAD_RE.test(head.replace(/\s+/g, ' '))) return { ok: false, remote: true, miles: null };
    // "Remote within Texas" / "must reside in Ohio": in range only for a résumé in that state.
    const tied = `${job?.title || ''} ${loc} ${head.slice(0, 600)}`.match(/\b[Rr]emote\b[^.\n]{0,25}\b(?:within|in|from)\s+(?:the\s+state\s+of\s+)?([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b|\bmust (?:live|reside) in\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/);
    const tiedState = tied ? (tied[1] || tied[2] || '').toLowerCase() : '';
    if (tiedState && STATES[tiedState]) {
      let homeState = null;
      try { homeState = geo && typeof geo.geocodePlace === 'function' ? geo.geocodePlace(home?.city || '')?.state || null : null; } catch { homeState = null; }
      return { ok: !!homeState && homeState === STATES[tiedState], remote: true, miles: null };
    }
    // An explicitly US-remote row ("Remote - US", "(Remote, US)", "US Remote", "Remote, United States") is in range
    // for every US résumé; a bare "Remote" needs a job type that is done remotely.
    const usRemote = /\b(remote\s*[-,–(/]*\s*(us|usa|u\.s\.?|united states)|(us|usa|u\.s\.?|united states)\s*[-,–(/]*\s*remote|remote\s*\(\s*(us|usa|united states)\s*\))\b/i.test(`${job?.title || ''} ${loc}`);
    if (usRemote) return { ok: true, remote: true, miles: null };
    const occ = classifyTitle(job?.title, '');
    return { ok: !!occ && occ.remote, remote: true, miles: null };
  }
  if (!home) return { ok: false, remote: false, miles: null };
  // L's radius helper (lib/geo/radius.js withinRadius) when it is loaded: coordinates, or every place the
  // location text names; never a whole state.
  if (geo && typeof geo.withinRadius === 'function' && home.point) {
    try {
      const nameKey = String(home.city || '').split(',')[0].trim().toLowerCase();
      const w = geo.withinRadius(job, home.point, miles, { nameKey });
      if (w && (w.in || w.by)) return { ok: !!w.in, remote: false, miles: Number.isFinite(w.miles) ? Math.round(w.miles) : null };
    } catch { /* fall through to the local measure */ }
  }
  if (geo && typeof geo.distanceMiles === 'function' && home.point) {
    const usable = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && !(Number(p.lat) === 0 && Number(p.lng) === 0);
    let p = usable(job) ? { lat: Number(job.lat), lng: Number(job.lng) } : null;
    if (!p && typeof geo.geocodePlace === 'function') {
      let g = null;
      try { g = geo.geocodePlace(loc); } catch { g = null; }
      if (g && !g.stateOnly && usable(g)) p = { lat: Number(g.lat), lng: Number(g.lng) };
    }
    if (p) {
      const d = geo.distanceMiles(home.point, p);
      return { ok: Number.isFinite(d) && d <= miles + 0.5, remote: false, miles: Number.isFinite(d) ? Math.round(d) : null };
    }
  }
  const city = String(home.city || '').split(',')[0].trim().toLowerCase();
  return { ok: !!city && city.length >= 3 && loc.toLowerCase().includes(city), remote: false, miles: null };
}

// ── Storage ────────────────────────────────────────────────────────────────────────────────────
// db(path, opts) → fetch Response against /rest/v1 with the service key (the shape api/user-sync.js uses).
let _hasCol = null; // true | false | null; false re-probes after 10 minutes (the owner applies schema by hand)
let _probedAt = 0;
export function _resetJobKeysProbe() { _hasCol = null; _probedAt = 0; }
export async function hasJobKeysColumn(db) {
  if (_hasCol === true) return true;
  if (_hasCol === false && Date.now() - _probedAt < 600_000) return false;
  try {
    const r = await db('profiles?select=job_keys&limit=1');
    _probedAt = Date.now();
    if (r && r.ok) { _hasCol = true; return true; }
    const body = r ? await r.json().catch(() => null) : null;
    const code = String(body?.code || '');
    if (code === '42703' || code === 'PGRST204' || /job_keys/.test(String(body?.message || ''))) { _hasCol = false; return false; }
    return false; // unknown failure: do not cache
  } catch { return false; }
}

/** The applications that feed `applied`: the tracker and Apply-on-Seen, last APPLIED_DAYS days. null = unreadable. */
export async function readRecentApplications(db, uid, now = new Date()) {
  const u = encodeURIComponent(uid);
  const since = encodeURIComponent(new Date(now.getTime() - APPLIED_DAYS * 86_400_000).toISOString());
  const read = async (path) => {
    try { const r = await db(path); if (!r || !r.ok) return null; const j = await r.json().catch(() => null); return Array.isArray(j) ? j : null; } catch { return null; }
  };
  const [apps, seen] = await Promise.all([
    read(`applications?user_id=eq.${u}&created_at=gte.${since}&select=job_id,company_name,role,applied_at,created_at&order=created_at.desc&limit=200`),
    read(`seen_applications?applicant_user_id=eq.${u}&created_at=gte.${since}&select=job_id,company_name,job_title,created_at&order=created_at.desc&limit=200`),
  ]);
  if (!apps && !seen) return null;
  return [...(apps || []), ...(seen || [])];
}

/**
 * Rebuild and store a person's keys from what is on file now. Called after every résumé write and
 * application change (api/user-sync.js, lib/server/resumes.js). Never throws; → { ok, keys, stored }.
 * An empty / removed résumé stores null (keys cleared).
 */
export async function rebuildJobKeys(db, uid, { now = new Date() } = {}) {
  try {
    if (!uid) return { ok: false, keys: null, stored: false };
    const pr = await db(`profiles?id=eq.${encodeURIComponent(uid)}&select=resume_text,city&limit=1`);
    if (!pr || !pr.ok) return { ok: false, keys: null, stored: false };
    const rows = await pr.json().catch(() => null);
    const prof = Array.isArray(rows) ? rows[0] || {} : {};
    const text = typeof prof.resume_text === 'string' ? prof.resume_text : '';
    const apps = await readRecentApplications(db, uid, now) || [];
    const keys = text.trim() ? buildJobKeys({ resumeText: text, applications: apps, profile: prof, now }) : null;
    const stored = await storeJobKeys(db, uid, keys, now);
    return { ok: true, keys, stored };
  } catch (e) {
    console.error('[job-keys] rebuild failed', String(e?.message || e).slice(0, 120).replace(/\n|\r/g, ' '));
    return { ok: false, keys: null, stored: false };
  }
}

/** Write keys to profiles.job_keys (null clears). false when the column is missing or the write failed. */
export async function storeJobKeys(db, uid, keys, now = new Date()) {
  if (!(await hasJobKeysColumn(db))) return false;
  const write = () => db(`profiles?id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ job_keys: keys, job_keys_updated_at: keys ? now.toISOString() : null }),
  });
  try {
    let r = await write();
    if (!r || !r.ok) r = await write(); // one retry; the caller is told the truth either way
    if (!r || !r.ok) { console.error('[job-keys] write failed', r ? r.status : 'no response'); return false; }
    return true;
  } catch { return false; }
}

/** A db(path, opts) function over PostgREST with the service key. */
export function serviceDb(supabaseUrl, serviceKey) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  return (path, opts = {}) => fetch(`${supabaseUrl}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
}

export const _internals = { LICENCES, LIC_BY_ID, monthIndex };

// ── The shared gates (director round 5) ──────────────────────────────────────────────────────────
// The final yes for anything emailed (and for the rail's top rows) comes from the fit check itself
// (lib/optimizer runOptimizer — one reading of the posting, the same gates it prints): years with their
// subject, credentials / licenses, degree, management, seniority. A gate it marks "not met" refuses the match,
// so the email can never say "you meet what it asks for" about a job the fit check marks as a gate not met.
// matchListing stays the cheap pre-filter and ranker. It also hands back the proof the reason names: what in
// THIS listing the résumé shows (the posting's words for a requirement, and the résumé line that shows it).
/** → { ok, failed: [{ kind, label, sentence }], proofs: [{ label, line }], unread? } — never throws. */
/**
 * The shared years reading left a requirement open ("ask" / "unmet") that this rule met from dated roles in
 * the requirement's own subject (a named field, a grade, leading people, or roles whose lines name it). Returns
 * true only when every open one is covered so; each override is listed for the scoring engineer.
 */
export function yearsCoveredByRule(open, checked) {
  const key = (t) => normTitle(t).replace(/\b(of|in|a|an|the|experience)\b/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return (open || []).every((c) => (checked || []).some((m) => m.subject && Number(m.years) === Number(c.needed) && m.have >= c.needed
    && (key(m.text).includes(key(c.label).slice(0, 18)) || key(c.label).includes(key(m.text).slice(0, 18)) || /\d/.test(String(c.label)) && String(m.text).includes(String(c.label).replace(/^.*?(\d+\+?)/, '$1').slice(0, 16)))));
}
export function sharedGates(job, resumeText, { now = new Date() } = {}) {
  const desc = String(job?.description || '');
  if (!desc.trim()) return { ok: true, failed: [], proofs: [], unread: true };
  try {
    const r = runOptimizer({ resumeText: String(resumeText || ''), jobDescription: desc, jobTitle: String(job?.title || ''), company: job?.company || '', now });
    const failed = (r.hard_gates || []).map((c) => ({ kind: c.kind, label: c.label, sentence: c.sentence || c.message || null }));
    const years = (r.constraints || []).filter((c) => c.kind === 'years' && (c.gate || c.importance === 'required')).map((c) => ({ label: c.label, status: c.status, computed: c.computed, needed: c.needed }));
    const clean = (x) => String(x || '').replace(/^[\s•\-*·–—]+/, '').replace(/\s+/g, ' ').replace(/[.;,]+$/, '').trim();
    const proofs = (r.matched_requirements || [])
      .filter((m) => m.matched && !m.inferred && !m.soft && m.evidence && m.evidenceKind !== 'skills' && !m.skillsOnly && (m.surface || m.requirement))
      .sort((a, b) => (b.importance === 'required') - (a.importance === 'required') || (b.strength || 0) - (a.strength || 0))
      .map((m) => {
        const lab = clean(m.surface || m.requirement);
        // the posting's own casing ("React", "QuickBooks"), never the reader's lower-case key
        const hit = desc.match(new RegExp(`\\b${escapeRegExp(lab)}\\b`, 'i'));
        return { label: hit ? hit[0] : lab, line: clean(m.evidence) };
      })
      .filter((p) => p.line.length >= 12 && p.line.length <= 160 && /^[a-z][a-z0-9 &/+'.-]{2,40}$/i.test(p.label) && !/\b(years?|experience|required|preferred|ability|must)\b/i.test(p.label));
    return { ok: failed.length === 0, failed, proofs, years };
  } catch (e) {
    return { ok: true, failed: [], proofs: [], unread: true, error: String(e?.message || e).slice(0, 80) };
  }
}

const PEOPLE_LABEL_RE = /^(journeym[ae]n|supervisors?|managers?|nurses?|physicians?|doctors?|engineers?|electricians?|plumbers?|technicians?|teachers?|staff|teams?|customers?|patients?|clients?|leaders?|directors?|executives?)$/i;
/** The reason's second sentence: what in this listing the résumé shows, never repeating `used`. */
export function proofSentence(proofs, used = new Set(), keys = null) {
  // A proof line must be a bullet of a job that still counts (not a field they left, not a side job) and never
  // a role header ("Audit Intern — Plante Moran … 2026").
  const okRole = (line) => {
    if (!keys) return true;
    const n = normLine(line);
    const role = (keys.roles || []).find((r) => (r.lines || []).some((l) => l.slice(0, 60) === n.slice(0, 60)));
    if (!role) return true; // a line the parser did not attach to a role (two-column layouts): it is still the résumé's
    return !role.occupations.some((id) => (keys.occupations || []).find((o) => o.occupation === id && (o.left || o.side))) || role.occupations.some((id) => (keys.direction || []).includes(id));
  };
  const summaryKeys = new Set((keys?.summary_keys || []).map((x) => x.slice(0, 60)));
  for (const p of proofs || []) {
    if (/\b(19|20)\d{2}\b/.test(p.line) && /\s[—–-]\s/.test(p.line)) continue;
    // a requirement is never proved by a line where the person is the object ("Assisted journeymen…"), by a
    // people noun as the "requirement", or by the person's own summary line (circular)
    if (PEOPLE_LABEL_RE.test(p.label)) continue;
    const lw = p.label.toLowerCase().split(/\s+/)[0].replace(/[^a-z]/g, '');
    if (lw && new RegExp(`\\b(assist\\w*|help\\w*|support\\w*|shadow\\w*|under (the )?(supervision|direction) of|alongside|reported to|worked with)\\b[^.;]{0,40}\\b${escapeRegExp(lw)}`, 'i').test(p.line)) continue;
    if (summaryKeys.has(normLine(p.line).slice(0, 60)) && !(keys.roles || []).some((r) => (r.lines || []).some((l) => l.slice(0, 60) === normLine(p.line).slice(0, 60)))) continue;
    // a role header ("Line Cook - Ethan Stowell Restaurants (How to Cook a Wolf), Seattle WA")
    if (keys && (keys.roles || []).some((r) => normLine(p.line).startsWith(normLine(r.title)) && /^[^,.;]{0,60}\s[—–|-]\s/.test(p.line))) continue;
    if (!okRole(p.line)) continue;
    const s = `They ask for ${p.label}; you wrote "${p.line}."`;
    if (!used.has(p.line)) return { sentence: s, line: p.line };
  }
  return null;
}
