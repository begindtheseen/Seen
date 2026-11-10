// The text knowledge in one import: morphology (rules), the distilled WordNet table, the reviewed work thesaurus and
// the isomorphic data loader. Each module can also be imported on its own.
export * from './morph.js';
export { sameWord, relateWords, synonymsOf, lemmaOf, parseGroupIds } from './synonyms.js';
export { unitsOf, relatePhrases, sameWorkWord, familiesOf, isFamily, workFamilyMembers } from './workFamilies.js';
export { loadKnowledge, setKnowledgeData, canLoadKnowledge } from './knowledgeData.js';
