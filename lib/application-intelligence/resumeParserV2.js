// Résumé parser V2 — structured parse into an evidence graph, not a flat fact list.
//
// It segments the résumé into sections, splits the experience section into ROLES
// (title + employer + date range + bullets), and emits evidence nodes (skills, tools,
// metrics, verbs) associated with the role/bullet they came from. Every node carries the
// exact source span so downstream generation can PROVE a claim. Pure + deterministic; no AI.

import { canonSkill, SKILL_ALIASES } from './skillGraph.js';
import { detectRoleFamily } from './roleOntology.js';

// surfaces we recognize in bullets (alias keys + canonical labels used across the ontology)
const KNOWN_SURFACES = [...new Set([
  ...Object.keys(SKILL_ALIASES),
  ...Object.values(SKILL_ALIASES),
  'customer service', 'communication', 'teamwork', 'leadership', 'safety', 'accuracy',
  'inventory', 'shipping', 'receiving', 'merchandising', 'scheduling', 'documentation',
  'point of sale', 'cash handling', 'food safety', 'route planning', 'logistics',
  'data entry', 'customer intake', 'reporting', 'sales', 'compliance', 'hospitality',
])].filter(s => s.length >= 3).sort((a, b) => b.length - a.length);

const SECTION_HEADERS = [
  { key: 'summary', re: /^\s*(professional\s+)?(summary|objective|profile|about)\b/i },
  { key: 'skills', re: /^\s*(technical\s+|core\s+)?(skills|competencies|proficiencies|technologies)\b/i },
  { key: 'experience', re: /^\s*(work\s+|professional\s+|relevant\s+)?(experience|employment|work history|history)\b/i },
  { key: 'education', re: /^\s*(education|academic)\b/i },
  { key: 'certifications', re: /^\s*(certifications?|licenses?|credentials)\b/i },
  { key: 'projects', re: /^\s*(projects|portfolio)\b/i },
];

const DATE_RANGE_RE = /((?:0?[1-9]|1[0-2])\/\d{2,4}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\b\d{4})\s*(?:-|–|—|to)\s*(present|current|now|(?:0?[1-9]|1[0-2])\/\d{2,4}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\b\d{4})/i;
const TITLE_RE = /\b(engineer|developer|manager|director|analyst|specialist|representative|associate|coordinator|lead|designer|consultant|administrator|technician|clerk|driver|cashier|nurse|assistant|supervisor|agent|officer|attendant|valet|server|host|hostess|barista|cook|guard|receptionist|bookkeeper|accountant|intake|caregiver|picker|packer|stocker|teller|courier)\b/i;
// Catches money ("$1.2M"), percentages ("95%"), and count phrases with an optional "+" and
// up to two intervening words ("60+ guest vehicles", "40+ customers per shift").
const METRIC_RE = /(\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k\b|m\b|million|billion|\/hr)?|\d[\d,]*(?:\.\d+)?\s*%|\d[\d,]*\+?(?:\s+[a-z]+){0,2}\s+(?:customers?|clients?|guests?|vehicles?|tickets?|calls?|orders?|deliveries|stops?|packages?|patients?|users?|accounts?|reports?|invoices?|forms?|records?|employees?|people|transactions?|shifts?|routes?|items?|units?|hours?))/gi;
const BULLET_RE = /^\s*[•\-*▪◦·‣]\s+/;
const STRONG_VERB_RE = /\b(led|managed|built|created|developed|designed|implemented|resolved|handled|delivered|processed|coordinated|trained|reduced|increased|improved|maintained|operated|scheduled|documented|served|assisted|drove|parked|delivered|reconciled|analyzed|scanned|picked|packed)\b/i;

function classifyLine(line) {
  for (const h of SECTION_HEADERS) if (h.re.test(line) && line.trim().length < 40) return h.key;
  return null;
}

// Extract skill/tool + metric + verb evidence nodes from a single bullet/line.
function nodesForText(text, roleId, bulletIdx) {
  const nodes = [];
  const lower = text.toLowerCase();
  let mm; METRIC_RE.lastIndex = 0;
  let mi = 0;
  while ((mm = METRIC_RE.exec(text)) !== null) {
    nodes.push({
      id: `${roleId}_b${bulletIdx}_metric_${mi++}`, type: 'metric',
      label: mm[1].trim(), normalizedLabel: 'metric', value: mm[1].trim(),
      evidenceText: text.slice(0, 240), roleId, confidence: 0.85,
    });
  }
  // skill/tool mentions via alias/canonical surfaces present in the text
  const surfaces = new Set();
  for (const surf of KNOWN_SURFACES) {
    if (lower.includes(surf)) surfaces.add(canonSkill(surf));
  }
  let si = 0;
  for (const canon of surfaces) {
    nodes.push({
      id: `${roleId}_b${bulletIdx}_skill_${si++}`, type: 'skill',
      label: canon, normalizedLabel: canon, evidenceText: text.slice(0, 240),
      roleId, confidence: 0.9,
    });
  }
  const vm = STRONG_VERB_RE.exec(text);
  if (vm) nodes.push({ id: `${roleId}_b${bulletIdx}_verb`, type: 'verb', label: vm[1].toLowerCase(), normalizedLabel: vm[1].toLowerCase(), evidenceText: text.slice(0, 240), roleId, confidence: 0.7 });
  return nodes;
}

export function parseResumeV2(resumeText) {
  const text = String(resumeText || '');
  const lines = text.split('\n');
  const sections = { header: [], summary: [], skills: [], experience: [], education: [], certifications: [], projects: [] };
  let cur = 'header';
  const experienceLines = [];
  for (const raw of lines) {
    const sec = classifyLine(raw);
    if (sec) { cur = sec; continue; }
    (sections[cur] || sections.header).push(raw);
    if (cur === 'experience') experienceLines.push(raw);
  }

  // ── Segment experience into roles ──
  const roles = [];
  let role = null;
  let roleCounter = 0;
  const startRole = (headerLine) => {
    roleCounter += 1;
    const dm = DATE_RANGE_RE.exec(headerLine);
    const current = dm ? /present|current|now/i.test(dm[2]) : false;
    role = {
      id: `role_${roleCounter}`,
      headerText: headerLine.trim().slice(0, 200),
      title: (TITLE_RE.exec(headerLine)?.[0] || '').trim() || null,
      employer: guessEmployer(headerLine),
      dateRange: dm ? dm[0] : null,
      current,
      bullets: [],
      nodes: [],
    };
    roles.push(role);
  };
  for (const raw of experienceLines) {
    const line = raw.trim();
    if (!line) continue;
    const isBullet = BULLET_RE.test(raw);
    const looksLikeHeader = !isBullet && (DATE_RANGE_RE.test(line) || (TITLE_RE.test(line) && line.length < 90));
    if (looksLikeHeader) { startRole(line); continue; }
    if (isBullet || STRONG_VERB_RE.test(line)) {
      if (!role) startRole('(unlabeled role)');
      const bulletText = raw.replace(BULLET_RE, '').trim();
      if (bulletText.length < 4) continue;
      const bIdx = role.bullets.length;
      const nodes = nodesForText(bulletText, role.id, bIdx);
      role.bullets.push({ text: bulletText, nodes });
      role.nodes.push(...nodes);
    }
  }
  // Attach a role family to each role from its title/bullets.
  for (const r of roles) {
    const rf = detectRoleFamily(r.title || r.headerText || '', r.bullets.map(b => b.text).join(' '));
    r.family = rf.family;
    r.familyConfidence = rf.confidence;
  }

  // ── Flat skill/metric summaries across the whole résumé (incl. the skills section) ──
  const allNodes = roles.flatMap(r => r.nodes);
  const skillsSectionText = sections.skills.join(' ').toLowerCase();
  const skillSet = new Set(allNodes.filter(n => n.type === 'skill').map(n => n.label));
  for (const surf of KNOWN_SURFACES) if (skillsSectionText.includes(surf)) skillSet.add(canonSkill(surf));
  const metrics = allNodes.filter(n => n.type === 'metric');

  // Overall role family for the résumé = the family of the most recent (current, else first) role.
  const primary = roles.find(r => r.current) || roles[0] || null;
  const overallFamily = primary?.family || detectRoleFamily('', text).family;

  return {
    sections,
    roles,
    skills: [...skillSet],
    metrics,
    evidenceNodes: allNodes,
    overallFamily,
    hasStructuredExperience: roles.length > 0,
  };
}

function guessEmployer(headerLine) {
  // Employer is often the segment after a comma/at/pipe, minus the title + dates.
  const cleaned = headerLine.replace(DATE_RANGE_RE, '').trim();
  const parts = cleaned.split(/\s*[|,@·–—-]\s*/).map(s => s.trim()).filter(Boolean);
  // pick the part that is NOT the title
  const nonTitle = parts.find(p => !TITLE_RE.test(p) && p.length > 1 && /[a-z]/i.test(p));
  return (nonTitle || parts[1] || null) || null;
}
