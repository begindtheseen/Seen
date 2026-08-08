// Resume Intelligence Engine — TAXONOMY SEED DATA (Phase 5).
//
// A local, keyless occupational-concept layer. Every concept is a canonical id with:
//   • display    — human label
//   • category   — hard_skill | tool | software | operational | soft_skill | credential | domain_knowledge
//   • domains    — role families where the concept is plausible (guides domain-gated extraction)
//   • aliases    — SAME concept, different words (WMS ⇄ warehouse management system). Alias match.
//   • related    — DIFFERENT but connected concepts [id, weight, kind] where kind ∈
//                  broader | narrower | associated. Never collapsed into aliases — this is the
//                  distinction the mandate insists on (WMS/warehouse-management-system are ALIASES;
//                  warehouse-operations/WMS are RELATED).
//
// STRUCTURE = ESCO's shape (preferredLabel + altLabels + broader/narrower/associated relations).
// This hand-authored core covers the domains the engine is tested on; it is designed to be MERGED
// with a bulk ESCO/O*NET index at build time (see taxonomy.js `mergeTaxonomy`) without changing the
// runtime. Sourced structurally from ESCO (CC BY 4.0) and O*NET (CC BY 4.0); no proprietary data.
//
// Pure data. No AI, no I/O.

export const CONCEPTS = {
  // ── Retail / Asset Protection / Security ──────────────────────────────────
  loss_prevention: { display: 'Loss Prevention', category: 'operational', domains: ['retail', 'security'], aliases: ['loss prevention', 'shrink reduction', 'shortage control', 'shrinkage control', 'lp'], related: [['asset_protection', 0.9, 'associated'], ['surveillance', 0.7, 'associated'], ['theft_prevention', 0.85, 'narrower']] },
  asset_protection: { display: 'Asset Protection', category: 'operational', domains: ['retail', 'security'], aliases: ['asset protection', 'assets protection', 'ap'], related: [['loss_prevention', 0.9, 'associated'], ['safety', 0.6, 'associated'], ['surveillance', 0.7, 'associated']] },
  surveillance: { display: 'Surveillance', category: 'operational', domains: ['security', 'retail'], aliases: ['surveillance', 'cctv', 'cctv monitoring', 'camera monitoring', 'video monitoring'], related: [['loss_prevention', 0.7, 'associated'], ['incident_reporting', 0.5, 'associated']] },
  theft_prevention: { display: 'Theft Prevention', category: 'operational', domains: ['retail', 'security'], aliases: ['theft prevention', 'theft deterrence', 'apprehension', 'shoplifting prevention'], related: [['loss_prevention', 0.85, 'broader'], ['de_escalation', 0.5, 'associated']] },
  de_escalation: { display: 'De-escalation', category: 'soft_skill', domains: ['security', 'retail', 'customer_service', 'healthcare_support'], aliases: ['de-escalation', 'deescalation', 'conflict resolution', 'conflict de-escalation'], related: [['customer_service', 0.6, 'associated'], ['communication', 0.6, 'associated']] },
  incident_reporting: { display: 'Incident Reporting', category: 'operational', domains: ['security', 'healthcare_support'], aliases: ['incident reporting', 'incident reports', 'incident report writing', 'report writing'], related: [['documentation', 0.7, 'broader'], ['surveillance', 0.5, 'associated']] },

  // ── Customer-facing ───────────────────────────────────────────────────────
  customer_service: { display: 'Customer Service', category: 'soft_skill', domains: ['retail', 'customer_service', 'food_service', 'hospitality', 'sales'], aliases: ['customer service', 'guest service', 'guest services', 'client service', 'customer care', 'customer support', 'client relations', 'guest experience'], related: [['communication', 0.7, 'associated'], ['de_escalation', 0.6, 'associated'], ['point_of_sale', 0.5, 'associated'], ['sales', 0.5, 'associated']] },
  point_of_sale: { display: 'Point of Sale', category: 'tool', domains: ['retail', 'food_service'], aliases: ['point of sale', 'pos', 'pos system', 'cash register', 'register', 'checkout'], related: [['cash_handling', 0.8, 'associated'], ['customer_service', 0.5, 'associated']] },
  cash_handling: { display: 'Cash Handling', category: 'operational', domains: ['retail', 'food_service', 'finance_accounting'], aliases: ['cash handling', 'cash management', 'money handling', 'cash drawer', 'cash reconciliation'], related: [['point_of_sale', 0.8, 'associated'], ['accuracy', 0.5, 'associated']] },

  // ── Warehouse / Logistics ─────────────────────────────────────────────────
  warehouse_operations: { display: 'Warehouse Operations', category: 'operational', domains: ['warehouse'], aliases: ['warehouse operations', 'warehouse', 'distribution center operations', 'fulfillment operations'], related: [['inventory_management', 0.75, 'associated'], ['warehouse_management_system', 0.7, 'narrower'], ['shipping', 0.7, 'narrower'], ['receiving', 0.7, 'narrower']] },
  warehouse_management_system: { display: 'Warehouse Management System', category: 'software', domains: ['warehouse'], aliases: ['warehouse management system', 'wms', 'warehouse management software'], related: [['warehouse_operations', 0.7, 'broader'], ['inventory_management', 0.6, 'associated']] },
  inventory_management: { display: 'Inventory Management', category: 'operational', domains: ['warehouse', 'retail'], aliases: ['inventory management', 'inventory control', 'stock control', 'stock management', 'inventory', 'stocking', 'restocking', 'cycle counting'], related: [['warehouse_operations', 0.75, 'associated'], ['receiving', 0.6, 'associated'], ['accuracy', 0.5, 'associated']] },
  shipping: { display: 'Shipping', category: 'operational', domains: ['warehouse'], aliases: ['shipping', 'outbound shipping', 'order fulfillment', 'dispatch'], related: [['outbound_logistics', 0.8, 'broader'], ['receiving', 0.6, 'associated'], ['warehouse_operations', 0.7, 'broader']] },
  receiving: { display: 'Receiving', category: 'operational', domains: ['warehouse'], aliases: ['receiving', 'inbound receiving', 'goods receipt', 'unloading'], related: [['inbound_logistics', 0.8, 'broader'], ['shipping', 0.6, 'associated'], ['inventory_management', 0.6, 'associated']] },
  order_picking: { display: 'Order Picking', category: 'operational', domains: ['warehouse'], aliases: ['order picking', 'picking', 'pick and pack', 'picking and packing', 'order selection'], related: [['packing', 0.7, 'associated'], ['warehouse_operations', 0.7, 'broader']] },
  packing: { display: 'Packing', category: 'operational', domains: ['warehouse'], aliases: ['packing', 'packaging', 'boxing', 'palletizing'], related: [['order_picking', 0.7, 'associated'], ['shipping', 0.6, 'associated']] },
  inbound_logistics: { display: 'Inbound Logistics', category: 'operational', domains: ['warehouse', 'delivery_logistics'], aliases: ['inbound logistics', 'inbound', 'inbound shipments'], related: [['receiving', 0.8, 'narrower'], ['logistics', 0.8, 'broader']] },
  outbound_logistics: { display: 'Outbound Logistics', category: 'operational', domains: ['warehouse', 'delivery_logistics'], aliases: ['outbound logistics', 'outbound', 'outbound shipments'], related: [['shipping', 0.8, 'narrower'], ['logistics', 0.8, 'broader']] },
  logistics: { display: 'Logistics', category: 'operational', domains: ['delivery_logistics', 'warehouse'], aliases: ['logistics', 'supply chain', 'supply chain operations'], related: [['route_planning', 0.7, 'associated'], ['inbound_logistics', 0.8, 'narrower'], ['outbound_logistics', 0.8, 'narrower']] },
  route_planning: { display: 'Route Planning', category: 'operational', domains: ['delivery_logistics'], aliases: ['route planning', 'routing', 'route optimization', 'navigation'], related: [['logistics', 0.7, 'broader'], ['time_management', 0.5, 'associated']] },
  forklift_operation: { display: 'Forklift Operation', category: 'credential', domains: ['warehouse'], aliases: ['forklift operation', 'forklift', 'forklift certification', 'forklift operator', 'powered industrial truck', 'pallet jack'], related: [['warehouse_operations', 0.6, 'associated'], ['osha_safety', 0.5, 'associated']] },
  osha_safety: { display: 'OSHA / Workplace Safety', category: 'credential', domains: ['warehouse', 'skilled_trades'], aliases: ['osha', 'osha compliance', 'osha safety', 'workplace safety', 'safety compliance'], related: [['safety', 0.85, 'broader'], ['compliance', 0.6, 'associated']] },

  // ── Leadership / people ───────────────────────────────────────────────────
  team_leadership: { display: 'Team Leadership', category: 'soft_skill', domains: ['operations', 'project_management', 'retail', 'warehouse', 'sales'], aliases: ['team leadership', 'team lead', 'team management', 'people management', 'staff management', 'people leadership'], related: [['staff_supervision', 0.85, 'narrower'], ['employee_coaching', 0.8, 'narrower'], ['training', 0.6, 'associated'], ['communication', 0.5, 'associated']] },
  staff_supervision: { display: 'Staff Supervision', category: 'soft_skill', domains: ['operations', 'retail', 'warehouse'], aliases: ['staff supervision', 'supervision', 'supervising staff', 'shift supervision', 'floor supervision'], related: [['team_leadership', 0.85, 'broader'], ['employee_coaching', 0.7, 'associated']] },
  employee_coaching: { display: 'Employee Coaching', category: 'soft_skill', domains: ['operations', 'retail', 'sales'], aliases: ['employee coaching', 'coaching', 'associate development', 'staff development', 'mentoring', 'mentorship'], related: [['team_leadership', 0.8, 'broader'], ['training', 0.75, 'associated']] },
  training: { display: 'Training', category: 'soft_skill', domains: ['operations', 'retail', 'food_service', 'warehouse'], aliases: ['training', 'onboarding', 'new hire training', 'staff training', 'training and onboarding'], related: [['employee_coaching', 0.75, 'associated'], ['team_leadership', 0.6, 'associated']] },

  // ── Software engineering ──────────────────────────────────────────────────
  javascript: { display: 'JavaScript', category: 'hard_skill', domains: ['software_engineering'], aliases: ['javascript', 'js', 'es6', 'ecmascript'], related: [['typescript', 0.8, 'associated'], ['react', 0.7, 'associated'], ['nodejs', 0.7, 'associated']] },
  typescript: { display: 'TypeScript', category: 'hard_skill', domains: ['software_engineering'], aliases: ['typescript', 'ts'], related: [['javascript', 0.9, 'broader']] },
  react: { display: 'React', category: 'hard_skill', domains: ['software_engineering'], aliases: ['react', 'react.js', 'reactjs'], related: [['javascript', 0.7, 'broader'], ['nextjs', 0.7, 'narrower'], ['frontend', 0.7, 'associated']] },
  nextjs: { display: 'Next.js', category: 'hard_skill', domains: ['software_engineering'], aliases: ['next.js', 'nextjs', 'next js'], related: [['react', 0.8, 'broader']] },
  nodejs: { display: 'Node.js', category: 'hard_skill', domains: ['software_engineering'], aliases: ['node.js', 'node', 'nodejs'], related: [['javascript', 0.8, 'broader'], ['rest_api', 0.5, 'associated'], ['backend', 0.7, 'associated']] },
  rest_api: { display: 'REST APIs', category: 'hard_skill', domains: ['software_engineering'], aliases: ['rest api', 'rest apis', 'restful api', 'restful apis', 'restful', 'rest'], related: [['api_design', 0.7, 'associated'], ['backend', 0.6, 'associated']] },
  api_design: { display: 'API Design', category: 'hard_skill', domains: ['software_engineering'], aliases: ['api design', 'api development', 'apis'], related: [['rest_api', 0.7, 'narrower']] },
  git: { display: 'Git', category: 'tool', domains: ['software_engineering'], aliases: ['git', 'github', 'gitlab', 'version control'], related: [['ci_cd', 0.5, 'associated']] },
  ci_cd: { display: 'CI/CD', category: 'hard_skill', domains: ['software_engineering'], aliases: ['ci/cd', 'cicd', 'continuous integration', 'continuous delivery', 'continuous deployment', 'github actions', 'gitlab ci', 'jenkins'], related: [['git', 0.5, 'associated'], ['devops', 0.7, 'broader']] },
  docker: { display: 'Docker', category: 'tool', domains: ['software_engineering'], aliases: ['docker', 'containers', 'containerization'], related: [['kubernetes', 0.7, 'associated'], ['devops', 0.6, 'associated']] },
  kubernetes: { display: 'Kubernetes', category: 'tool', domains: ['software_engineering'], aliases: ['kubernetes', 'k8s'], related: [['docker', 0.7, 'associated'], ['devops', 0.7, 'associated']] },
  aws: { display: 'AWS', category: 'tool', domains: ['software_engineering'], aliases: ['aws', 'amazon web services', 'aws cloud'], related: [['cloud', 0.8, 'broader'], ['devops', 0.4, 'associated']] },
  sql: { display: 'SQL', category: 'hard_skill', domains: ['software_engineering', 'data_analytics'], aliases: ['sql', 'postgresql', 'postgres', 'mysql', 'sql queries'], related: [['data_analytics', 0.6, 'associated']] },
  python: { display: 'Python', category: 'hard_skill', domains: ['software_engineering', 'data_analytics'], aliases: ['python'], related: [['data_analytics', 0.5, 'associated'], ['machine_learning', 0.5, 'associated']] },
  devops: { display: 'DevOps', category: 'hard_skill', domains: ['software_engineering'], aliases: ['devops', 'sre', 'site reliability'], related: [['ci_cd', 0.7, 'narrower'], ['docker', 0.6, 'associated']] },
  frontend: { display: 'Frontend Development', category: 'hard_skill', domains: ['software_engineering'], aliases: ['frontend', 'front-end', 'front end', 'ui development'], related: [['react', 0.7, 'associated'], ['javascript', 0.7, 'associated']] },
  backend: { display: 'Backend Development', category: 'hard_skill', domains: ['software_engineering'], aliases: ['backend', 'back-end', 'back end', 'server-side'], related: [['nodejs', 0.7, 'associated'], ['rest_api', 0.6, 'associated']] },

  // ── Sales ─────────────────────────────────────────────────────────────────
  sales: { display: 'Sales', category: 'operational', domains: ['sales', 'retail'], aliases: ['sales', 'selling', 'revenue generation'], related: [['sales_pipeline', 0.7, 'narrower'], ['prospecting', 0.7, 'narrower'], ['customer_service', 0.5, 'associated'], ['crm', 0.6, 'associated']] },
  crm: { display: 'CRM', category: 'software', domains: ['sales', 'customer_service'], aliases: ['crm', 'customer relationship management', 'salesforce', 'hubspot crm'], related: [['sales', 0.6, 'associated'], ['sales_pipeline', 0.6, 'associated']] },
  sales_pipeline: { display: 'Sales Pipeline Management', category: 'operational', domains: ['sales'], aliases: ['sales pipeline', 'pipeline management', 'sales pipeline management', 'deal pipeline', 'opportunity management'], related: [['prospecting', 0.7, 'associated'], ['lead_qualification', 0.7, 'associated'], ['closing', 0.7, 'associated'], ['crm', 0.6, 'associated']] },
  prospecting: { display: 'Prospecting', category: 'operational', domains: ['sales'], aliases: ['prospecting', 'lead generation', 'lead gen', 'cold outreach', 'cold calling', 'cold call'], related: [['sales_pipeline', 0.7, 'associated'], ['lead_qualification', 0.7, 'associated']] },
  lead_qualification: { display: 'Lead Qualification', category: 'operational', domains: ['sales'], aliases: ['lead qualification', 'qualifying leads', 'lead scoring'], related: [['prospecting', 0.7, 'associated'], ['sales_pipeline', 0.7, 'associated']] },
  closing: { display: 'Closing', category: 'operational', domains: ['sales'], aliases: ['closing', 'closing deals', 'deal closing', 'negotiation and closing'], related: [['sales_pipeline', 0.7, 'associated'], ['quota_attainment', 0.6, 'associated']] },
  quota_attainment: { display: 'Quota Attainment', category: 'operational', domains: ['sales'], aliases: ['quota attainment', 'quota', 'hitting quota', 'exceeding quota', 'sales targets'], related: [['closing', 0.6, 'associated'], ['sales', 0.6, 'associated']] },

  // ── Healthcare ────────────────────────────────────────────────────────────
  hipaa: { display: 'HIPAA', category: 'domain_knowledge', domains: ['healthcare_support'], aliases: ['hipaa', 'hipaa compliance', 'patient privacy'], related: [['compliance', 0.6, 'broader'], ['medical_records', 0.5, 'associated']] },
  emr: { display: 'EMR / EHR', category: 'software', domains: ['healthcare_support'], aliases: ['emr', 'ehr', 'electronic medical records', 'electronic health records', 'epic', 'cerner'], related: [['medical_records', 0.8, 'associated'], ['documentation', 0.6, 'associated']] },
  patient_intake: { display: 'Patient Intake', category: 'operational', domains: ['healthcare_support'], aliases: ['patient intake', 'intake', 'patient registration', 'client intake', 'customer intake'], related: [['documentation', 0.6, 'associated'], ['scheduling', 0.6, 'associated'], ['patient_care', 0.5, 'associated']] },
  patient_care: { display: 'Patient Care', category: 'operational', domains: ['healthcare_support'], aliases: ['patient care', 'direct patient care', 'resident care'], related: [['patient_intake', 0.5, 'associated']] },
  medical_records: { display: 'Medical Records', category: 'operational', domains: ['healthcare_support'], aliases: ['medical records', 'health records', 'chart management'], related: [['documentation', 0.75, 'broader'], ['emr', 0.8, 'associated']] },
  medical_terminology: { display: 'Medical Terminology', category: 'domain_knowledge', domains: ['healthcare_support'], aliases: ['medical terminology', 'clinical terminology'], related: [['patient_care', 0.4, 'associated']] },

  // ── Cross-industry ────────────────────────────────────────────────────────
  communication: { display: 'Communication', category: 'soft_skill', domains: [], aliases: ['communication', 'verbal communication', 'written communication', 'interpersonal communication', 'communication skills'], related: [['customer_service', 0.6, 'associated'], ['teamwork', 0.5, 'associated']] },
  teamwork: { display: 'Teamwork', category: 'soft_skill', domains: [], aliases: ['teamwork', 'collaboration', 'team player', 'cross-functional collaboration'], related: [['communication', 0.5, 'associated']] },
  reliability: { display: 'Reliability', category: 'soft_skill', domains: [], aliases: ['reliability', 'dependability', 'punctuality', 'attendance', 'dependable'], related: [['time_management', 0.5, 'associated']] },
  time_management: { display: 'Time Management', category: 'soft_skill', domains: [], aliases: ['time management', 'prioritization', 'prioritisation', 'meeting deadlines'], related: [['reliability', 0.5, 'associated']] },
  problem_solving: { display: 'Problem Solving', category: 'soft_skill', domains: [], aliases: ['problem solving', 'problem-solving', 'troubleshooting', 'critical thinking', 'analytical thinking'], related: [['communication', 0.3, 'associated']] },
  scheduling: { display: 'Scheduling', category: 'operational', domains: ['administrative', 'operations', 'healthcare_support'], aliases: ['scheduling', 'calendar management', 'appointment setting', 'shift scheduling', 'staff scheduling'], related: [['operations', 0.5, 'associated'], ['coordination', 0.6, 'associated']] },
  documentation: { display: 'Documentation', category: 'operational', domains: ['administrative', 'healthcare_support', 'security'], aliases: ['documentation', 'record keeping', 'recordkeeping', 'records management', 'filing', 'data entry'], related: [['compliance', 0.4, 'associated'], ['accuracy', 0.5, 'associated']] },
  compliance: { display: 'Compliance', category: 'operational', domains: ['finance_accounting', 'healthcare_support', 'security'], aliases: ['compliance', 'regulatory compliance', 'policy compliance'], related: [['documentation', 0.4, 'associated'], ['safety', 0.4, 'associated']] },
  safety: { display: 'Safety', category: 'operational', domains: ['warehouse', 'skilled_trades', 'security'], aliases: ['safety', 'safety standards', 'safety procedures', 'workplace safety'], related: [['osha_safety', 0.85, 'narrower'], ['compliance', 0.4, 'associated']] },
  accuracy: { display: 'Accuracy', category: 'soft_skill', domains: [], aliases: ['accuracy', 'attention to detail', 'detail oriented', 'detail-oriented', 'precision'], related: [] },
  coordination: { display: 'Coordination', category: 'soft_skill', domains: ['operations', 'project_management'], aliases: ['coordination', 'coordinating', 'stakeholder coordination'], related: [['scheduling', 0.6, 'associated'], ['operations', 0.6, 'associated']] },
  operations: { display: 'Operations', category: 'operational', domains: ['operations'], aliases: ['operations', 'operations management', 'process improvement'], related: [['scheduling', 0.5, 'associated'], ['coordination', 0.6, 'associated']] },
  data_analytics: { display: 'Data Analytics', category: 'hard_skill', domains: ['data_analytics'], aliases: ['data analytics', 'data analysis', 'analytics', 'reporting', 'dashboards'], related: [['sql', 0.6, 'associated'], ['excel', 0.5, 'associated']] },
  excel: { display: 'Excel', category: 'software', domains: ['administrative', 'finance_accounting', 'data_analytics'], aliases: ['excel', 'microsoft excel', 'ms excel', 'spreadsheets', 'pivot tables'], related: [['data_analytics', 0.5, 'associated']] },
  machine_learning: { display: 'Machine Learning', category: 'hard_skill', domains: ['data_analytics', 'software_engineering'], aliases: ['machine learning', 'ml', 'deep learning'], related: [['python', 0.5, 'associated'], ['data_analytics', 0.5, 'associated']] },
  cloud: { display: 'Cloud', category: 'hard_skill', domains: ['software_engineering'], aliases: ['cloud', 'cloud computing', 'cloud infrastructure'], related: [['aws', 0.8, 'narrower']] },
};
