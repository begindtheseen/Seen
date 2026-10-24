// Résumé → matching listings: the ONE matcher behind the /jobs "Matched to your résumé" rail
// (api/jobs.js handleRecommended) and the job-match emails (api/cron-job-matches.js), so the two can
// never disagree about what "matches your résumé" means.
//
// It reads the CANONICAL résumé (profiles.resume_text) next to the derived resume_skills cache;
// when the cache is missing or older than the résumé it derives the signal now and returns a `heal`
// promise that rewrites the row (the caller awaits it before its function returns). Because the
// signal is re-derived whenever the résumé changes, a new résumé means new matches.
//
// The match bar (lib/server/resumeJobMatch.js): the listing's TITLE shares a role family or a whole
// role phrase with a résumé title, AND it is near the person — within RAIL_MILES of the profile city
// (or the city the résumé names) or remote — AND it is a live US listing.

import { geocodeLocation, boundingBox, haversineMiles, hasUsableCoords } from './geo.js';
import { isReadableResume } from './resumeReadability.js';
import {
  resumeRoleFamilies, jobMatchesResume, jobNearCity, resumeMatchStrength, deriveResumeCity, matchedRolePhrase,
  deriveResumeJobQuery, pullResumeJobFloor, deriveResumeSignal, resumeSkillsStale,
} from './resumeJobMatch.js';
import { filterAndRank, locationDbTerm, expandQueryTerms, parseLocation } from '../../api/_utils/jobRelevance.js';
import { locationScope } from '../jobs/usLocation.js';
import { scoreRow } from './jobScore.js';
import { isRemoteListing as remoteByLocation } from './jobPriority.js';
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';

export const RAIL_MILES = 30;
const RECS_MIN = 6;
const COLS = 'id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,lat,lng,ats_tenant,created_at';

// The radius read: a bounding box OR'd with the city named in the row's own location text. 497 of
// the 509 coordinate-less Phoenix rows in prod (2026-10-23) are ATS-board rows whose location
// literally says "Phoenix, AZ"; the box alone could not see them. Two `or=` params on one PostgREST
// read are ANDed (verified against prod, ~0.22s warm).
export function geoScopeClause(center, miles, cityTerm) {
  const term = String(cityTerm || '').replace(/[(),*\\]/g, '').trim();
  const b = boundingBox(center, miles);
  if (!b) return term ? `&location=ilike.*${encodeURIComponent(term)}*` : '';
  const f = (n) => n.toFixed(6);
  const box = `and(lat.gte.${f(b.latMin)},lat.lte.${f(b.latMax)},lng.gte.${f(b.lngMin)},lng.lte.${f(b.lngMax)})`;
  return `&or=${encodeURIComponent(term ? `(${box},location.ilike.*${term}*)` : `(${box})`)}`;
}

/**
 * Find the listings that match a user's résumé, best first.
 *
 * @param {{ supabaseUrl: string, serviceKey: string, userId: string, allowFloor?: boolean }} opts
 *   allowFloor: when the corpus is thin, pull live for the résumé's role at the city (the rail does;
 *   the email cron does not — it only offers listings Seen already holds, which have a page to link to).
 * @returns {Promise<{
 *   hasResume: boolean|null, reason: null|'no_resume'|'no_signal'|'unavailable'|'no_city',
 *   ranked: Array<object>, city: string|null, citySource: 'profile'|'resume'|null,
 *   skills: string[], seniority: string|null, fn: string|null, heal: Promise|null,
 * }>}
 *   hasResume is null when the profile could not be read (never claim "no résumé" without evidence).
 *   Each ranked row carries `_strength` (resumeMatchStrength), `_phrase` (the résumé role its title
 *   carries, or null), `_family` ('same' | 'other' | 'unknown' vs the résumé's role families), `_remote`, `_miles` (from the city, when both have coordinates) and `_matchScore`.
 */
export async function findResumeMatches({ supabaseUrl, serviceKey, userId, allowFloor = true }) {
  const dbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const out = { hasResume: null, reason: null, ranked: [], city: null, citySource: null, skills: [], seniority: null, fn: null, heal: null };

  const uid = encodeURIComponent(userId);
  const [skillsRes, profRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/resume_skills?user_id=eq.${uid}&select=skills,seniority,function,years_exp,top_titles,updated_at&limit=1`, { headers: dbHeaders }).catch(() => null),
    fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${uid}&select=resume_text,resume_updated_at,city&limit=1`, { headers: dbHeaders }).catch(() => null),
  ]);
  const skillsRows = skillsRes && skillsRes.ok ? await skillsRes.json().catch(() => []) : [];
  const row = Array.isArray(skillsRows) && skillsRows[0] ? skillsRows[0] : null;
  const profRows = profRes && profRes.ok ? await profRes.json().catch(() => null) : null;
  const prof = Array.isArray(profRows) ? (profRows[0] || {}) : null; // null = the profile read failed
  const resumeText = typeof prof?.resume_text === 'string' ? prof.resume_text : '';
  out.hasResume = prof ? (!!resumeText && isReadableResume(resumeText)) : null;
  if (out.hasResume === false) { out.reason = 'no_resume'; return out; }

  let signal = row;
  if (out.hasResume && resumeSkillsStale(row, prof.resume_updated_at)) {
    signal = deriveResumeSignal(resumeText);
    out.heal = fetch(`${supabaseUrl}/rest/v1/resume_skills?on_conflict=user_id`, {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, skills: signal.skills, seniority: signal.seniority, function: signal.function, years_exp: signal.years_exp, top_titles: signal.top_titles, updated_at: new Date().toISOString() }),
    }).catch(() => null);
  }
  const { skills = [], seniority, function: fn, top_titles } = signal || {};
  const topSkills = (Array.isArray(skills) ? skills : []).slice(0, 5);
  out.skills = topSkills.slice(0, 3);
  out.seniority = seniority ?? null;
  out.fn = fn ?? null;

  // The résumé's real ROLE (title first, else function, else strongest skill) — a high-recall
  // query that catches listings pure skill-matching misses.
  const roleQuery = deriveResumeJobQuery({ top_titles, function: fn, skills: topSkills });
  const resume = resumeRoleFamilies({ top_titles, function: fn });
  if ((!topSkills.length && !roleQuery) || (!resume.families.length && !resume.phrases.length)) {
    out.reason = out.hasResume ? 'no_signal' : 'unavailable';
    return out;
  }

  // The profile city, else the city the résumé itself states ("Phoenix, AZ 85004" in its first line).
  let city = String(prof?.city || '').trim().slice(0, 80);
  let citySource = city ? 'profile' : null;
  if (!city && out.hasResume) {
    city = deriveResumeCity(resumeText);
    citySource = city ? 'resume' : null;
  }
  if (!city) { out.reason = 'no_city'; return out; }
  out.city = city;
  out.citySource = citySource;

  const now = encodeURIComponent(new Date().toISOString());
  const center = await geocodeLocation(city, supabaseUrl, serviceKey).catch(() => null);
  const home = { city, center, miles: RAIL_MILES };
  const parsedCity = parseLocation(city);
  const cityTerm = parsedCity && parsedCity.city ? parsedCity.city : locationDbTerm(city);
  const scope = center ? geoScopeClause(center, RAIL_MILES, cityTerm) : (cityTerm ? `&location=ilike.*${encodeURIComponent(cityTerm)}*` : '');
  const read = (filter, limit) => fetch(`${supabaseUrl}/rest/v1/jobs?${filter}&expires_at=gt.${now}&select=${COLS}&order=score.desc&limit=${limit}`, { headers: dbHeaders })
    .then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const safeTerm = (s) => String(s || '').replace(/[^a-zA-Z0-9\s\-+#.]/g, '').trim().slice(0, 40);

  // Candidate reads, all scoped to the city (or remote): the résumé's role phrases and the role
  // query by TITLE. Skills are not titles — "sales" as a skill is what pulled in the hotel AE.
  const terms = [...new Set([...resume.phrases, roleQuery].map(safeTerm).filter((t) => t.length >= 3))].slice(0, 4);
  const localReads = terms.map((t) => read(`title=ilike.*${encodeURIComponent(t)}*${scope}`, 20));
  const remoteReads = terms.slice(0, 2).map((t) => read(`title=ilike.*${encodeURIComponent(t)}*&location=ilike.*remote*`, 10));
  const allResults = await Promise.all([...localReads, ...remoteReads]);

  const seenIds = new Set();
  const unique = allResults.flat().filter((j) => {
    if (!j?.id || seenIds.has(j.id)) return false;
    seenIds.add(j.id);
    return true;
  });
  const qualifies = (j) => jobMatchesResume(j, resume) && jobNearCity(j, home) && locationScope(j.location) !== 'non_us';
  const matched = unique.filter(qualifies);

  // Floor: when the corpus is thin for this résumé near this city, pull LIVE for the role AT the
  // city through the SAME aggregation the search uses (its cooldown + global budget guards apply).
  if (allowFloor && matched.length < RECS_MIN && roleQuery) {
    const floor = await pullResumeJobFloor({
      query: roleQuery,
      location: city,
      supabaseUrl,
      serviceKey,
      adzunaAppId: process.env.ADZUNA_APP_ID,
      adzunaAppKey: process.env.ADZUNA_APP_KEY,
    });
    const floorRelevant = filterAndRank(floor.jobs || [], roleQuery, { synonyms: expandQueryTerms(roleQuery), canonical: roleQuery });
    for (const j of floorRelevant) {
      const key = j.id || j.apply_url || `${(j.title || '').toLowerCase()}|${(j.company || '').toLowerCase()}`;
      if (!key || seenIds.has(key)) continue;
      seenIds.add(key);
      const r = {
        id: j.id || null, title: j.title, company: j.company, location: j.location,
        salary: j.salary, apply_url: j.apply_url || j.url || null, description: j.description,
        type: j.type || 'Full-time', level: j.level, source: j.source || 'Seen',
        score: j.score, waste_score: j.waste_score, lat: j.lat ?? null, lng: j.lng ?? null,
      };
      if (qualifies(r)) matched.push(r);
    }
  }

  // Rank: match strength (shared role phrase > family only), local before remote, then the
  // listing's own transparency score.
  out.ranked = matched.map((j) => {
    const strength = resumeMatchStrength(j, resume);
    const remote = remoteByLocation(j);
    const miles = !remote && center && hasUsableCoords(center) && hasUsableCoords(j) ? Math.round(haversineMiles(center, j)) : null;
    // Does the listing's role family agree with the résumé's? 'other' = the title names a known,
    // DIFFERENT field ("Medical Device Sales Associate Territory Account Manager" is sales, not the
    // retail "sales associate" the résumé means), even though a phrase overlaps.
    const fam = detectRoleFamily(String(j.title || ''), '').family;
    const family = !fam || fam === 'general' || !resume.families.length ? 'unknown' : resume.families.includes(fam) ? 'same' : 'other';
    return {
      ...j, _strength: strength, _phrase: matchedRolePhrase(j, resume), _family: family, _remote: remote, _miles: miles,
      _matchScore: strength * 10 + (remote ? 0 : 5) + (scoreRow(j).score || 0),
    };
  });
  out.ranked.sort((a, b) => b._matchScore - a._matchScore);
  return out;
}
