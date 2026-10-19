// Parser lexicon — the vocabulary every résumé-structure decision leans on.
//
// Hand-authored, permissively usable, and deliberately broad across industries (retail, trades,
// healthcare, logistics, office, tech): a title lexicon that only knows "engineer" and "manager"
// would drop the valet, the phlebotomist and the line cook. Every list is a plain export so tests
// and the health engine can reuse it. No I/O.

// ── Section header vocabulary → canonical kind ───────────────────────────────────────────────
// Keys are lower-cased, punctuation-stripped header phrases exactly as they appear on résumés.
export const HEADER_VOCAB = new Map(Object.entries({
  // experience
  'experience': 'experience', 'work experience': 'experience', 'professional experience': 'experience',
  'employment': 'experience', 'employment history': 'experience', 'work history': 'experience',
  'career history': 'experience', 'relevant experience': 'experience', 'professional background': 'experience',
  'positions held': 'experience', 'professional history': 'experience', 'career experience': 'experience',
  'experience history': 'experience', 'job history': 'experience', 'work': 'experience',
  'relevant work experience': 'experience', 'professional work experience': 'experience',
  'internships': 'experience', 'internship experience': 'experience', 'military experience': 'experience',
  'leadership experience': 'experience', 'research experience': 'experience', 'teaching experience': 'experience',
  'clinical experience': 'experience', 'additional experience': 'experience', 'other experience': 'experience',
  // education
  'education': 'education', 'academic background': 'education', 'academics': 'education',
  'education and training': 'education', 'education & training': 'education', 'training': 'education',
  'academic history': 'education', 'educational background': 'education', 'qualifications': 'education',
  'education and certifications': 'education', 'education & certifications': 'education',
  'education and credentials': 'education', 'academic qualifications': 'education',
  // skills
  'skills': 'skills', 'technical skills': 'skills', 'core competencies': 'skills', 'key skills': 'skills',
  'competencies': 'skills', 'areas of expertise': 'skills', 'expertise': 'skills', 'technologies': 'skills',
  'tools': 'skills', 'technical proficiencies': 'skills', 'skills and abilities': 'skills', 'skills & abilities': 'skills',
  'skills summary': 'skills', 'professional skills': 'skills', 'core skills': 'skills', 'skill set': 'skills',
  'technical expertise': 'skills', 'tools and technologies': 'skills', 'tools & technologies': 'skills',
  'relevant skills': 'skills', 'highlights': 'skills', 'key qualifications': 'skills', 'strengths': 'skills',
  'areas of knowledge': 'skills', 'technical summary': 'skills', 'tech stack': 'skills', 'proficiencies': 'skills',
  'skills and interests': 'skills', 'skills & interests': 'skills', 'skills and certifications': 'skills',
  'skills & certifications': 'skills', 'software': 'skills', 'computer skills': 'skills', 'equipment': 'skills',
  // summary
  'summary': 'summary', 'professional summary': 'summary', 'profile': 'summary', 'professional profile': 'summary',
  'about': 'summary', 'about me': 'summary', 'objective': 'summary', 'career objective': 'summary',
  'overview': 'summary', 'executive summary': 'summary', 'summary of qualifications': 'summary',
  'qualifications summary': 'summary', 'career summary': 'summary', 'personal statement': 'summary',
  'personal profile': 'summary', 'introduction': 'summary', 'statement': 'summary', 'career profile': 'summary',
  // certifications
  'certifications': 'certifications', 'certificates': 'certifications', 'licenses': 'certifications',
  'licences': 'certifications', 'licenses and certifications': 'certifications', 'licenses & certifications': 'certifications',
  'licensure': 'certifications', 'credentials': 'certifications', 'professional certifications': 'certifications',
  'training and certifications': 'certifications', 'training & certifications': 'certifications',
  'certifications and licenses': 'certifications', 'certifications & licenses': 'certifications',
  'certifications and training': 'certifications', 'certifications & training': 'certifications',
  'professional development': 'certifications', 'courses': 'certifications', 'certification': 'certifications',
  // projects
  'projects': 'projects', 'selected projects': 'projects', 'personal projects': 'projects', 'key projects': 'projects',
  'portfolio': 'projects', 'notable projects': 'projects', 'academic projects': 'projects', 'side projects': 'projects',
  'technical projects': 'projects', 'project experience': 'projects', 'relevant projects': 'projects',
  // languages
  'languages': 'languages', 'language skills': 'languages', 'spoken languages': 'languages',
  // extras
  'awards': 'awards', 'honors': 'awards', 'honours': 'awards', 'honors and awards': 'awards', 'honors & awards': 'awards',
  'awards and honors': 'awards', 'awards & honors': 'awards', 'achievements': 'awards', 'accomplishments': 'awards',
  'recognition': 'awards', 'key achievements': 'awards', 'awards and recognition': 'awards', 'awards & recognition': 'awards',
  'publications': 'publications', 'research': 'publications', 'papers': 'publications', 'presentations': 'publications',
  'publications and presentations': 'publications', 'conference presentations': 'publications',
  'volunteer': 'volunteer', 'volunteering': 'volunteer', 'volunteer experience': 'volunteer', 'volunteer work': 'volunteer',
  'community involvement': 'volunteer', 'community service': 'volunteer', 'community': 'volunteer', 'service': 'volunteer',
  'interests': 'interests', 'hobbies': 'interests', 'activities': 'interests', 'extracurricular activities': 'interests',
  'interests and hobbies': 'interests', 'interests & hobbies': 'interests', 'extracurriculars': 'interests',
  'hobbies and interests': 'interests', 'hobbies & interests': 'interests', 'personal interests': 'interests',
  'affiliations': 'affiliations', 'memberships': 'affiliations', 'professional affiliations': 'affiliations',
  'professional memberships': 'affiliations', 'associations': 'affiliations', 'organizations': 'affiliations',
  'professional organizations': 'affiliations', 'leadership': 'affiliations', 'leadership and activities': 'affiliations',
  'references': 'references', 'referees': 'references',
  'additional information': 'custom', 'additional': 'custom', 'other': 'custom', 'miscellaneous': 'custom',
  'additional skills': 'skills', 'additional qualifications': 'custom', 'personal': 'custom', 'personal details': 'contact',
  'contact': 'contact', 'contact information': 'contact', 'contact details': 'contact', 'contact info': 'contact',
  'personal information': 'contact', 'details': 'contact',
}));

// ── Job-title vocabulary (one of these words makes a line read as a title) ───────────────────
export const TITLE_WORDS = [
  // corporate / office
  'engineer', 'developer', 'programmer', 'architect', 'manager', 'director', 'designer', 'analyst', 'consultant',
  'lead', 'specialist', 'coordinator', 'associate', 'officer', 'administrator', 'scientist', 'intern', 'president',
  'founder', 'cofounder', 'co-founder', 'head', 'chief', 'vp', 'vice president', 'supervisor', 'representative', 'rep',
  'recruiter', 'accountant', 'bookkeeper', 'controller', 'auditor', 'strategist', 'marketer', 'writer', 'editor', 'producer',
  'owner', 'partner', 'advisor', 'adviser', 'principal', 'fellow', 'assistant', 'agent', 'clerk', 'operator', 'planner',
  'buyer', 'paralegal', 'attorney', 'lawyer', 'counsel', 'executive', 'secretary', 'receptionist', 'teller', 'banker',
  'underwriter', 'actuary', 'trader', 'broker', 'realtor', 'appraiser', 'adjuster', 'estimator', 'scheduler', 'dispatcher',
  'translator', 'interpreter', 'librarian', 'archivist', 'curator', 'researcher', 'statistician', 'economist',
  'copywriter', 'journalist', 'reporter', 'photographer', 'videographer', 'animator', 'illustrator', 'artist',
  'ux', 'ui', 'product', 'scrum master', 'project manager', 'program manager', 'account executive', 'sdr', 'bdr',
  'customer success', 'support', 'helpdesk', 'help desk', 'technician', 'tech', 'engineer ii', 'engineer i',
  // healthcare
  'nurse', 'rn', 'lpn', 'lvn', 'cna', 'physician', 'surgeon', 'doctor', 'dentist', 'hygienist', 'therapist', 'pharmacist',
  'pharmacy technician', 'phlebotomist', 'paramedic', 'emt', 'medical assistant', 'caregiver', 'orderly', 'dietitian',
  'nutritionist', 'radiologic', 'sonographer', 'optician', 'veterinarian', 'vet tech', 'chiropractor', 'counselor',
  'social worker', 'case manager', 'home health aide', 'aide', 'scribe', 'coder', 'biller',
  // education
  'teacher', 'professor', 'instructor', 'tutor', 'lecturer', 'educator', 'trainer', 'coach', 'principal', 'dean',
  'paraprofessional', 'teaching assistant', 'ta', 'substitute',
  // trades / industrial / logistics
  'mechanic', 'welder', 'electrician', 'plumber', 'carpenter', 'painter', 'roofer', 'machinist', 'fabricator', 'assembler',
  'inspector', 'foreman', 'laborer', 'labourer', 'installer', 'hvac', 'lineman', 'millwright', 'pipefitter', 'mason',
  'glazier', 'drywall', 'framer', 'ironworker', 'operator', 'driver', 'courier', 'trucker', 'cdl', 'forklift', 'picker',
  'packer', 'stocker', 'loader', 'sorter', 'handler', 'shipper', 'receiver', 'mover', 'material handler',
  'order builder', 'order selector', 'order picker', 'associate', 'team member', 'crew member', 'crew',
  'janitor', 'custodian', 'cleaner',
  'groundskeeper', 'landscaper', 'detailer', 'valet', 'attendant', 'porter', 'security', 'guard', 'officer', 'dispatcher',
  'lineworker', 'technologist', 'apprentice', 'journeyman', 'helper', 'rigger', 'crane', 'surveyor', 'drafter',
  // retail / service / hospitality
  'cashier', 'sales', 'salesperson', 'merchandiser', 'stylist', 'barber', 'cosmetologist', 'esthetician', 'cook', 'chef',
  'line cook', 'prep cook', 'sous chef', 'server', 'waiter', 'waitress', 'bartender', 'barista', 'dishwasher', 'host',
  'hostess', 'busser', 'greeter', 'bagger', 'concierge', 'housekeeper', 'housekeeping', 'front desk', 'manager on duty',
  'shift lead', 'shift leader', 'shift supervisor', 'key holder', 'keyholder', 'store manager', 'assistant manager',
  'general manager', 'gm', 'team lead', 'team leader', 'crew lead', 'brand ambassador', 'promoter', 'cashier lead',
  'rider', 'shopper', 'caterer', 'baker', 'butcher', 'florist', 'lifeguard', 'instructor', 'camp counselor',
  'nanny', 'babysitter', 'sitter', 'tutor', 'volunteer', 'member', 'freelancer', 'contractor', 'self-employed', 'entrepreneur',
  'firefighter', 'police', 'deputy', 'sheriff', 'corrections', 'soldier', 'sergeant', 'corporal', 'specialist', 'airman',
  'seaman', 'marine', 'pilot', 'flight attendant', 'steward', 'captain', 'lieutenant',
];
const TITLE_SRC = TITLE_WORDS
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
  .join('|');
export const TITLE_WORD_RE = new RegExp(`\\b(?:${TITLE_SRC})\\b`, 'i');

// Seniority / level prefixes and suffixes that decorate titles.
export const SENIORITY_RE = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|chief|head|associate|assistant|entry[- ]level|mid[- ]level|executive|distinguished|fellow|apprentice|trainee|intern|i{1,3}|iv|v)\b/i;

// ── Company cues ──────────────────────────────────────────────────────────────────────────────
export const COMPANY_SUFFIX_RE = /\b(inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|limited|corp\.?|corporation|co\.|company|plc|gmbh|s\.a\.|pty|llp|lp|group|holdings|partners|enterprises|industries|international|global|worldwide|technologies|technology|tech|solutions|systems|services|labs?|studios?|agency|associates|foundation|institute|clinic|hospital|health(?:care)?|medical center|bank|credit union|insurance|realty|properties|logistics|distribution(?: center)?|fulfillment(?: center)?|warehouse|market|supermarket|store|stores|shop|mart|depot|restaurant|grill|kitchen|cafe|café|coffee|bakery|brewery|pizza|burger|tacos?|diner|bistro|bar|lounge|hotel|resort|inn|spa|salon|gym|fitness|club|school|academy|university|college|district|county|city of|state of|department|ministry|army|navy|air force|marines|coast guard|national guard|church|ymca|motors|automotive|auto|dealership|airlines|airways|railway|transit|trucking|freight|shipping|express|construction|builders|contracting|electric|plumbing|hvac|roofing|landscaping|cleaning|staffing|consulting|advisors|capital|ventures|media|entertainment|studios|games|publishing|press|news|radio|network|communications|telecom|wireless|energy|oil|gas|mining|farms?|ranch|nursery|dental|pediatrics|pharmacy|labs|diagnostics|imaging|therapy|rehab|senior living|assisted living|home care|hospice|daycare|childcare|preschool|elementary|high school|middle school|boutique|outfitters|apparel|jewelers|cosmetics|beauty|nails|barbershop|tattoo|photography|design|architects|engineering|manufacturing|machining|welding|fabrication|packaging|printing|signs|graphics|software|cloud|data|analytics|ai|security|defense|aerospace|robotics|biotech|pharma(?:ceuticals)?|devices|instruments|equipment|rentals?|supply|supplies|wholesale|imports?|exports?|trading|traders|brokerage|exchange|payments|fintech|lending|mortgage|title|escrow|law|legal|attorneys|cpa|accounting|tax|payroll|hr|recruiting|talent|outsourcing|call center|contact center|bpo|utilities|water|power|solar|wind|nuclear|chemicals|plastics|steel|metals|lumber|paper|textiles|foods?|beverages?|brands|products|goods|retail|e-?commerce|marketplace|platform|app|apps|digital|online|interactive|creative|marketing|advertising|pr|events|productions?|films?|pictures|records|music|theater|theatre|museum|library|zoo|parks?|recreation)\b\.?$/i;
// Well-known big employers are often written bare ("Amazon", "Target", "Walmart"); the cue lists
// above can't know them all, so a bare capitalized 1–3 word line in a header position is allowed
// to be a company when no title word is present — see experience.js resolution.

// ── Location patterns ─────────────────────────────────────────────────────────────────────────
export const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const CA_PROVINCES = 'AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT';
// Full region names a "City, Region" location may end with (US states, Canadian provinces, UK
// nations, and the countries most often seen on English-language résumés). Without this list,
// "Registered Nurse, Telemetry" reads as a city/region pair.
export const REGION_NAMES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','District of Columbia','Puerto Rico',
  'Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland','Nova Scotia','Ontario','Prince Edward Island','Quebec','Québec','Saskatchewan','Yukon',
  'England','Scotland','Wales','Northern Ireland','Ireland','United Kingdom','UK','U.K.','Great Britain','Britain',
  'USA','U.S.A.','U.S.','US','United States','United States of America','Canada','Mexico','Australia','New Zealand','India','Pakistan','Bangladesh','Sri Lanka','Nepal','Philippines','Singapore','Malaysia','Indonesia','Thailand','Vietnam','Japan','China','Hong Kong','Taiwan','South Korea','Korea','Germany','France','Spain','Portugal','Italy','Netherlands','Belgium','Switzerland','Austria','Sweden','Norway','Denmark','Finland','Poland','Czech Republic','Hungary','Romania','Greece','Turkey','Israel','UAE','United Arab Emirates','Dubai','Saudi Arabia','Qatar','Egypt','Nigeria','Ghana','Kenya','South Africa','Ethiopia','Morocco','Brazil','Argentina','Chile','Colombia','Peru','Venezuela','Jamaica','Trinidad','Dominican Republic','Costa Rica','Panama','Guatemala','Ukraine','Russia',
];
const REGION_SRC = REGION_NAMES.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|');
// Major cities that appear BARE in résumé headers ("KPMG LLP, Manchester", "Leeds", "Toronto").
// Only a whole header piece equal to one of these (optionally ", Country") is read as a location —
// never a substring, so "Boston Consulting Group" stays a company.
export const KNOWN_CITIES = [
  'New York','New York City','NYC','Los Angeles','Chicago','Houston','Phoenix','Philadelphia','San Antonio','San Diego','Dallas','San Jose','Austin','Jacksonville','Fort Worth','Columbus','Charlotte','San Francisco','Indianapolis','Seattle','Denver','Washington','Boston','El Paso','Nashville','Detroit','Oklahoma City','Portland','Las Vegas','Memphis','Louisville','Baltimore','Milwaukee','Albuquerque','Tucson','Fresno','Sacramento','Mesa','Kansas City','Atlanta','Omaha','Colorado Springs','Raleigh','Miami','Long Beach','Virginia Beach','Oakland','Minneapolis','Tulsa','Tampa','Arlington','New Orleans','Wichita','Cleveland','Bakersfield','Aurora','Anaheim','Honolulu','Santa Ana','Riverside','Corpus Christi','Lexington','Henderson','Stockton','Saint Paul','St. Paul','Cincinnati','St. Louis','Saint Louis','Pittsburgh','Greensboro','Lincoln','Anchorage','Plano','Orlando','Irvine','Newark','Durham','Chula Vista','Toledo','Fort Wayne','St. Petersburg','Laredo','Jersey City','Chandler','Madison','Lubbock','Scottsdale','Reno','Buffalo','Gilbert','Glendale','North Las Vegas','Winston-Salem','Chesapeake','Norfolk','Fremont','Garland','Irving','Hialeah','Richmond','Boise','Spokane','Baton Rouge','Tacoma','San Bernardino','Modesto','Fontana','Des Moines','Moreno Valley','Santa Clarita','Fayetteville','Birmingham','Oxnard','Rochester','Port St. Lucie','Grand Rapids','Huntsville','Salt Lake City','Frisco','Yonkers','Amarillo','Glendale','Huntington Beach','McKinney','Montgomery','Augusta','Akron','Little Rock','Tempe','Columbus','Overland Park','Grand Prairie','Tallahassee','Cape Coral','Mobile','Knoxville','Shreveport','Worcester','Ontario','Vancouver','Sioux Falls','Chattanooga','Brownsville','Fort Lauderdale','Providence','Newport News','Rancho Cucamonga','Santa Rosa','Peoria','Oceanside','Elk Grove','Salem','Pembroke Pines','Eugene','Garden Grove','Cary','Fort Collins','Corona','Springfield','Jackson','Alexandria','Hayward','Clarksville','Lakewood','Lancaster','Salinas','Palmdale','Hollywood','Springfield','Macon','Kansas City','Sunnyvale','Pomona','Killeen','Escondido','Pasadena','Naperville','Bellevue','Joliet','Murfreesboro','Midland','Rockford','Paterson','Savannah','Bridgeport','Torrance','McAllen','Syracuse','Surprise','Denton','Roseville','Thornton','Miramar','Pasadena','Mesquite','Olathe','Dayton','Carrollton','Waco','Orange','Fullerton','Charleston','West Valley City','Visalia','Hampton','Gainesville','Warren','Coral Springs','Cedar Rapids','Round Rock','Sterling Heights','Kent','Columbia','Santa Clara','New Haven','Stamford','Concord','Elizabeth','Athens','Thousand Oaks','Lafayette','Simi Valley','Topeka','Norman','Fargo','Wilmington','Abilene','Odessa','Pearland','Victorville','Hartford','Vallejo','Allentown','Berkeley','Richardson','Arvada','Ann Arbor','Cambridge','Sugar Land','Lansing','Evansville','College Station','Fairfield','Clearwater','Beaumont','Independence','Provo','West Jordan','Murrieta','Palm Bay','El Monte','Carlsbad','North Charleston','Temecula','Clovis','Springfield','Meridian','Westminster','Costa Mesa','High Point','Manchester','Pueblo','Lakeland','Pompano Beach','New Bedford','Flint','Allen','Billings','Scranton',
  'London','Manchester','Birmingham','Leeds','Glasgow','Edinburgh','Liverpool','Bristol','Sheffield','Newcastle','Nottingham','Cardiff','Belfast','Leicester','Coventry','Bradford','Southampton','Brighton','Cambridge','Oxford','Reading','Milton Keynes','Aberdeen','Dundee','York','Bath','Exeter','Norwich','Plymouth','Swansea','Derby','Stoke','Wolverhampton','Portsmouth','Luton','Northampton','Swindon','Croydon','Dublin','Cork','Galway','Limerick',
  'Toronto','Montreal','Montréal','Vancouver','Calgary','Edmonton','Ottawa','Winnipeg','Quebec City','Hamilton','Kitchener','Halifax','Victoria','Saskatoon','Regina','Mississauga','Brampton','Surrey','Burnaby','Markham',
  'Sydney','Melbourne','Brisbane','Perth','Adelaide','Canberra','Gold Coast','Auckland','Wellington','Christchurch',
  'Paris','Berlin','Munich','Hamburg','Frankfurt','Cologne','Stuttgart','Düsseldorf','Dusseldorf','Madrid','Barcelona','Valencia','Lisbon','Porto','Rome','Milan','Turin','Naples','Amsterdam','Rotterdam','The Hague','Utrecht','Eindhoven','Brussels','Antwerp','Zurich','Zürich','Geneva','Basel','Bern','Vienna','Stockholm','Gothenburg','Oslo','Copenhagen','Helsinki','Warsaw','Krakow','Kraków','Wroclaw','Prague','Budapest','Bucharest','Athens','Istanbul','Tel Aviv','Jerusalem','Haifa','Dubai','Abu Dhabi','Doha','Riyadh','Cairo','Lagos','Nairobi','Accra','Johannesburg','Cape Town','Durban','Casablanca',
  'Mumbai','Delhi','New Delhi','Bangalore','Bengaluru','Hyderabad','Chennai','Kolkata','Pune','Ahmedabad','Gurgaon','Gurugram','Noida','Karachi','Lahore','Islamabad','Dhaka','Colombo','Kathmandu','Manila','Cebu','Singapore','Kuala Lumpur','Jakarta','Bangkok','Ho Chi Minh City','Hanoi','Tokyo','Osaka','Kyoto','Seoul','Busan','Beijing','Shanghai','Shenzhen','Guangzhou','Hong Kong','Taipei',
  'São Paulo','Sao Paulo','Rio de Janeiro','Buenos Aires','Santiago','Bogotá','Bogota','Lima','Mexico City','Guadalajara','Monterrey','Kingston','San Juan','Panama City','San José','Montevideo','Kyiv','Kiev','Moscow','Saint Petersburg',
];
const CITY_SRC = [...new Set(KNOWN_CITIES)].map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|');
// "San Diego, CA" · "San Diego, California" · "London, UK" · "Toronto, ON" · "Remote" · "Berlin, Germany"
export const LOCATION_RE = new RegExp(
  `^(?:remote|hybrid|on-?site|work from home|wfh)(?:\\s*[-–—(,]\\s*[A-Za-z ,.]+\\)?)?$` +
  `|^[A-Z][A-Za-z.'’-]+(?:\\s+[A-Z][A-Za-z.'’-]+){0,3},\\s*(?:(?:${US_STATES}|${CA_PROVINCES})\\b|(?:${REGION_SRC})\\b)(?:\\s+\\d{5})?(?:,?\\s*(?:${REGION_SRC}))?(?:\\s*\\(?(?:remote|hybrid|on-?site)\\)?)?\\.?$` +
  `|^(?:${CITY_SRC})(?:,?\\s*(?:${REGION_SRC}))?(?:\\s*\\(?(?:remote|hybrid|on-?site)\\)?)?\\.?$`,
  'i'
);
// A location fragment INSIDE a longer line (returns the fragment).
export const LOCATION_INLINE_RE = new RegExp(
  `\\b([A-Z][A-Za-z.'’-]+(?:\\s+[A-Z][A-Za-z.'’-]+){0,3},\\s*(?:(?:${US_STATES}|${CA_PROVINCES})\\b(?:\\s+\\d{5})?|(?:${REGION_SRC})\\b)|\\b(?:Remote|Hybrid)\\b(?:\\s*[-–(]\\s*(?:US|USA|United States|Canada|UK|Worldwide)\\)?)?)`
);

export const EMPLOYMENT_TYPE_RE = /\b(full[-\s]?time|part[-\s]?time|contract(?:or|ual)?|contract[-\s]?to[-\s]?hire|c2h|temporary|temp|seasonal|intern(?:ship)?|freelance|per[-\s]?diem|prn|casual|volunteer|apprenticeship|self[-\s]?employed|remote|hybrid|on-?site|w2|1099|co-?op|fellowship|locum|consulting|agency)\b/i;

// ── Contact patterns ──────────────────────────────────────────────────────────────────────────
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// +1 (619) 555-0142 · 619.555.0142 · 619-555-0142 · +44 20 7946 0958 · 0412 345 678
export const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/;
export const URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|io|dev|me|net|org|co|app|ai|design|tech|xyz|info|page|site|us|uk|ca|edu|gov)\b(?:\/[^\s|,)•·]*)?/i;
export const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9_%-]+\/?/i;
export const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i;

// ── Education ─────────────────────────────────────────────────────────────────────────────────
export const DEGREE_RE = /\b(ph\.?\s?d\.?|doctor(?:ate|al)?(?: of [a-z ]+)?|d\.?b\.?a\.?|ed\.?d\.?|m\.?d\.?|j\.?d\.?|pharm\.?d\.?|dnp|m\.?b\.?a\.?|master(?:'?s)?(?: of [a-z ]+)?|m\.?s\.?c?\.?|m\.?a\.?|m\.?eng\.?|m\.?ed\.?|m\.?f\.?a\.?|m\.?p\.?h\.?|m\.?s\.?w\.?|msn|mha|mpa|llm|bachelor(?:'?s)?(?: of [a-z ]+)?|b\.?s\.?c?\.?|b\.?a\.?|b\.?eng\.?|b\.?f\.?a\.?|b\.?b\.?a\.?|bsn|b\.?tech\.?|b\.?e\.?|associate(?:'?s)?(?: of [a-z ]+| degree)?|a\.?a\.?s?\.?|a\.?s\.?|a\.?a\.?|diploma|high school diploma|hs diploma|ged|certificate|certification|coursework|bootcamp|nanodegree|some college|undergraduate|postgraduate|graduate)(?![a-z])/i;
export const SCHOOL_RE = /\b(university|college|institute|school|academy|polytechnic|seminary|conservatory|bootcamp|high school|community college|technical college|state university|campus)\b/i;
export const GPA_RE = /\bgpa[:\s]*([0-4]\.\d{1,2})(?:\s*\/\s*4(?:\.0)?)?/i;
export const HONORS_RE = /\b(summa cum laude|magna cum laude|cum laude|with honou?rs|dean'?s list|honor roll|valedictorian|salutatorian|distinction)\b/i;

// ── Certifications ────────────────────────────────────────────────────────────────────────────
export const CERT_CUE_RE = /\b(certif(?:ied|icate|ication)|licens(?:e|ed|ure)|credential|cpr|bls|acls|pals|nrp|osha|servsafe|food handler|forklift|cdl|class [abc]|pmp|csm|psm|safe|cissp|ccna|ccnp|comptia|a\+|network\+|security\+|aws certified|azure|gcp|google cloud|scrum|six sigma|lean|itil|cpa|cfa|cfp|series \d+|notary|real estate license|rn|lpn|cna|emt|paramedic|first aid|hipaa|twic|tsa|hazmat|epa 608|nccer|nate|aws welding|asme|api 510|ase|a\.s\.e\.|cma|cpc|ccs|phr|shrm|cdl-a|cdl-b)\b/i;

// ── Bullet / sentence cues ────────────────────────────────────────────────────────────────────
// Verbs that open accomplishment bullets (past and present forms). Used to recognise a bullet
// that lost its glyph in extraction, and by the health engine's verb analysis.
export const ACTION_VERB_OPENERS = [
  'achieved','acted','adapted','added','addressed','administered','advised','advocated','aligned','analyzed','analysed','answered','applied','appointed','approved','arranged','assembled','assessed','assigned','assisted','attained','audited','authored','automated','awarded','balanced','budgeted','built','calculated','calibrated','cared','cashed','chaired','championed','cleaned','cleared','closed','coached','coded','collaborated','collected','communicated','compiled','completed','composed','computed','conducted','configured','consolidated','constructed','consulted','contributed','controlled','converted','coordinated','counseled','counselled','created','cultivated','customized','cut','debugged','decreased','defined','delegated','delivered','demonstrated','deployed','designed','detected','determined','developed','devised','diagnosed','directed','dispatched','dispensed','distributed','documented','doubled','drafted','drove','earned','edited','educated','eliminated','enabled','encouraged','enforced','engineered','enhanced','ensured','established','estimated','evaluated','exceeded','executed','expanded','expedited','facilitated','filed','finalized','fixed','followed','forecasted','forecast','formulated','fostered','founded','fulfilled','generated','greeted','grew','guided','handled','headed','helped','hired','hosted','identified','implemented','improved','increased','influenced','informed','initiated','inspected','installed','instructed','integrated','interpreted','interviewed','introduced','invented','inventoried','investigated','issued','kept','launched','led','lifted','loaded','logged','maintained','managed','manufactured','mapped','marketed','maximized','measured','mediated','mentored','merged','met','migrated','minimized','mitigated','modeled','modelled','modernized','monitored','motivated','navigated','negotiated','observed','obtained','onboarded','opened','operated','optimized','orchestrated','ordered','organized','organised','outperformed','oversaw','owned','packaged','packed','painted','parked','participated','partnered','performed','picked','piloted','pioneered','pitched','planned','prepared','prescribed','presented','prevented','priced','printed','prioritized','processed','procured','produced','programmed','projected','promoted','proposed','protected','provided','published','purchased','qualified','quantified','raised','ran','ranked','rated','reached','received','recommended','reconciled','recorded','recruited','redesigned','reduced','refined','reinforced','relocated','remodeled','renovated','reorganized','repaired','replaced','reported','represented','researched','resolved','responded','restocked','restored','restructured','retained','reviewed','revised','revitalized','routed','safeguarded','saved','scaled','scanned','scheduled','screened','secured','selected','served','serviced','set','shaped','shipped','simplified','sold','solved','sorted','sourced','spearheaded','specified','sped','stacked','staffed','standardized','started','steered','stocked','streamlined','strengthened','structured','studied','submitted','succeeded','supervised','supplied','supported','surpassed','surveyed','sustained','targeted','taught','tested','tracked','trained','transformed','translated','transported','treated','triaged','tripled','troubleshot','tuned','unified','unloaded','updated','upgraded','upheld','used','utilized','validated','verified','visualized','volunteered','welcomed','welded','won','worked','wrote',
  // present tense (current roles)
  'achieve','administer','advise','analyze','analyse','answer','assemble','assess','assist','audit','automate','build','calculate','care','clean','coach','code','collaborate','collect','communicate','compile','complete','conduct','configure','coordinate','counsel','create','deliver','design','develop','diagnose','direct','dispatch','document','drive','edit','educate','ensure','evaluate','execute','facilitate','greet','guide','handle','help','identify','implement','improve','increase','inspect','install','lead','lift','load','maintain','manage','manufacture','measure','mentor','monitor','negotiate','operate','optimize','order','organize','oversee','own','pack','park','partner','perform','pick','plan','prepare','present','process','produce','provide','receive','reconcile','record','recruit','reduce','repair','report','research','resolve','respond','restock','review','run','schedule','serve','ship','sort','stock','supervise','support','teach','test','track','train','treat','triage','troubleshoot','update','use','verify','welcome','work','write',
  'responsible', 'duties', 'tasked', 'accountable', 'in charge',
];
const VERB_SRC = ACTION_VERB_OPENERS.sort((a, b) => b.length - a.length).join('|');
export const BULLET_OPENER_RE = new RegExp(`^(?:${VERB_SRC})\\b`, 'i');

// Lines that are clearly not part of the résumé body.
export const PAGE_NOISE_RE = /^(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s*(?:of|\/)\s*\d+|résumé|resume|curriculum vitae|cv|continued|\(continued\)|references available upon request\.?|references upon request\.?|available upon request\.?)$/i;
