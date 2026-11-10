// What a line IS, read from its own words — the check on what the heading above it says.
//
// The coordinator's first test (2026-11-10): under an unrecognised heading "Tickets and training" the lines
// "OSHA forklift cert (renewed 2025); First aid / CPR" and "Rio Salado College - some coursework, business,
// 2011" were printed as two JOBS, and the heading became an employer. Section assignment is now checked
// against content: a credential-shaped line is a certification and a school-shaped line is education,
// whatever heading it sat under. Pure, no I/O.

import { findDateRange } from './dates.js';
import { SCHOOL_RE, TITLE_WORD_RE, BULLET_OPENER_RE } from './lexicon.js';

const CRED_RE = /\b(?:certs?|certified|certification|certificate|licen[cs]e[ds]?|licensure|tickets?|cards?|cpr|bls|acls|pals|nrp|first aid|osha(?:\s*\d+)?|registered|registration|permit|endorsements?|servsafe|food handler|cdl(?:-?[abc])?|twic|nihss|hazmat|tncc|nccer|epa\s*608|notary|forklift)\b/i;
const STRONG_CRED_RE = /\b(?:certs?|certified|certification|certificate|licen[cs]e[ds]?|licensure|tickets?|cards?|cpr|bls|acls|pals|first aid|permit|endorsements?|twic)\b/i;
const RENEW_RE = /\b(?:renewed|renewal|expires?|exp\.?|expiring|valid (?:through|until|thru)|issued)\b[^()]{0,20}\b(?:19|20)\d{2}\b/i;
const DEGREE_WORD_RE = /\b(?:bachelor'?s?|master'?s?|associate'?s? (?:degree|of)|ph\.?\s?d|mba|b\.?s\.?c?|b\.?a\.?|m\.?s\.?|m\.?a\.?|a\.?a\.?s?\.?|a\.?s\.?|bsn|msn|diploma|ged|coursework|some college|degree|major|minor|gpa|graduated|enrolled)\b/i;

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

/**
 * @param {string} text one line
 * @returns {'certification'|'education'|null}
 */
export function contentKind(text) {
  const t = String(text || '').trim();
  if (!t || words(t) > 18) return null;
  if (BULLET_OPENER_RE.test(t) && words(t) >= 4) return null; // a duty line ("Led OSHA training for the crew")
  if (/[.!?]$/.test(t) && words(t) >= 6) return null; // a sentence ("Available for travel; notary public in Colorado.")
  const school = SCHOOL_RE.test(t) || DEGREE_WORD_RE.test(t);
  const range = findDateRange(t);
  // a job at a school ("Teacher — Lincoln High School | 2015 – 2019") is a job
  const titleBeyond = TITLE_WORD_RE.test(t.replace(SCHOOL_RE, ' ').replace(DEGREE_WORD_RE, ' ').replace(/\bassociate'?s? (?:degree|of)\b/gi, ' '));
  // "HubSpot Academy — Social Media Marketing Certification": a credential from an issuer named like a
  // school is a certification ("Truck Driving Certificate — El Paso Community College" stays education)
  const credFromSchool = /\b(?:certified|certification|licen[cs]e[ds]?|licensure|ticket|card|cpr|bls|acls|first aid|permit|endorsements?)\b/i.test(t) && !DEGREE_WORD_RE.test(t);
  if (school && !credFromSchool && !(range && titleBeyond)) return 'education';
  if (range || !(CRED_RE.test(t) || RENEW_RE.test(t))) return null;
  // "Forklift Operator, Copper State Logistics": a title beside an employer is a role, unless the line
  // names the credential itself (cert, licence, ticket, card, CPR, renewed 2025…)
  // "Arizona LPN License — State Board of Nursing": the first piece ENDS in the credential noun
  const first = t.split(/\s[—–|-]\s+|,\s+|;\s+/)[0].replace(/\([^)]*\)/g, ' ').trim();
  if (/\b(?:licen[cs]e|licensure|cert|certs|certification|certificate|ticket|card|permit|endorsements?|cpr|bls|acls|first aid)\s*$/i.test(first)) return 'certification';
  const employerPiece = /\s[—–|-]\s+[A-Z]|,\s+[A-Z]/.test(t);
  if (titleBeyond && employerPiece && !RENEW_RE.test(t) && !STRONG_CRED_RE.test(t.split(/\s[—–|-]\s+|,\s+/).slice(1).join(' '))) return null;
  return 'certification';
}
