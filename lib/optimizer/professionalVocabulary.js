// The salaried vocabulary — DATA, in the same shape as hourlyVocabulary.js, read by both sides of
// the match (posting and résumé) through vocabularySkills() / vocabularyAliases().
//
// Why (paid-tool test, 2026-10-25): the ~120-token taxonomy had no words for what a backend
// engineer or a social-media / CRM marketer is asked for. Groupon's "Social Media Specialist"
// posting — "2–4 years in social media … TikTok, Instagram, and YouTube … Meta Business Suite,
// TikTok Studio … Sprout, Dash Hudson, Brandwatch" — yielded ZERO requirements, so every paid
// tool said "No score: this listing does not state its requirements"; Kunai's Go/Kafka/payments
// posting read as "Go, AWS, training"; Stripe's read as two skills.
//
// `families`: the role families (lib/application-intelligence/roleOntology.js) in which a posting
// may ask for the skill. A gated skill is never read from a posting outside them — "accept
// payments" in a cashier posting is not the payments-systems skill, "CDC" in a clinic is not
// change data capture. Aliases are TRUE synonyms only; related-but-distinct skills are RELATED
// edges (partial credit, never a rewrite).

const TECH = ['software_engineering', 'data_analytics'];
const TECH_FIN = ['software_engineering', 'data_analytics', 'finance_accounting'];

export const PROFESSIONAL_VOCABULARY = {
  backend: {
    label: 'Backend & platform',
    skills: [
      { canonical: 'kafka', families: TECH, aliases: ['apache kafka', 'kafka consumers', 'kafka streams', 'kafka topics'] },
      { canonical: 'change data capture', families: TECH, aliases: ['cdc', 'cdc pipelines', 'cdc pipeline', 'debezium', 'logical replication'] },
      { canonical: 'event-driven architecture', families: TECH, aliases: ['event-driven', 'event driven', 'event-driven architectures', 'event driven architectures', 'event-driven systems', 'event-driven services', 'event streams', 'event stream', 'event streaming', 'message queues', 'message queue', 'pub/sub'] },
      { canonical: 'distributed systems', families: TECH, aliases: ['distributed system', 'large-scale distributed systems', 'distributed services', 'distributed computing'] },
      { canonical: 'microservices', families: TECH, aliases: ['microservice', 'micro-services', 'service-oriented architecture'] },
      { canonical: 'apis', families: TECH, aliases: ['api', 'api development', 'api design', 'api endpoints', 'grpc', 'web services', 'graphql apis'] },
      { canonical: 'data modeling', families: TECH, aliases: ['data model', 'data models', 'data modelling', 'schema design', 'database design', 'database schema', 'schema versioning'] },
      { canonical: 'data pipelines', families: TECH, aliases: ['data pipeline', 'etl', 'elt', 'etl pipelines', 'batch pipelines'] },
      { canonical: 'data structures', families: TECH, aliases: ['data structure'] },
      { canonical: 'algorithms', families: TECH, aliases: ['algorithm', 'algorithmic'] },
      { canonical: 'cloud infrastructure', families: TECH, aliases: ['cloud services', 'cloud platforms', 'cloud platform', 'cloud computing', 'cloud providers', 'cloud provider'] },
      { canonical: 'performance optimization', families: TECH, aliases: ['performance tuning', 'performance engineering', 'latency optimization', 'end-to-end performance'] },
      { canonical: 'observability', families: TECH, aliases: ['opentelemetry', 'monitoring and alerting', 'prometheus', 'grafana', 'datadog'] },
      { canonical: 'automated testing', families: TECH, aliases: ['unit testing', 'unit tests', 'integration tests', 'test automation', 'automated tests'] },
      { canonical: 'scala', families: TECH, aliases: [] },
      { canonical: 'dynamodb', families: TECH, aliases: ['dynamo db'] },
      { canonical: 'payments', families: TECH_FIN, aliases: ['payment systems', 'payment system', 'payment processing', 'payments infrastructure', 'payment infrastructure', 'card payments', 'ach', 'payment orchestration', 'payment-orchestration', 'card and ach'] },
      { canonical: 'transactional systems', families: TECH_FIN, aliases: ['transactional system', 'transaction processing', 'oltp'] },
      { canonical: 'ledger systems', families: TECH_FIN, aliases: ['ledger', 'ledgers', 'double-entry ledger', 'double-entry', 'ledger service'] },
      { canonical: 'core banking', families: TECH_FIN, aliases: ['core banking system', 'core banking systems', 'banking core', 'fis profile'] },
    ],
  },
  social: {
    label: 'Social & content',
    skills: [
      { canonical: 'social media', aliases: ['social media marketing', 'social media management', 'organic social', 'social content', 'social channels', 'social platforms', 'social media content', 'social posts', 'social media strategy', 'social strategy', 'social media posts'] },
      { canonical: 'content creation', aliases: ['content production', 'produce content', 'producing content', 'create content', 'creating content', 'content creator', 'short-form video', 'short form video', 'content development', 'pieces of content', 'produced content'] },
      { canonical: 'tiktok', aliases: [] },
      { canonical: 'instagram', aliases: ['instagram reels'] },
      { canonical: 'youtube', aliases: ['youtube shorts'] },
      { canonical: 'facebook', aliases: [] },
      { canonical: 'meta business suite', aliases: ['meta business manager', 'facebook business manager', 'meta ads manager'] },
      { canonical: 'social media analytics', aliases: ['social analytics', 'social data', 'platform analytics', 'platform-native analytics', 'instagram insights', 'tiktok studio', 'youtube studio', 'tiktok analytics', 'instagram analytics', 'content performance'] },
      { canonical: 'social media management tools', aliases: ['sprout social', 'dash hudson', 'brandwatch', 'hootsuite', 'sprinklr'] },
      { canonical: 'generative ai', aliases: ['generative ai tools', 'generative tools', 'ai-generated content', 'ai-generated', 'ai generated', 'ai video', 'ai imagery', 'ai audio', 'ai tools', 'midjourney', 'elevenlabs', 'higgsfield', 'chatgpt'] },
      { canonical: 'video editing', aliases: ['video production', 'video editor', 'capcut', 'premiere pro', 'adobe premiere', 'final cut'] },
      { canonical: 'canva', aliases: [] },
      { canonical: 'adobe creative suite', aliases: ['adobe creative cloud', 'photoshop', 'adobe photoshop', 'illustrator', 'adobe illustrator', 'indesign'] },
      { canonical: 'motion design', aliases: ['motion graphics', 'after effects'] },
      { canonical: 'copywriting', aliases: ['copy writing', 'writing copy', 'captions', 'caption writing'] },
      { canonical: 'content calendar', aliases: ['content calendars', 'editorial calendar', 'posting cadence', 'publishing cadence', 'content roadmap'] },
      { canonical: 'community management', aliases: ['online community', 'community engagement'] },
      { canonical: 'influencer marketing', aliases: ['influencer partnerships', 'creator partnerships', 'influencers'] },
      { canonical: 'brand marketing', aliases: ['brand strategy', 'brand campaigns', 'brand building'] },
      { canonical: 'on-camera presence', aliases: ['on camera', 'on-camera', 'being on camera'] },
    ],
  },
  lifecycle: {
    label: 'Email, CRM & lifecycle',
    skills: [
      { canonical: 'email marketing', aliases: ['email campaigns', 'email programs', 'lifecycle email', 'lifecycle emails', 'email marketing operations', 'email operations', 'email newsletter', 'email newsletters', 'newsletters', 'email building', 'email sends', 'evergreen email', 'email automation', 'drip campaigns', 'lifecycle and evergreen email programs'] },
      { canonical: 'lifecycle marketing', aliases: ['lifecycle programs', 'retention marketing', 'crm marketing', 'lifecycle communications'] },
      { canonical: 'hubspot', aliases: ['hubspot crm', 'hubdb'] },
      { canonical: 'mailchimp', aliases: [] },
      { canonical: 'marketo', aliases: [] },
      { canonical: 'klaviyo', aliases: [] },
      { canonical: 'braze', aliases: [] },
      { canonical: 'marketing automation', aliases: ['marketing automation platform', 'automated campaigns'] },
      { canonical: 'list segmentation', aliases: ['segmentation', 'audience segmentation', 'list management'] },
      { canonical: 'database hygiene', aliases: ['data hygiene', 'list hygiene', 'deduplication', 'merge duplicate records', 'crm hygiene'] },
      { canonical: 'email testing', aliases: ['pre-send testing', 'email qa', 'rendering tests'] },
      { canonical: 'email deliverability', aliases: ['deliverability'] },
      { canonical: 'campaign management', aliases: ['campaign setup', 'campaign tracking', 'campaign execution', 'marketing campaigns', 'set up and configure campaigns'] },
      { canonical: 'marketing operations', aliases: ['marketing ops'] },
      { canonical: 'html', aliases: ['html5', 'basic html'] },
      { canonical: 'css', aliases: ['css3'] },
      { canonical: 'handlebars', aliases: ['handlebar', 'handlebars.js'] },
      { canonical: 'google slides', aliases: [] },
      { canonical: 'google analytics', aliases: ['ga4', 'google analytics 4'] },
      { canonical: 'seo', aliases: ['search engine optimization'] },
      { canonical: 'paid media', aliases: ['paid social', 'paid ads', 'ppc'] },
      { canonical: 'a/b testing', aliases: ['ab testing', 'a/b tests', 'split testing', 'test-and-learn', 'test and learn'] },
      { canonical: 'public speaking', aliases: [] },
      { canonical: 'e-commerce', aliases: ['ecommerce'] },
    ],
  },
};

// Related-but-distinct (partial credit, never a synonym).
export const PROFESSIONAL_RELATED = {
  kafka: [{ to: 'event-driven architecture', weight: 0.8 }],
  'change data capture': [{ to: 'event-driven architecture', weight: 0.6 }, { to: 'data pipelines', weight: 0.6 }],
  'event-driven architecture': [{ to: 'kafka', weight: 0.7 }, { to: 'microservices', weight: 0.5 }],
  'ledger systems': [{ to: 'payments', weight: 0.7 }, { to: 'transactional systems', weight: 0.7 }],
  payments: [{ to: 'transactional systems', weight: 0.6 }, { to: 'ledger systems', weight: 0.6 }],
  'transactional systems': [{ to: 'payments', weight: 0.5 }, { to: 'ledger systems', weight: 0.6 }],
  'social media analytics': [{ to: 'social media', weight: 0.6 }, { to: 'data analytics', weight: 0.5 }],
  'meta business suite': [{ to: 'social media analytics', weight: 0.7 }, { to: 'facebook', weight: 0.6 }, { to: 'instagram', weight: 0.6 }],
  'content creation': [{ to: 'social media', weight: 0.6 }, { to: 'copywriting', weight: 0.5 }],
  'social media': [{ to: 'content creation', weight: 0.5 }, { to: 'instagram', weight: 0.5 }, { to: 'tiktok', weight: 0.5 }],
  'email marketing': [{ to: 'lifecycle marketing', weight: 0.7 }, { to: 'campaign management', weight: 0.5 }, { to: 'mailchimp', weight: 0.5 }],
  'lifecycle marketing': [{ to: 'email marketing', weight: 0.7 }, { to: 'crm', weight: 0.5 }],
  mailchimp: [{ to: 'email marketing', weight: 0.8 }, { to: 'hubspot', weight: 0.5 }],
  hubspot: [{ to: 'crm', weight: 0.8 }, { to: 'marketing automation', weight: 0.6 }, { to: 'email marketing', weight: 0.5 }],
  canva: [{ to: 'adobe creative suite', weight: 0.5 }],
};

/** canonical → the role families a posting may ask for it in (absent = every family). */
export function professionalFamilyGates() {
  const out = {};
  for (const f of Object.values(PROFESSIONAL_VOCABULARY)) for (const s of f.skills) if (s.families) out[s.canonical] = new Set(s.families);
  return out;
}
