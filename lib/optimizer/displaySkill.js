// The display spelling of a canonical skill — proper nouns capitalised ("bilingual Spanish", "Excel").
//
// This is the ONE piece of the fit engine the browser needs (the Optimize sheet and the Verdict component print skill
// names). It lives in its own module so the screens can import it WITHOUT pulling in the engine: explainScore.js →
// statements.js → judgeStatement.js → lib/occupations and lib/text/workFamilies, which read data files with node:fs
// and cannot be bundled for the browser (the production build failed on exactly that, 2026-11-10). Nothing here may
// import anything but plain vocabulary.
import { SKILL_DISPLAY } from './professionalVocabulary.js';

const PROPER = { spanish: 'Spanish', english: 'English', excel: 'Excel', salesforce: 'Salesforce', quickbooks: 'QuickBooks', 'microsoft office': 'Microsoft Office', 'microsoft word': 'Microsoft Word', 'microsoft powerpoint': 'Microsoft PowerPoint', 'google workspace': 'Google Workspace', crm: 'CRM', sql: 'SQL', aws: 'AWS', 'rf scanner': 'RF scanner', 'point of sale': 'point of sale (POS)', go: 'Go', postgresql: 'PostgreSQL', kubernetes: 'Kubernetes', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java', react: 'React', 'node.js': 'Node.js', docker: 'Docker', terraform: 'Terraform', graphql: 'GraphQL', mysql: 'MySQL', mongodb: 'MongoDB', tableau: 'Tableau', 'power bi': 'Power BI', sap: 'SAP', rest: 'REST', 'google cloud': 'Google Cloud', azure: 'Azure', git: 'Git', ...SKILL_DISPLAY };
export function displaySkill(label) {
    const l = String(label || '');
    if (PROPER[l]) return PROPER[l];
    return l.replace(/\b(spanish|english|excel|salesforce)\b/g, (w) => PROPER[w] || w);
}
