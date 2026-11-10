// The calibration set (G, 2026-11-10): résumé × posting pairs labelled by reading both documents as a recruiter would,
// BEFORE the scorer was tuned. Bands: strong ≥ 75, good 60–74, stretch 40–59, long shot 20–39, different field < 20.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const personas = path.join(here, '..', 'personas');
export const LABEL_RANK = { 'different field': 0, 'long shot': 1, stretch: 2, good: 3, strong: 4 };
export function resumeText(key) {
  const mine = path.join(here, `${key}.txt`);
  return fs.readFileSync(fs.existsSync(mine) ? mine : path.join(personas, `${key}.txt`), 'utf8');
}
export function loadPostings() { return JSON.parse(fs.readFileSync(path.join(here, 'postings.json'), 'utf8')); }
export function loadPairs(file = 'pairs.json') {
  const postings = loadPostings();
  return JSON.parse(fs.readFileSync(path.join(here, file), 'utf8')).map((p) => ({ ...p, job: postings[p.posting], resume: resumeText(p.resume) }));
}
/** The band a score falls in, in the calibration's words. */
export function bandOf(score) {
  if (score == null) return null;
  return score >= 75 ? 'strong' : score >= 60 ? 'good' : score >= 40 ? 'stretch' : score >= 20 ? 'long shot' : 'different field';
}
