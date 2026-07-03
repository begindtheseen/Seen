// Isomorphic re-export of the canonical résumé-readability check for client components.
// The logic lives ONCE in lib/server/resumeReadability.js (plain JS so the Vercel api/*.js
// serverless functions import it with no build step); this file gives the TS client the
// identical predicate so the load/save healing in ResumeStore can never drift from the
// server's upload/optimize/save gates. Same pattern as lib/creditRules.ts.
export { isReadableResume, READABILITY_MIN_LENGTH, READABILITY_MIN_WORDS, READABILITY_CHARS_PER_WORD } from './server/resumeReadability.js';
