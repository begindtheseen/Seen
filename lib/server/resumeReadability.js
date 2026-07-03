// Résumé readability — the SINGLE canonical "is this actual résumé text?" check.
//
// WHY THIS EXISTS (2026-07-03, the Kyra incident): a phone-exported PDF with a subset font
// and no usable ToUnicode map extracted as GLYPH CODES — every byte shifted by a constant
// (e.g. "kyraregas@gmail.com" stored as "O]V EV IKEW$KQEMP GSQ"). That junk:
//   • defeated looksLikeGarbledText (it requires near-zero spaces; glyph soup HAS spaces),
//   • carried a plausible word count (3,729 whitespace tokens), so it looked like a résumé,
//   • was written to profiles.resume_text — and since the DB is the source of truth for
//     signed-in users, EVERY device then synced the poisoned copy (the "cross-device
//     corruption"). The optimize gate finally rejected it, far too late to recover cleanly.
//
// The failure mode was three different half-heuristics in three files. This module is the
// one shared predicate, enforced at every boundary the text crosses:
//   1. upload/parse  (lib/server/resumeUpload.js)   — junk never extracts successfully
//   2. optimize/scan (api/resume.js)                — junk never analyzes
//   3. DB save       (api/user-sync.js save_resume) — junk never persists
//   4. DB load       (lib/stores/ResumeStore.ts)    — legacy junk self-heals (purged on read)
// Plain JS with zero deps so serverless api/*.js AND the TS client import the same literals
// (same pattern as creditRules.js). Keep it dependency- and side-effect-free.

// Only judge texts long enough to judge; the callers' own length gates handle short input.
export const READABILITY_MIN_LENGTH = 100;
// A real résumé averages roughly one 3+-letter word per ~7 chars. Requiring one per 80 chars
// is a 10x margin — no genuine résumé fails it, and glyph soup (≈1 per 2,000 chars) never
// comes close. The absolute floor catches short-but-wordless payloads.
export const READABILITY_MIN_WORDS = 20;
export const READABILITY_CHARS_PER_WORD = 80;

/**
 * True when `text` reads as genuine résumé prose; false for glyph codes, binary spill,
 * base64, or any extraction where real words didn't survive. Texts at or under
 * READABILITY_MIN_LENGTH pass (too short to judge — length limits live at the callers).
 */
export function isReadableResume(text) {
  const s = String(text || '');
  if (s.length <= READABILITY_MIN_LENGTH) return true;
  const alphaWords = (s.match(/[A-Za-z]{3,}/g) || []).length;
  if (alphaWords < READABILITY_MIN_WORDS) return false;
  return alphaWords >= s.length / READABILITY_CHARS_PER_WORD;
}
