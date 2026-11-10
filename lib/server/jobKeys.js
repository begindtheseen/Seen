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
import { postingField } from '../optimizer/fieldMatch.js';

export const JOB_KEYS_VERSION = 4;
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
  O('instructional_designer', 'instructional designer', 'education', /\b(instructional design\w*|curriculum (developer|designer|writer|specialist)|learning (experience )?designer|e ?learning (developer|designer))\b/, { q: ['instructional designer', 'curriculum'], remote: true }),
  O('instructor', 'teacher', 'education', /\b(instructor|teacher|professor|lecturer|faculty)\b/, { q: ['teacher', 'instructor'] }),
  O('tutor', 'tutor', 'education', /\b(tutor|academic coach|mentor)\b/, { adj: [], q: ['tutor'] }),
  O('childcare', 'childcare worker', 'education', /\b(nanny|babysit\w*|child ?care|daycare|preschool aide)\b/, { q: ['childcare', 'nanny'] }),

  // Security: guards are not security engineers.
  O('security_engineer', 'security engineer', 'software_engineering', /\b(security (engineer|architect|technologist)|cyber ?security|application security|product security|appsec|ciso|information security officer|soc analyst|grc analyst|penetration tester)\b/, { adj: ['security_analyst'], q: ['security engineer', 'cybersecurity'], remote: true }),
  O('security_analyst', 'security analyst', 'it', /\b(security analyst|industrial security|information security|cyber analyst)\b/, { adj: ['security_engineer'], q: ['security analyst'], remote: true }),
  O('loss_prevention', 'loss prevention', 'security', /\b(loss prevention|asset protection)\b/, { adj: ['security_officer'], q: ['loss prevention', 'asset protection'] }),
  O('security_officer', 'security officer', 'security', /\b(security (officer|guard|host|hostess|supervisor|field supervisor|patrol|monitor|agent)|security\b(?!.*\b(engineer|architect|analyst|developer|software)\b)|guard|patrol officer|armed officer|unarmed officer)\b/, { adj: ['loss_prevention'], lic: 'guard_card', q: ['security officer', 'security guard'] }),

  // Healthcare (licensed roles never borrow years from each other).
  O('nurse_practitioner', 'nurse practitioner', 'clinical', /\b(nurse practitioner|np\b|pmhnp|fnp|crna|nurse anesthetist|physician assistant)\b/, { lic: 'np', q: ['nurse practitioner'] }),
  O('registered_nurse', 'registered nurse', 'clinical', /\b(registered nurse|rn\b|rns\b|nurse (navigator|manager|supervisor|educator|case manager)|charge nurse|nursing supervisor|staff nurse|travel nurse|new nurse graduate)\b/, { lic: 'rn', q: ['registered nurse', 'rn'] }),
  O('lpn', 'licensed practical nurse', 'clinical', /\b(lpn|lvn|licensed (practical|vocational) nurse|licensed nurse)\b/, { lic: 'lpn', q: ['lpn', 'lvn'] }),
  O('cna', 'nursing assistant', 'healthcare_support', /\b(cna|lna|certified nursing assistant|nursing assistant|nurse aide|nursing attendant|patient care (assistant|technician|tech)|pct)\b/, { adj: ['caregiver'], lic: 'cna', q: ['nursing assistant', 'cna', 'patient care'] }),
  O('caregiver', 'caregiver', 'healthcare_support', /\b(caregiver|care giver|home health aide|chha|hha|personal care (aide|assistant|attendant)|direct support professional|dsp|companion|in home care|resident assistant)\b/, { adj: ['cna'], q: ['caregiver', 'home health aide', 'direct support'] }),
  O('medical_assistant', 'medical assistant', 'healthcare_support', /\b(medical assistant|clinical assistant)\b/, { adj: [], q: ['medical assistant'] }),
  O('phlebotomist', 'phlebotomist', 'healthcare_support', /\b(phlebotom\w*)\b/, { q: ['phlebotomist'] }),
  O('pharmacy_tech', 'pharmacy technician', 'healthcare_support', /\b(pharmacy (technician|tech))\b/, { lic: 'pharmacy_tech', q: ['pharmacy technician'] }),
  O('pharmacist', 'pharmacist', 'clinical', /\b(pharmacist)\b/, { lic: 'pharmacist', q: ['pharmacist'] }),
  O('dental_assistant', 'dental assistant', 'healthcare_support', /\b(dental assistant|dental hygienist)\b/, { q: ['dental assistant'] }),
  O('vet_tech', 'veterinary technician', 'healthcare_support', /\b(veterinary (technician|tech|assistant)|vet tech)\b/, { q: ['veterinary technician'] }),
  O('behavior_tech', 'behavior technician', 'healthcare_support', /\b(behavior (technician|tech|interventionist)|rbt|autism support|aba therapist)\b/, { q: ['behavior technician', 'rbt'] }),
  O('therapist_rehab', 'therapist', 'clinical', /\b(physical therapist|physical therapy assistant|occupational therapist|speech (language )?(pathologist|therapist)|rehabilitation therapist|pta\b|cota\b|respiratory therapist)\b/, { lic: 'therapy', q: ['physical therapist', 'occupational therapist'] }),
  O('counselor', 'counselor', 'social_services', /\b((?<!massage )therapist|counselor|counsellor|social worker|lcsw|lmsw|lmft|lpc|psychologist|bcba|behavior analyst)\b/, { lic: 'counseling', q: ['counselor', 'social worker'] }),
  O('physician', 'physician', 'clinical', /\b(physician|doctor|surgeon|dentist|endodontist|optometrist|veterinarian|hospitalist)\b/, { lic: 'md', q: ['physician'] }),
  O('med_tech', 'medical technologist', 'clinical', /\b(radiologic technologist|surgical (tech|technologist)|or tech|sterile processing|lab(oratory)? technician|medical technologist|optometric technician|ophthalmic technician|ekg tech|emt|paramedic)\b/, { q: ['technologist'] }),
  O('medical_receptionist', 'medical receptionist', 'administrative', /\b(medical receptionist|front desk (medical|clinic)|patient (access|registration|coordinator)|unit secretary|health info\w* (svc|services)? ?technician|medical records)\b/, { adj: ['receptionist'], q: ['medical receptionist', 'patient access'] }),

  // Engineering and technology (before trades: an electrical engineer is not an electrician).
  O('electrical_engineer', 'electrical engineer', 'engineering', /\b(electrical engineer\w*|electronics engineer|asic|fpga|analog (design|engineer)|power electronics|rf engineer|controls engineer|hardware engineer|serdes|soc architect|digital design engineer|design verification)\b/, { q: ['electrical engineer', 'hardware engineer'] }),
  O('mechanical_engineer', 'mechanical engineer', 'engineering', /\b(mechanical (design )?engineer\w*|mechanical engineering|propulsion|turbomachinery|aerospace engineer|structures engineer|structural engineer\w*|thermal engineer)\b/, { q: ['mechanical engineer'] }),
  O('civil_engineer', 'civil engineer', 'engineering', /\b(civil (engineer|designer|project)|project civil|water ?\/? ?wastewater|geotechnical|transportation engineer)\b/, { q: ['civil engineer'] }),
  O('manufacturing_engineer', 'manufacturing engineer', 'engineering', /\b((manufacturing|process|quality|industrial|tooling|welding|production|reliability|supplier (development|quality)|test|product|msat|facilities|commissioning|controls|automation) engineer\w*)\b/, { q: ['manufacturing engineer', 'process engineer'] }),
  O('data_scientist', 'data scientist', 'data_analytics', /\b(data scientist|machine learning (scientist|engineer|researcher)|ml engineer|research scientist|deep learning|applied scientist|ai (engineer|researcher)|quantitative researcher)\b/, { adj: ['data_engineer'], q: ['data scientist', 'machine learning'], remote: true }),
  O('data_engineer', 'data engineer', 'data_analytics', /\b(data engineer|analytics engineer|etl developer|data platform)\b/, { adj: ['software_engineer', 'data_scientist'], q: ['data engineer'], remote: true }),
  O('data_analyst', 'data analyst', 'data_analytics', /\b(data analyst|business (intelligence|data) analyst|reporting analyst|bi analyst|analytics (analyst|specialist)|marketing data analyst)\b/, { q: ['data analyst'], remote: true }),
  O('qa_engineer', 'QA engineer', 'software_engineering', /\b(qa (engineer|analyst|lead|tester|principal|technical lead)|quality assurance (engineer|analyst)|sdet|software (development )?engineer in test|test automation|software tester)\b/, { adj: ['software_engineer'], q: ['qa engineer'], remote: true }),
  O('sre', 'site reliability / DevOps engineer', 'software_engineering', /\b(site reliability|sre|devops|platform engineer|infrastructure engineer|cloud engineer|hpc cloud)\b/, { adj: ['software_engineer'], q: ['devops', 'site reliability'], remote: true }),
  O('software_engineer', 'software engineer', 'software_engineering', /\b(software (engineer|developer|development engineer)|developer|(?<!(cnc|alarm|plc|robot|nc) )programmer|(back|front)[ -]?end (engineer|developer)|full[ -]?stack|web developer|mobile (engineer|developer)|ios (engineer|developer)|android (engineer|developer)|golang engineer|engineer.*\b(backend|frontend|platform|payments|api)\b|forward deployed engineer|software architect|tech lead)\b/, { adj: ['qa_engineer', 'sre', 'data_engineer'], q: ['software engineer', 'developer'], remote: true }),
  O('it_support', 'IT support', 'it', /\b(it (support|specialist|technician|engineer|analyst)|help ?desk|service desk|desktop support|technical support (specialist|technician)|computer technician|endpoint engineer)\b/, { adj: ['network_admin'], q: ['it support', 'help desk', 'it specialist'], remote: true }),
  O('network_admin', 'network / systems administrator', 'it', /\b(network (engineer|administrator|technician)|system(s)? administrator|sysadmin|unified communications)\b/, { adj: ['it_support'], q: ['network engineer', 'systems administrator'] }),
  O('product_manager', 'product manager', 'product', /\b(product (manager|owner|lead)|technical product (manager|lead))\b/, { q: ['product manager'], remote: true }),
  O('project_manager', 'project manager', 'project_management', /\b(project (manager|coordinator|lead)|program (manager|coordinator)|scrum master|technical program manager|pmo)\b/, { q: ['project manager', 'project coordinator'], remote: true }),
  O('designer', 'designer', 'design', /\b(graphic designer|visual designer|product designer|ux|ui designer|web designer|interior designer|cadd? (specialist|designer|drafter)|drafter|level designer|motion designer)\b/, { q: ['designer'], remote: true }),

  // Skilled trades and production.
  O('electrician', 'electrician', 'skilled_trades', /\b(electrician|electrical (journeyman|apprentice|installer|lead installer|technician|helper|foreman)|journeyman (electrician|service driver|wireman)|wireman|electrical lead)\b/, { lic: null, q: ['electrician', 'electrical'] }),
  O('hvac_tech', 'HVAC technician', 'skilled_trades', /\b(hvac|refrigeration tech\w*|heating and air)\b/, { q: ['hvac'] }),
  O('plumber', 'plumber', 'skilled_trades', /\b(plumber|plumbing|pipefitter|pipe fitter|sprinkler (fitter|construction|installer)|fire sprinkler|utility pipe layer|pipe layer)\b/, { q: ['plumber', 'pipefitter'] }),
  O('welder', 'welder', 'skilled_trades', /\b(welder|welding (tech|operator)|fabricator)\b/, { q: ['welder'] }),
  O('carpenter', 'carpenter', 'skilled_trades', /\b(carpenter|framer|cabinet maker)\b/, { q: ['carpenter'] }),
  O('auto_mechanic', 'automotive technician', 'skilled_trades', /\b(auto(motive)? (technician|mechanic|tech)|diesel (technician|mechanic)|mechanic|express service technician|lube tech|tire tech|fleet technician|oil (change|sales and service))\b/, { adj: [], q: ['automotive technician', 'mechanic'] }),
  O('maintenance_tech', 'maintenance technician', 'skilled_trades', /\b(maintenance (technician|tech|mechanic|team member|worker|level|associate)|industrial (mechanic|maintenance)|facilities technician|equipment maintenance|maintainer|building engineer)\b/, { adj: [], q: ['maintenance technician', 'maintenance mechanic'] }),
  O('machinist', 'machinist', 'skilled_trades', /\b(machinist|cnc (programmer|operator|machinist)|tool technician|tool and die)\b/, { adj: [], q: ['machinist', 'cnc'] }),
  O('installer', 'installer', 'skilled_trades', /\b(installer|installation (technician|specialist|tech)|telematics|cable technician|field service technician)\b/, { q: ['installer', 'installation technician'] }),
  O('quality_inspector', 'quality inspector', 'manufacturing', /\b(quality (inspector|control inspector|technician|auditor)|qc (inspector|technician)|inspector)\b/, { adj: ['production_associate'], q: ['quality inspector', 'qc inspector'] }),
  O('production_associate', 'production associate', 'manufacturing', /\b(production (associate|worker|operator|technician|team member|services associate|supervisor|lead)|manufacturing (associate|technician|operator)|assembler|assembly (technician|associate|worker)|machine operator|set ?up operator|line worker|factory worker|mechatronics technician|motor test technician|electrical test technician|test technician|integration,? and test technician|engineering technician)\b/, { adj: ['quality_inspector'], q: ['production associate', 'manufacturing associate', 'assembler'] }),
  O('construction_laborer', 'construction worker', 'skilled_trades', /\b(construction (laborer|worker|helper)|general laborer|laborer|stagehand|crew chief|demolition|concrete)\b/, { q: ['construction laborer', 'laborer'] }),

  // Drivers.
  O('valet', 'valet', 'valet_parking', /\b(valet|parking (attendant|lot attendant|cashier)|parker)\b/, { q: ['valet', 'parking attendant'] }),
  O('truck_driver_cdl', 'CDL truck driver', 'delivery_logistics', /\b((?<!non )cdl|truck driver|tractor trailer|class a (driver|company driver)|otr driver|regional driver|tanker driver|hazmat driver)\b/, { adj: ['delivery_driver'], lic: 'cdl', q: ['cdl', 'truck driver'] }),
  O('delivery_driver', 'delivery driver', 'delivery_logistics', /\b(delivery (driver|associate)|courier|driver|route (driver|sales)|box truck)\b(?!.*(?<!non )\bcdl\b)/, { adj: ['truck_driver_cdl'], q: ['delivery driver', 'driver', 'courier'] }),

  // Warehouse / logistics / operations.
  O('warehouse_associate', 'warehouse associate', 'warehouse', /\b(warehouse|material handler|picker|packer|order (picker|selector|filler)|forklift|shipping (and|&) receiving|receiving (clerk|associate)|fulfillment (associate|center)|distribution (associate|center|&|and)|loader|unloader|package handler|yard (technician|jockey|associate|driver))\b/, { adj: ['inventory_specialist'], q: ['warehouse', 'material handler', 'forklift'] }),
  O('inventory_specialist', 'inventory specialist', 'warehouse', /\b(inventory (specialist|control|clerk|associate|analyst|coordinator)|materials coordinator|property ?\/? ?logistics specialist|logistics specialist|supply technician)\b/, { adj: ['warehouse_associate'], q: ['inventory specialist', 'inventory control'] }),
  O('logistics_coordinator', 'logistics coordinator', 'operations', /\b(logistics (coordinator|manager|analyst|partner)|supply chain|dispatcher|dispatch|production planner|buyer|purchasing|procurement|sourcing)\b/, { adj: [], q: ['logistics coordinator', 'supply chain'] }),
  O('operations', 'operations', 'operations', /\b((?<!people )operations (manager|associate|coordinator|lead|specialist|supervisor|analyst|director)|business operations|ops (manager|lead|associate)|area operations|director of (facility )?operations)\b/, { adj: [], q: ['operations manager', 'operations coordinator', 'operations associate'] }),

  // Food and hospitality.
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
  O('customer_success', 'customer success', 'sales', /\b(customer success|client success|client partner|account management specialist)\b/, { adj: [], q: ['customer success'], remote: true }),
  O('customer_service', 'customer service', 'customer_service', /\b(customer service|customer care|customer support|call center|contact center|customer experience (coordinator|associate|representative|specialist)|client care|patient care advocate|support (specialist|representative|agent)|care expert|service representative|member services)\b/, { adj: [], q: ['customer service', 'call center', 'customer support'], remote: true }),
  O('receptionist', 'receptionist', 'administrative', /\b(receptionist|front desk|front office)\b/, { adj: ['admin_assistant', 'medical_receptionist', 'hotel_front_desk'], q: ['receptionist', 'front desk'] }),
  O('legal_assistant', 'legal assistant', 'legal', /\b(paralegal|legal (assistant|secretary|administrative assistant)|litigation (assistant|secretary)|presuit secretary|law clerk|trademark paralegal)\b/, { adj: ['admin_assistant'], q: ['paralegal', 'legal assistant'] }),
  O('attorney', 'attorney', 'legal', /\b(attorney|lawyer|counsel)\b/, { lic: 'bar', q: ['attorney'] }),
  O('admin_assistant', 'administrative assistant', 'administrative', /\b(administrative (assistant|coordinator|specialist|associate)|admin assistant|office (assistant|administrator|coordinator|manager|clerk)|executive assistant|secretary|data entry|clerical|intake (specialist|coordinator)|personal assistant)\b/, { adj: ['receptionist', 'legal_assistant'], q: ['administrative assistant', 'office assistant', 'executive assistant'], remote: true }),
  O('hr_generalist', 'HR', 'hr', /\b(human resources?|hr (coordinator|generalist|assistant|specialist|manager|director|business partner)|people (operations|ops|partner|systems)|benefits (specialist|coordinator)|payroll (specialist|coordinator|administrator))\b/, { adj: ['recruiter'], q: ['human resources', 'hr coordinator'], remote: true }),
  O('accountant', 'accountant', 'finance_accounting', /\b(accountant|accounting|bookkeeper|accounts (payable|receivable)|controller|auditor|tax (preparer|associate)|cpa|consolidations)\b/, { q: ['accountant', 'bookkeeper', 'accounts payable'], remote: true }),
  O('financial_analyst', 'financial analyst', 'finance_accounting', /\b(financial analyst|fp ?& ?a|finance (manager|analyst|director)|investment (operations|analyst)|portfolio (manager|specialist)|credit (analyst|officer|review)|underwriter|risk analyst|asset manager|director, finance|vice president, finance|program controller)\b/, { q: ['financial analyst'], remote: true }),
  O('bank_teller', 'bank teller', 'finance_accounting', /\b(teller|relationship banker|personal banker|banker|loan (processor|officer)|financial (solutions|services) (advisor|representative)|card services)\b/, { q: ['bank teller', 'personal banker'] }),
  O('insurance_agent', 'insurance agent', 'sales', /\b(insurance (agent|representative|sales|customer service|recovery)|state farm|claims (adjuster|representative))\b/, { q: ['insurance agent'] }),
  O('real_estate_agent', 'real estate agent', 'sales', /\b(real estate|realtor|leasing (agent|consultant)|property (manager|coordinator))\b/, { q: ['real estate agent', 'leasing'] }),
  O('marketing', 'marketing', 'marketing', /\b(marketing|social media|content (creator|strategist|writer|manager)|seo|copywriter|brand (manager|associate|ambassador)|communications (specialist|coordinator|manager)|paid media|growth|user acquisition|ecommerce|e commerce|public relations)\b/, { q: ['marketing', 'social media'], remote: true }),
  O('sdr', 'sales development representative', 'sales', /\b(sales development|business development (representative|rep)|sdr|bdr|lead generat\w*)\b/, { adj: ['sales_rep', 'account_executive'], q: ['sales development', 'business development representative'], remote: true }),
  O('account_executive', 'account executive', 'sales', /\b(account executive|enterprise sales|account sales executive|deal desk)\b/, { adj: ['sales_rep', 'account_manager', 'sdr'], q: ['account executive'], remote: true }),
  O('account_manager', 'account manager', 'sales', /\b(account manager|key account|client manager|relationship manager|territory (manager|representative)|business development (manager|lead|director)|partner account|national sales account|commissioning client manager)\b/, { adj: ['account_executive', 'sales_rep'], q: ['account manager'], remote: true }),
  O('sales_rep', 'sales representative', 'sales', /\b(sales (representative|rep|consultant|agent|specialist|executive|manager|director|engineer)|inside sales|outside sales|specialty representative|development representative|medical science liaison|membership (specialist|advisor|sales))\b/, { adj: ['account_executive', 'sdr', 'account_manager'], q: ['sales representative', 'inside sales'], remote: true }),

  // Personal services.
  O('groomer', 'pet groomer', 'personal_services', /\b(groomer|grooming|kennel|dog walker|pet care)\b/, { q: ['groomer'] }),
  O('cosmetologist', 'cosmetologist', 'personal_services', /\b(cosmetolog\w*|hair stylist|stylist|barber|esthetician|nail tech\w*|massage therapist|stretch practi\w*)\b/, { lic: 'cosmetology', q: ['stylist'] }),
  O('interpreter', 'interpreter', 'other', /\b(interpreter|translator)\b/, { q: ['interpreter'] }),
];
const OCC_BY_ID = new Map(OCCUPATIONS.map((o) => [o.id, o]));
// Title words to READ listings with, per occupation: every way a title in that job type is written, including
// the lead / manager titles one step up ("Customer Support Manager", "Sous Chef"). The read is a pre-filter;
// matchListing decides. Fallback: the occupation's own `q`.
const READ_TERMS = {
  cook: ['cook', 'chef', 'kitchen', 'culinary', 'grill'],
  food_crew: ['crew member', 'team member', 'crew', 'shift lead', 'shift leader', 'shift supervisor'],
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
  retail_associate: ['sales associate', 'retail', 'store', 'keyholder', 'key holder', 'merchandis', 'stock'],
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
export function readTermsFor(id) { return READ_TERMS[id] || (OCC_BY_ID.get(id)?.q || []); }
/** The occupations a person's listings are read for — the same keys matchListing judges with: held fields
 * (current first), their neighbours, job types applied to, transferable targets, and a degree's field only
 * where a degree can match (student, recent graduate, under a year of work). */
export function readOccupations(keys, now = new Date()) {
  const ids = [];
  const push = (id) => { if (id && !ids.includes(id) && OCC_BY_ID.get(id) && id !== 'ai_training') ids.push(id); };
  const occs = [...(keys.occupations || [])].sort((a, b) => (b.current - a.current) || ((b.last_year || 0) - (a.last_year || 0)));
  for (const o of occs) push(o.occupation);
  for (const a of keys.applied || []) push(a.occupation);
  for (const o of occs) if (o.years > 0) for (const adj of OCC_BY_ID.get(o.occupation)?.adj || []) push(adj);
  for (const [target] of Object.entries(TRANSFER)) if (transferFrom(keys, target, (keys.applied || []).some((a) => a.occupation === target), now.getUTCFullYear())) push(target);
  const yearsTotal = Number(keys.years_total) || 0;
  for (const e of keys.education || []) if (e.studying || (e.year && now.getUTCFullYear() - e.year <= 1) || yearsTotal < 1) push(e.occupation);
  return ids;
}
export const occupation = (id) => OCC_BY_ID.get(id) || null;

// Industry cues that place a title which does not name its field ("Team Member", "Shift Lead").
const FOOD_CUE = /\b(restaurant|kitchen|food|menu|drive[- ]?thru|burger|pizza|cafe|café|coffee|grill|fryer|chick|taco|sandwich|bibibop|chipotle|mcdonald|wendy|subway|starbucks|panera|dutch bros|in-n-out|culinary|dining|guests? orders?)\b/i;
const RETAIL_CUE = /\b(store|retail|merchandis\w*|register|sales floor|shelves|shelving|stocking|target|walmart|costco|kroger|safeway|fry'?s|albertsons|home depot|lowe'?s|best buy|cvs|walgreens|dollar (general|tree)|ulta|sephora|gnc|nordstrom|macy'?s|tj ?maxx|ross|marshalls|old navy|gap|kohl'?s|drive up|front[- ]end|planogram|guest service)\b/i;
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
    const inCtx = new Set((String(context).match(g) || []).map((x) => x.toLowerCase())).size;
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
export function classifyTitle(title, context = '') {
  const raw = String(title || '');
  const head = raw.replace(/\([^)]*\)/g, ' ').split(/\s+[-–—|]\s+|,|\|/)[0].trim();
  // AI-training / survey gigs name a profession they are not ("Registered Nurses - AI Training").
  if (OCC_BY_ID.get('ai_training').re.test(normTitle(raw))) return OCC_BY_ID.get('ai_training');
  const occ = (head && head !== raw.trim() ? classifyRaw(head, context) : null) || classifyRaw(raw, context);
  if (!occ) return null;
  let fm = null;
  // An assistant TO someone is the assistant ("Executive Assistant to the Communications … Executives").
  try { fm = postingField(raw.replace(/\b(assistant|coordinator|aide|secretary) to (the )?.*$/i, '$1'), ''); } catch { fm = null; }
  if (fm && !fieldsFor(occ).includes(fm)) return null;
  return occ;
}
const FAMILY_FIELDS = {
  retail: ['retail', 'sales', 'support'], food_service: ['food', 'hospitality'], warehouse: ['warehouse', 'logistics', 'manufacturing'],
  delivery_logistics: ['logistics', 'warehouse'], valet_parking: ['hospitality', 'logistics'], hospitality: ['hospitality', 'food', 'front_office'],
  customer_service: ['support', 'front_office', 'sales', 'retail', 'hospitality'], clinical: ['nursing', 'clinical', 'patient_care'],
  healthcare_support: ['patient_care', 'nursing', 'clinical', 'front_office'], administrative: ['front_office', 'legal', 'support', 'hr', 'patient_care'],
  sales: ['sales', 'support', 'retail'], software_engineering: ['software', 'data', 'it', 'engineering'], data_analytics: ['data', 'software', 'marketing', 'accounting'],
  operations: ['ops', 'logistics', 'warehouse', 'accounting'], security: ['ops', 'hospitality'], finance_accounting: ['accounting', 'data', 'sales'],
  marketing: ['marketing', 'sales', 'design'], education: ['education', 'training'], project_management: ['ops', 'product', 'engineering', 'software', 'construction'],
  skilled_trades: ['electrical', 'maintenance', 'construction', 'manufacturing', 'logistics'], engineering: ['engineering', 'software', 'manufacturing', 'electrical'],
  manufacturing: ['manufacturing', 'engineering', 'maintenance', 'warehouse', 'electrical'], it: ['it', 'software'], hr: ['hr', 'front_office'],
  legal: ['legal', 'front_office'], product: ['product', 'software'], design: ['design', 'marketing', 'engineering'], training: ['training', 'education', 'support', 'hr'],
  fitness: ['fitness'], personal_services: ['fitness', 'retail', 'hospitality'], social_services: ['clinical', 'education'], other: [],
};
function fieldsFor(occ) { return FAMILY_FIELDS[occ.family] || []; }

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
    const rest = core.replace(/\b(shift|team|crew|store|assistant|general|floor|lead|leader|supervisor|manager|member|associate|senior|sr|guest|experience|service|services|front|end|customer|sales|overnight|night|day|key|holder|department)\b/g, ' ').trim();
    if (!rest) return placeByCue(title, context);
  }
  return null;
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
const NOT_PEOPLE_MANAGER = /\b(account|case|care|product|project|program|social media|community|territory|customer success|client success|client|relationship|knowledge|portfolio|asset|category|configuration|plm|property|office|sales enablement|enablement|merchant launch|partner marketing|brand|content|marketing|digital marketing|field marketing)\s+manager\b/;
export function levelOf(title) {
  const t = normTitle(title).replace(/\b(assistant|coordinator|aide|secretary|support) to (the )?.*$/, '$1');
  if (!t) return 1;
  if (/\b(chief|ciso|cto|cfo|ceo|coo|vp|vice president|president)\b/.test(t)) return 5;
  if (/\b(director|head of)\b/.test(t)) return /\bassociate director|assistant director\b/.test(t) ? 3 : 4;
  if (/\b(senior|sr) manager\b/.test(t)) return 4;
  if (/\b(intern|internship|co ?op|extern|externship|summer \d{4}|student)\b/.test(t)) return 0;
  if (/\b(trainee|in training|apprentice|entry level)\b/.test(t)) return 1;
  if (/\b(head chef|executive chef|chef de cuisine)\b/.test(t)) return 3;
  if (/\b(sous chef|lead cook|kitchen lead|chef de partie)\b/.test(t)) return 2;
  const peopleManager = /\b(manager|superintendent)\b/.test(t) && !/\bassistant (store |operations |station |retail |restaurant |general )?manager\b/.test(t) && !NOT_PEOPLE_MANAGER.test(t);
  if (peopleManager) return 3;
  if (/\b(senior|sr)\b/.test(t) && NOT_PEOPLE_MANAGER.test(t) && /\b(product|project|program|marketing|brand|content|partner marketing|field marketing|digital marketing|enablement|portfolio|asset|relationship) manager\b/.test(t)) return 3;
  if (/\b(principal|staff (software|engineer|applied|product|security|it|electrical|digital|automation|corporate|turbomachinery|technical|data|ml|machine|backend|frontend|infrastructure|platform|sre))\b/.test(t)) return 3;
  if (/\b(senior|sr|lead|supervisor|foreman|crew chief|key ?holder|keyholder|assistant (store |operations |station |retail |restaurant |general )?manager|team lead|shift (lead|leader|supervisor)|charge nurse|level (iii|3|iv|4)|iii|iv)\b/.test(t)) return 2;
  if (NOT_PEOPLE_MANAGER.test(t)) {
    if (/\b(key|strategic|national|enterprise) account\b/.test(t) || /\b(product|project|program|office|property|marketing|brand|content|community|social media|partner marketing|field marketing|digital marketing|enablement|category|portfolio|asset|relationship|knowledge|configuration|plm) manager\b/.test(t)) return 2;
    return 1;
  }
  if (/\b(enterprise|strategic|major) (account executive|sales|accounts?)\b/.test(t)) return 2;
  return 1;
}
export const isPeopleManagerTitle = (title) => levelOf(title) >= 3 || /\b(supervisor|foreman|shift (lead|supervisor)|team lead|assistant (store )?manager|crew chief)\b/.test(normTitle(title));
const LEVEL_WORDS = ['an internship', 'an individual role', 'a senior or lead role', 'a manager role', 'a director role', 'an executive role'];

// ── Licences ───────────────────────────────────────────────────────────────────────────────────
// listing: the posting asks for it; resume: the résumé states it. A role that cannot be held without the
// licence implies it (implied). Obtainable-on-the-job wording ("ability to obtain", "within 30 days", "will
// train", "preferred") never blocks.
const LICENCES = [
  { id: 'guard_card', label: 'a security guard licence', listing: /\b(guard card|security (officer|guard) (license|licence|registration|card|certification)|registration as a security guard|security guard registration|bsis|security license|security licence|perc card|security registration)\b/i, resume: /\b(guard card|security (officer|guard) (license|licence|registration|card)|bsis|security license|security licence|perc card|registered security)\b/i, implied: ['security_officer'] },
  { id: 'cdl_a', label: 'a Class A CDL', listing: /\b(class a (cdl|commercial driver'?s licen[cs]e|licen[cs]e|driver)|cdl[- ]?a\b|cdl,? class a)/i, negative: /\b(non[- ]?cdl|no cdl|cdl (is )?not required)\b/i, resume: /\b(class a (cdl|commercial)|cdl[- ]?a\b|cdl,? class a|cdl \(class a\))/i, implied: [], impliedTitle: /\bclass a\b/i },
  { id: 'cdl', label: 'a CDL', listing: /\b(cdl|commercial driver'?s licen[cs]e)\b(?![- ]?(not|isn'?t) required)/i, negative: /\b(non[- ]?cdl|no cdl|cdl (is )?not required|without a cdl)\b/i, resume: /\b(cdl|commercial driver'?s licen[cs]e)\b/i, implied: ['truck_driver_cdl'] },
  { id: 'rn', label: 'an RN licence', listing: /\b(rn licen[cs]e|registered nurse licen[cs]e|licen[cs]ed (as an? )?(registered nurse|rn)|active rn|current rn|rn,? (bsn )?required|compact (rn )?licen[cs]e)\b/i, resume: /\b(rn licen[cs]e|registered nurse|\brn\b)\b/i, implied: ['registered_nurse', 'nurse_practitioner'] },
  { id: 'lpn', label: 'an LPN/LVN licence', listing: /\b(lpn|lvn) (licen[cs]e|required)|licen[cs]ed (practical|vocational) nurse licen[cs]e\b/i, resume: /\b(lpn|lvn|licensed (practical|vocational) nurse)\b/i, implied: ['lpn', 'registered_nurse'] },
  { id: 'cna', label: 'a CNA certificate', listing: /\b(cna (certification|certificate|licen[cs]e|required)|certified nursing assistant (certification|certificate|licen[cs]e)|state[- ]certified (nursing assistant|cna)|active cna)\b/i, resume: /\b(cna|lna|certified nursing assistant|nurse aide certif\w*)\b/i, implied: ['cna', 'lpn', 'registered_nurse'] },
  { id: 'hha', label: 'a home health aide certificate', listing: /\b(hha|chha|home health aide) (certification|certificate|required)\b/i, resume: /\b(hha|chha|home health aide)\b/i, implied: ['cna', 'lpn', 'registered_nurse'] },
  { id: 'clearance', label: 'a security clearance', listing: /\b((active|current) (secret|top secret|ts\/?sci|ts) (security )?clearance|(secret|top secret|ts\/sci) clearance (is )?required|must (have|hold|possess) an? (active )?(secret|top secret|ts\/sci))\b/i, resume: /\b((active|current)?\s*(secret|top secret|ts\/sci) (security )?clearance)\b/i, implied: [] },
  { id: 'pharmacy_tech', label: 'a pharmacy technician licence', listing: /\b(pharmacy technician (licen[cs]e|registration|certification)|ptcb|cpht)\b/i, resume: /\b(pharmacy technician|ptcb|cpht)\b/i, implied: ['pharmacy_tech'] },
  { id: 'cosmetology', label: 'a cosmetology licence', listing: /\b(cosmetology licen[cs]e|barber licen[cs]e|esthetician licen[cs]e)\b/i, resume: /\b(cosmetology|barber|esthetician) licen[cs]e\b/i, implied: ['cosmetologist'] },
  { id: 'master_electrician', label: 'a master electrician licence', listing: /\b(master electrician('?s)? (licen[cs]e|card|certification)|licen[cs]ed master electrician|master (electrical )?licen[cs]e)\b/i, resume: /\bmaster electrician\b/i, implied: [], impliedTitle: /\bmaster electrician\b/i },
  { id: 'journeyman_electrician', label: 'a journeyman electrician licence', listing: /\b(journeyman (electrician('?s)? )?(licen[cs]e|card)|licen[cs]ed journeyman|electrical (licen[cs]e|certification card)|licen[cs]ed electrician|state electrical licen[cs]e)\b/i, resume: /\b(journeyman|licen[cs]ed electrician|electrical licen[cs]e|electrician (licen[cs]e|certification))\b/i, implied: [], impliedTitle: /\b(journeyman|master electrician)\b/i },
  { id: 'master_plumber', label: 'a master plumber licence', listing: /\b(master plumb(er|ing)('?s)? licen[cs]e|licen[cs]ed master plumber)\b/i, resume: /\bmaster plumber\b/i, implied: [], impliedTitle: /\bmaster plumber\b/i },
  { id: 'journeyman_plumber', label: 'a journeyman plumber licence', listing: /\b(journeyman plumb(er|ing)('?s)? licen[cs]e|licen[cs]ed (journeyman )?plumber)\b/i, resume: /\b(journeyman plumber|plumbing licen[cs]e|licen[cs]ed plumber)\b/i, implied: [], impliedTitle: /\b(journeyman|master) plumber\b/i },
  { id: 'pe', label: 'a PE licence', listing: /\b(professional engineer(ing)? \(?pe\)? licen[cs]e|pe licen[cs]e|licen[cs]ed professional engineer|active pe)\b/i, resume: /\b(professional engineer|pe licen[cs]e|\bp\.?e\.?\b)/i, implied: [] },
  { id: 'epa608', label: 'an EPA 608 certification', listing: /\bepa (section )?608\b/i, resume: /\bepa (section )?608\b/i, implied: [] },
  { id: 'cpa', label: 'a CPA licence', listing: /\b(active cpa|cpa licen[cs]e|licensed cpa|cpa (is )?required)\b/i, resume: /\bcpa\b/i, implied: [] }, // "CPA candidate" is IN_PROGRESS_RE
  { id: 'real_estate', label: 'a real estate licence', listing: /\breal estate licen[cs]e\b/i, resume: /\breal estate licen[cs]e\b/i, implied: [] },
  { id: 'forklift', label: 'a forklift certification', listing: /\bforklift (certification|certificate|licen[cs]e|certified)\b/i, resume: /\bforklift\b/i, implied: [] },
  { id: 'emt', label: 'an EMT certification', listing: /\b(emt|paramedic) (certification|licen[cs]e|required)\b/i, resume: /\b(emt[- ]?b|emt|paramedic)\b/i, implied: [] }, // "EMT conduit" is not this: credentials need a licence line (CREDENTIAL_LINE)
];
const LIC_BY_ID = new Map(LICENCES.map((l) => [l.id, l]));
// A higher grade of a licence holds the lower one (a master electrician holds a journeyman's licence).
const LICENCE_COVERS = { master_electrician: ['journeyman_electrician'], master_plumber: ['journeyman_plumber'], cdl_a: ['cdl'] };
// Licences implied by a field the title names (a CNA listing needs a CNA). Fields like "np", "md", "bar"
// are licensed professions no résumé outside that profession reaches; they only exist as occupations.
const TITLE_LICENCE = { guard_card: 'guard_card', cdl: 'cdl', cdl_a: 'cdl_a', rn: 'rn', lpn: 'lpn', cna: 'cna', pharmacy_tech: 'pharmacy_tech', cosmetology: 'cosmetology' };
const OBTAINABLE_RE = /\b(prefer\w*|a plus|plus\b|nice to have|bonus|desired|ability to obtain|able to obtain|obtain\w* within|willing (to|and able to) obtain|must obtain|or obtain|will (help|assist|train|sponsor|pay|provide)|we (will )?(pay|sponsor|provide)|paid (training|certification)|eligible (to obtain|for)|in (the )?process of|upon hire|after hire|within \d+ (days|months)|once hired|not required|is not required)\b/i;
const IN_PROGRESS_RE = /\b(pursuing|in progress|expected|studying for|working toward|working towards|enrolled|candidate|planned|scheduled)\b/i;

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
  return [...out];
}

/** Licences a résumé states (in-progress ones excluded). */
// A credential is read only from a licences / certifications section, or from a line that says it is a licence,
// certificate, card or registration — never from a bullet ("ran EMT conduit", "worked with the PE on site").
const CRED_HEADING_RE = /^\s*(licen[cs]es?|certifications?|certificates?|credentials?|licen[cs]es?\s*(and|&)\s*certifications?|certifications?\s*(and|&)\s*licen[cs]es?|professional licen[cs]es?)\b[^a-z]*$/i;
const OTHER_HEADING_RE = /^\s*(experience|work experience|employment|education|skills|technical skills|projects|summary|profile|objective|volunteer\w*|awards|references)\b[^a-z]*$/i;
const CREDENTIAL_LINE = /\b(licen[cs]e[ds]?|certif\w*|card|registration|registered|board[- ]certified|credential)\b/i;
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

function resumeRoles(text, now) {
  let doc = null;
  try { doc = parseResume({ text }); } catch { doc = null; }
  let raw = [];
  if (doc && Array.isArray(doc.experience) && doc.experience.length) {
    raw = doc.experience.map((r) => ({
      title: String(r.title || '').trim(), company: String(r.company || '').trim(), start: r.start, end: r.end,
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
    const occs = classifyRoleTitle(r.title, ctx);
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
      _s: s, _e: e,
    });
  }
  return { roles, doc };
}

// Degree fields → the occupation a graduate or student is hired into at entry level.
const FIELD_OCC = [
  [/\b(computer science|software|computer engineering|informatics)\b/i, 'software_engineer'],
  [/\b(data science|statistics|analytics)\b/i, 'data_analyst'],
  [/\b(information (technology|systems)|cybersecurity|network)\b/i, 'it_support'],
  [/\b(mechanical|aerospace|aeronautical)\b/i, 'mechanical_engineer'],
  [/\b(electrical|electronics)\b/i, 'electrical_engineer'],
  [/\bcivil\b/i, 'civil_engineer'],
  [/\b(industrial|manufacturing) engineering\b/i, 'manufacturing_engineer'],
  [/\b(accounting)\b/i, 'accountant'],
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
export function buildJobKeys({ resumeText = '', applications = [], profile = {}, now = new Date() } = {}) {
  const text = String(resumeText || '');
  const { roles, doc } = text.trim() ? resumeRoles(text, now) : { roles: [], doc: null };
  const nowMi = now.getUTCFullYear() * 12 + now.getUTCMonth();

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
  const education = educationKeys(doc, now);
  const city = String(profile?.city || '').trim() || String(doc?.basics?.location || '').trim();

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
    student: education.some((e) => e.studying),
    skills: [],
    specs: [...specs],
    credentials: resumeLicences(text),
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
const FOOD_OCCS = ['barista', 'cook', 'server', 'bartender', 'host', 'dishwasher', 'food_crew'];
const DOMAINS = [
  [/\b(cyber|information|network|application|cloud|product|it) ?security\b|\binfosec\b/i, ['security_engineer', 'security_analyst']],
  [/\bsecurity (industry|experience|operations|services|field|officer|guard|work)|\b(physical|private|armed|unarmed|protective) security\b|\bguard\b|\bloss prevention\b|\basset protection\b|\bsecurity\b(?![- ]?(clearance|engineer|architect|software))/i, ['security_officer', 'loss_prevention']],
  [/\b(nursing|acute care|med[- ]?surg|telemetry|icu|emergency department|clinical nursing|bedside)\b/i, ['registered_nurse', 'lpn', 'nurse_practitioner']],
  [/\b(patient care|caregiv\w*|home health|long[- ]term care|senior (living|care)|elderly|direct care|personal care)\b/i, ['cna', 'caregiver', 'lpn', 'registered_nurse']],
  [/\b(retail|store|sales floor|merchandising)\b/i, RETAIL_OCCS],
  [/\b(cash handling|cashier|pos|point of sale)\b/i, [...RETAIL_OCCS, ...FOOD_OCCS, 'bank_teller', 'valet']],
  [/\b(restaurant|food service|kitchen|culinary|line cook|cooking|fine[- ]dining|serving|server|bartend\w*|barista|food and beverage|food & beverage|qsr)\b/i, FOOD_OCCS],
  [/\b(warehouse|distribution|forklift|material handling|picking|packing|shipping|receiving)\b/i, ['warehouse_associate', 'inventory_specialist']],
  [/\b(driving|cdl|truck|tractor[- ]trailer|delivery|commercial driv\w*|class a)\b/i, ['truck_driver_cdl', 'delivery_driver']],
  [/\b(call center|contact center|call centre|customer support|help ?desk)\b/i, ['customer_service']],
  [/\b(customer service|customer[- ]facing|client[- ]facing|guest service)\b/i, ['customer_service', 'receptionist', 'hotel_front_desk', ...RETAIL_OCCS, ...FOOD_OCCS, 'bank_teller', 'valet', 'medical_receptionist']],
  [/\b(customer success|account management|saas)\b/i, ['customer_success', 'account_manager', 'account_executive']],
  [/\b(sales|quota|business development|selling)\b/i, ['sales_rep', 'account_executive', 'account_manager', 'sdr', 'retail_associate', 'insurance_agent', 'real_estate_agent']],
  [/\b(administrative|office|clerical|reception|data entry|executive support)\b/i, ['admin_assistant', 'receptionist', 'medical_receptionist', 'legal_assistant']],
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
const INDUSTRY_AGNOSTIC = new Set(['account_manager', 'account_executive', 'sales_rep', 'sdr', 'customer_success', 'customer_service', 'admin_assistant', 'receptionist', 'operations', 'logistics_coordinator', 'project_manager', 'hr_generalist', 'recruiter', 'marketing', 'data_analyst', 'accountant', 'financial_analyst', 'it_support', 'instructor']);
const SPECIAL_DOMAINS = [
  { id: 'security', re: /\b(physical security|security (officers?|guards?|services|solutions|provider|company|industry|operations|personnel|patrol|post orders?)|protective services|guard (services|card)|post orders|armed|unarmed)\b/gi, ids: ['security_officer', 'loss_prevention'] },
  { id: 'nursing', re: /\b(registered nurses?|rns?\b|lpns?|lvns?|nursing (staff|care|agency|services)|patient care|clinical staff)\b/gi, ids: ['registered_nurse', 'lpn', 'cna', 'caregiver', 'nurse_practitioner', 'medical_assistant', 'medical_receptionist'] },
  { id: 'trucking', re: /\b(cdl|tractor[- ]trailers?|over[- ]the[- ]road|otr|freight carrier|dispatch(ers)?|truckload)\b/gi, ids: ['truck_driver_cdl', 'delivery_driver', 'logistics_coordinator'] },
];
const MANAGEMENT_RE =/\b(supervis\w*|management|managing|manager|leadership|leading (a )?teams?|people leader|lead(ing)? (a )?(team|crew|staff)|team lead)\b/i;
const NUM_WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15 };
// Every gap is a single optional space (\s?), so no two quantifiers can share the same characters (linear time).
const YEARS_RE = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)(?: ?\(\d{1,2}\))? ?(?:\+|plus|or more)? ?(?:(?:-|–|to) ?(?:\d{1,2}|two|three|four|five|six|seven|eight|ten) ?)?(?:years?|yrs?)\b/i;
const NOT_EXPERIENCE_RE = /\b(years? (old|of age|in business|of service to|serving)|founded|for (over|more than) \d+ years|age(d)? \d+|\d+ years? (warranty|lease|contract term)|celebrat\w+|anniversary|in operation|history of|legacy of|been (in business|around))\b/i;
const PREFERRED_RE = /\b(prefer\w*|a plus|nice to have|bonus|desired|ideally|ideal candidate|advantageous|is helpful|helpful)\b/i;

/** Required experience minimums a posting states: [{ years, domains: [occupation ids], management, text }]. */
export function statedMinimums(job) {
  const desc = String(job?.description || '');
  const out = [];
  const seen = new Set();
  const add = (years, sentence) => {
    if (!Number.isFinite(years) || years < 1 || years > 30) return;
    const s = String(sentence || '').slice(0, 300);
    const key = `${years}|${s.slice(0, 120).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const domains = new Set();
    const groups = [];
    for (const [re, ids] of DOMAINS) if (re.test(s)) { groups.push(ids); for (const id of ids) domains.add(id); }
    // "security or operations" = either; "operations experience in banking" = both.
    const anyOf = groups.length < 2 || /\bor\b|\/|\beither\b|\bsimilar\b|\brelated\b/i.test(s);
    out.push({ years, domains: [...domains], groups, anyOf, management: MANAGEMENT_RE.test(s), text: s });
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
      if (/\b(preferred|nice to have|bonus|desired|pluses|a plus|good to have|ideal)\b/i.test(head)) { preferredSection = true; continue; }
      if (/\b(required|requirements|minimum|qualifications|must have|what you need|who you are|responsibilities|about|benefits|duties|skills)\b/i.test(head)) { preferredSection = false; }
    }
    if (preferredSection) continue;
    for (const s of sentencesOf(line)) {
    if (!/\bexperience|experienced\b/i.test(s) || NOT_EXPERIENCE_RE.test(s) || PREFERRED_RE.test(s)) continue;
    const m = s.match(YEARS_RE);
    if (!m) continue;
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
  if (r.current) return `You're a ${r.title}${at}${span ? ` (${span})` : ''}.`.replace(/You're a ([AEIOU])/, "You're an $1");
  return `You were a ${r.title}${at}${span ? ` (${span})` : ''}.`.replace(/You were a ([AEIOU])/, 'You were an $1');
}
const fmtDay = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isFinite(d.getTime()) ? `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` : iso; };

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
const meets = (have, need) => have >= need || (have >= need / 2 && need - have <= 1);

/**
 * THE match rule (rail and email). Pure: no I/O. Place and liveness are the caller's (placeMatch / the read).
 * @param {object} job  a jobs row (title, company, description, …)
 * @param {object} keys buildJobKeys(...)
 * @returns {{ ok: true, occupation: string, basis: 'title'|'held'|'close'|'applied'|'education', reason: string, rank: number, need: number|null, have: number|null }
 *          | { ok: false, why: string }}
 */
export function matchListing(job, keys, { now = new Date(), alert = false, mode = 'rail' } = {}) {
  if (!job || !keys) return { ok: false, why: 'no_input' };
  const title = String(job.title || '').trim();
  if (!title) return { ok: false, why: 'no_title' };
  const desc = String(job.description || '');
  const occ = classifyTitle(title, `${job.company || ''} ${desc.slice(0, 1500)}`);
  if (!occ || occ.id === 'ai_training') return { ok: false, why: 'field_unknown' };
  const listLevel = levelOf(title);
  const nowYear = now.getUTCFullYear();
  const occs = keys.occupations || [];

  // (a) Field: held, close neighbour, applied to, or studied.
  // A field counts as held when the work was real: six months or more, current, or within the last year.
  const substantial = (o) => o.held && (o.years >= 0.5 || o.current || (o.last_year && nowYear - o.last_year <= 1));
  const held = occs.find((o) => o.occupation === occ.id && substantial(o));
  // A neighbouring field lends its years only when that work is recent (last 3 years) or long (2+ years).
  const lends = (o) => substantial(o) && (o.current || o.years >= 2 || (o.last_year && nowYear - o.last_year <= 3));
  const close = held ? null : occs.filter((o) => lends(o) && ((OCC_BY_ID.get(o.occupation)?.adj || []).includes(occ.id) || (OCC_BY_ID.get(occ.id)?.adj || []).includes(o.occupation)))
    .sort((a, b) => b.years - a.years)[0] || null;
  const applied = (keys.applied || []).find((a) => a.occupation === occ.id) || null;
  // A degree opens entry-level work in its field only for students, recent graduates (within a year) and
  // people with under a year of regular work — never for a 10-year support lead with a 2016 B.A.
  const eduOk = (e) => e.studying || (e.year && nowYear - e.year <= 1) || (Number(keys.years_total) || 0) < 1;
  const edu = (keys.education || []).find((e) => e.occupation === occ.id && eduOk(e)) || null;
  // Transferable work (TRANSFER): teaching → training / learning design when they applied to it lately;
  // training people inside another job (a support lead who onboards agents) → trainer roles.
  const transfer = held || close ? null : transferFrom(keys, occ.id, !!applied, nowYear);
  let basis = held ? 'held' : close ? 'close' : transfer && !applied ? 'transfer' : applied ? 'applied' : edu ? 'education' : alert ? 'alert' : null;
  if (!basis) return { ok: false, why: 'different_field' };
  // A field they left four or more years ago for other work (an electrician's warehouse job in 2015, a
  // retail lead's call-center year in 2016) is behind them — unless they applied to that kind of job lately.
  const fieldOcc = held || close;
  if (fieldOcc && !applied && !fieldOcc.current && fieldOcc.last_year && nowYear - fieldOcc.last_year >= 4
    && occs.some((o) => o !== fieldOcc && substantial(o) && (o.current || (o.last_year && o.last_year > fieldOcc.last_year)))) return { ok: false, why: 'left_field' };
  if ((keys.never || []).includes(occ.id)) return { ok: false, why: 'never' };

  // (a2) A tech listing that names a specialisation the person's tech titles never held (frontend for a
  // backend engineer, embedded, ML, security…) is a different job.
  if (TECH_OCCS.has(occ.id) && (basis === 'held' || basis === 'close')) {
    const mine = new Set(keys.specs || []);
    if (mine.size) {
      // A frontend / mobile developer has not held backend, data or SRE work either.
      const clientOnly = [...mine].every((x) => ['frontend', 'mobile', 'fullstack'].includes(x));
      const foreign = [...specialisationsOf(title)].filter((s) => (DISTINCT_SPECS.has(s) || (clientOnly && ['backend', 'data', 'sre'].includes(s))) && !mine.has(s) && !(s === 'frontend' && mine.has('fullstack')));
      if (foreign.length) return { ok: false, why: `specialisation:${foreign[0]}` };
      if (clientOnly && (basis === 'close' || /\b(observability|infrastructure|devops|platform|distributed|back[- ]?end|data|hpc|cloud|kernel|compiler)\b/i.test(title))) return { ok: false, why: 'specialisation:backend' };
    }
  }

  // (a3) STEP-DOWN: the junior job they were promoted out of (an account executive's SDR years, an RN's
  // patient-care-tech job in school, a teacher's aide years), or a listing two levels under where they
  // work now — unless they applied to that kind of job lately.
  if (!applied) {
    const juniorLast = held ? (held.current ? nowYear : held.last_year || 0) : -1;
    const promoted = (SUCCESSORS[occ.id] || []).some((sid) => {
      const s = occs.find((o) => o.occupation === sid && substantial(o));
      return s && (s.current ? nowYear : s.last_year || 0) >= juniorLast;
    });
    if (promoted) return { ok: false, why: 'step_down' };
    const cur = Number(keys.level?.current);
    if (Number.isFinite(cur) && listLevel >= 1 && listLevel <= cur - 2) return { ok: false, why: 'step_down_level' };
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
    const ceiling = basis === 'transfer' ? Math.min(2, transfer.level)
      : basis === 'applied' ? (transfer ? Math.max(1, Math.min(2, transfer.level)) : 1)
      : basis === 'education' ? 1 : basis === 'close' ? fieldLevel : fieldLevel + 1;
    if (listLevel > ceiling) return { ok: false, why: 'level' };
    if (listLevel >= 3 && !(keys.level?.managed_people)) return { ok: false, why: 'management' };
    // A senior / lead / manager title takes years in the field, even when the posting does not say how many.
    if (basis === 'held' || basis === 'close') {
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
  let need = null; let have = null; let haveFrom = null;
  if ((basis === 'applied' && !transfer) || basis === 'education') {
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
      const groups = Array.isArray(m.groups) && m.groups.length ? m.groups : (m.domains.length ? [m.domains] : []);
      // Inside each named field, the person's own occupations in this listing's field come first: "3 years
      // of sales experience" for an account executive is not met by years as a retail sales associate.
      // The listing's own job type counts first and alone ("2+ years of account management" for an account
      // manager = years as an account manager, not retail sales); a neighbour only when the listing's own
      // type is not what the sentence names; another field only when the sentence names another field.
      const own = held ? occ.id : close ? close.occupation : occ.id;
      const per = groups.map((g) => {
        if (g.includes(occ.id) || g.includes(own)) return bestYears(keys, [own]);
        const inside = g.filter((id) => group.includes(id));
        return bestYears(keys, inside.length ? inside : g);
      });
      let h = null;
      if (per.length) h = m.anyOf === false ? per.reduce((a, b) => (b.years < a.years ? b : a)) : per.reduce((a, b) => (b.years > a.years ? b : a));
      if (m.management) {
        const mg = { years: Number(keys.level?.management_years) || 0, occ: 'management' };
        h = h ? (h.years < mg.years ? h : mg) : mg;
      } else if (!h) {
        h = bestYears(keys, [held ? occ.id : close ? close.occupation : occ.id]);
      }
      // "4+ years as a licensed master electrician": years AT that grade, from the roles titled with it.
      const grade = (m.text.match(GRADE_RE) || [])[1];
      if (grade) {
        const own = (held || close)?.roles || [];
        const y = gradeYears(keys, own, grade, now);
        h = { years: y, occ: `grade:${grade.toLowerCase()}` };
      }
      if (!(h.years > 0) || !meets(h.years, m.years)) return { ok: false, why: `years:${m.years}`, need: m.years, have: h.years };
      if (need == null || m.years > need) { need = m.years; have = h.years; haveFrom = h.occ; }
    }
  }
  // A TEASER (a ~500-char summary: Adzuna rows, cut-off previews) hides its requirements — the GSG incident.
  // Email mode returns it flagged `summaryOnly`; the cron reads the full posting and runs this rule again,
  // and drops it when that fails or the posting cannot be read. The rail shows one only for the person's own
  // current title or a job type they applied to, and says it is a summary.
  const teaser = isTeaser(job);
  if (teaser && basis !== 'alert' && mode !== 'email') {
    const ownCurrent = (held?.roles || []).some((i) => keys.roles[i]?.current && coreTitle(keys.roles[i].title) && (coreTitle(title) === coreTitle(keys.roles[i].title) || coreTitle(title).includes(coreTitle(keys.roles[i].title)) || coreTitle(keys.roles[i].title).includes(coreTitle(title))));
    if (!(ownCurrent && listLevel <= fieldLevel) && basis !== 'applied') return { ok: false, why: 'teaser' };
  }

  // A job alert's own field (the person chose the words): requirements checked, the alert is the reason.
  if (basis === 'alert') return { ok: true, occupation: occ.id, basis, reason: '', rank: 0, need, have, level: listLevel };

  // The reason — built from the keys, never from the listing alone.
  const roles = keys.roles || [];
  let reason = ''; let rank = 0;
  if (basis === 'held' || basis === 'close') {
    const o = held || close;
    const best = latestRole(o.roles.map((i) => roles[i]).filter(Boolean));
    if (!best) return { ok: false, why: 'no_reason' };
    const own = o.roles.map((i) => roles[i]).filter(Boolean);
    const sameTitle = own.some((r) => coreTitle(r.title) && (coreTitle(title) === coreTitle(r.title) || coreTitle(title).includes(coreTitle(r.title))));
    reason = roleSentence(best, { close: basis === 'close' });
    if (need != null) reason += ` ${yearsClause(keys, need, have, haveFrom, now)}`;
    if (basis === 'held' && sameTitle) basis = 'title';
    const lastYear = o.current ? nowYear : (o.last_year || 0);
    // Recent work outranks an old title match: a 2017 job is a weaker reason than today's.
    rank = (basis === 'title' ? 300 : basis === 'held' ? 250 : 180) + (o.current ? 120 : Math.max(0, 120 - (nowYear - lastYear) * 25)) + Math.min(20, o.years * 3);
  } else if (basis === 'transfer') {
    const r = transfer.role;
    const at = r.company ? ` at ${r.company}` : '';
    const span = roleSpan(r);
    reason = `You ${transfer.kind === 'teach' ? 'teach' : 'train people'} as ${article(r.title)} ${r.title}${at}${span ? ` (${span})` : ''}.`;
    if (need != null) reason += ` ${haveFrom === transfer.from ? `They ask for ${need}+ year${need === 1 ? '' : 's'}; you have about ${shownYears(have)} year${shownYears(have) === 1 ? '' : 's'} ${transfer.kind === 'teach' ? 'teaching' : 'training people'}.` : yearsClause(keys, need, have, haveFrom, now)}`;
    rank = 190;
  } else if (basis === 'applied') {
    reason = `Similar to the ${applied.title} job${applied.company ? ` at ${applied.company}` : ''} you applied to on ${fmtDay(applied.at)}.`;
    if (need != null && transfer) reason += ` ${haveFrom === transfer.from ? `They ask for ${need}+ year${need === 1 ? '' : 's'}; you have about ${shownYears(have)} year${shownYears(have) === 1 ? '' : 's'} ${transfer.kind === 'teach' ? 'teaching' : 'training people'}.` : yearsClause(keys, need, have, haveFrom, now)}`;
    rank = 200;
  } else {
    reason = edu.studying
      ? `An internship in your field: you're studying ${edu.field || edu.degree}${edu.school ? ` at ${edu.school}` : ''}.`
      : `Entry level in your field: your ${[edu.degree, edu.field].filter(Boolean).join(' in ')}${edu.year ? ` (${edu.year})` : ''}.`;
    rank = 170;
  }
  if (applied && basis !== 'applied') rank += 15; // like something they applied to recently
  return { ok: true, occupation: occ.id, basis, reason, rank, need, have, haveFrom, level: listLevel, summaryOnly: teaser };
}

/** A summary, not a posting: an Adzuna teaser, a cut-off preview, or under 700 characters. */
export function isTeaser(job) {
  const d = String(job?.description || '').replace(/\s+/g, ' ').trim();
  return isDescriptionPreview(job) || d.length < MIN_FULL || /(…|\.\.\.)$/.test(d);
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
export const shownYears = (y) => Math.max(1, Math.round(Number(y) || 0));
/** "They ask for 3+ years; you have about 4 as a Cashier." — the number and the job both come from the keys. */
function yearsClause(keys, need, have, from, now = new Date()) {
  const ask = `They ask for ${need}+ year${need === 1 ? '' : 's'}`;
  if (from === 'management') {
    const n = shownYears(have);
    const r = latestRole((keys.roles || []).filter((x) => x.managed));
    return `${ask} leading people; you have about ${n} year${n === 1 ? '' : 's'}${r ? `, most recently as ${article(r.title)} ${r.title}` : ''}.`;
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
  if (!parts.length) return `${ask}.`;
  const said = parts.slice(0, 2).map((p) => `${p.years < 0.5 ? 'under a year' : `about ${shownYears(p.years)} year${shownYears(p.years) === 1 ? '' : 's'}`} as ${article(p.title)} ${p.title}`);
  return `${ask}; you have ${said.join(' and ')}.`;
}

/** Years per exact job title among some roles, most recent title first: [{ title, years }]. */
export function titleYearParts(keys, roleIdx, now = new Date()) {
  const nowMi = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const groups = new Map();
  for (const i of roleIdx) {
    const r = (keys.roles || [])[i];
    if (!r) continue;
    const k = normTitle(r.title);
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
const article = (w) => (/^[aeiou]/i.test(String(w || '')) ? 'an' : 'a');

function coreTitle(t) {
  return normTitle(t).replace(/\b(senior|sr|junior|jr|lead|i|ii|iii|iv|part time|full time|seasonal|temporary|temp|remote|hybrid|\d+(st|nd|rd|th)? shift|shift|days|nights|weekend|ft|pt|level \d)\b/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const FOREIGN_RE = /\b(canada|canadian|mexico|uk|united kingdom|england|london|ireland|dublin|germany|german|berlin|munich|dusseldorf|france|paris|spain|madrid|portugal|italy|netherlands|amsterdam|poland|norway|sweden|denmark|finland|europe|european|emea|apac|latam|dach|india|bangalore|philippines|manila|australia|sydney|brisbane|singapore|japan|tokyo|brazil|argentina|colombia|senegal|nigeria|kenya|south africa|israel|uae|dubai|taiwan|korea|vietnam|worldwide|global)\b/i;

// "based in Germany", "must reside in Canada", "hybrid from our London office" — built once from the literal
// FOREIGN_RE above (no listing text ever reaches a RegExp constructor).
const FOREIGN_NAMES = FOREIGN_RE.source.replace(/^\\b\(|\)\\b$/g, '').replace(/\|worldwide\|global/, '');
const TIED_ABROAD_RE = new RegExp(`\\b(based (in|out of)|reside (in|within)|residing in|located in|live in|living in|resident of|from our|office in|offices in|eligible to work in|right to work in|hybrid (in|from)) (the )?(${FOREIGN_NAMES})\\b`, 'i');

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
  if (remote) {
    // Remote is not a passport: US-remote only. A region or a country abroad in the title, the location
    // or the top of the posting → not here; a bare "Remote"/"Worldwide" needs the posting to say the US.
    if (FOREIGN_RE.test(`${job?.title || ''} ${loc}`) || /\b(european|europe|emea|latam|apac)\b/i.test(`${job?.title || ''} ${loc}`)) return { ok: false, remote: true, miles: null };
    // Plain "Remote" from a US board is US-remote; it is out when the posting ties the job to another
    // country ("based in Germany", "must reside in Canada", "hybrid from our London office") or says worldwide.
    if (/\b(worldwide|global)\b/i.test(loc) || TIED_ABROAD_RE.test(head.replace(/\s+/g, ' '))) return { ok: false, remote: true, miles: null };
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

export const _internals = { LICENCES, LIC_BY_ID, LEVEL_WORDS, coreTitle, monthIndex };
