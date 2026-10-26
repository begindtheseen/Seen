import { gradeRisk } from './gradeScale.js';
// ── Seen card theme — ONE palette and type scale for every share surface ──────────────────
// The canvas outcome card, the canvas company card (lib/cardKit.ts) and the server-rendered
// OG unfurl (app/company/[slug]/og/route.tsx) all read from here, so they can never drift
// apart. Pure data + tiny pure helpers (no DOM, no I/O) — importable from client, server,
// and node --test alike. Tests: lib/cardCopy.test.mjs (contrast of every text tier ≥ 4.5:1).

/** The ink every card is printed on. */
export const INK = '#070810';

/**
 * Text tiers as white alpha over INK. Every value here clears WCAG 4.5:1 against INK (pinned
 * by test) — the lowest tier is 0.5, not the 0.45 a lighter hand would reach for.
 */
export const TEXT = Object.freeze({
  full: 1,
  strong: 0.85,
  body: 0.62,
  meta: 0.55,
  faint: 0.5,
});

/**
 * One accent per outcome. Each accent is a saturated mid-tone chosen to read ≥ 4.5:1 on INK
 * as TEXT (the company name in the headline is set in it). `dim` is the "waiting day" cell
 * fill, `bloom` the single soft light behind the hero graphic.
 */
export const ACCENTS = Object.freeze({
  ghosted:   Object.freeze({ hex: '#ff5c75', dim: 0.22, bloom: 0.17 }), // red with a violet undertone
  rejected:  Object.freeze({ hex: '#f9843a', dim: 0.22, bloom: 0.16 }), // warm amber-red
  hired:     Object.freeze({ hex: '#1fd1a1', dim: 0.22, bloom: 0.15 }), // rich emerald
  interview: Object.freeze({ hex: '#5b9bff', dim: 0.22, bloom: 0.16 }), // reply blue
  waiting:   Object.freeze({ hex: '#f5b740', dim: 0.22, bloom: 0.14 }), // amber
});

/** Outcome strings the tracker / API use → the accent family they belong to. */
export function accentKeyForOutcome(outcome) {
  const o = String(outcome || '').toLowerCase();
  if (o === 'hired' || o === 'offer' || o === 'human') return 'hired';
  if (o === 'ghosted') return 'ghosted';
  if (o === 'rejected' || o === 'autoreject') return 'rejected';
  if (o === 'interview' || o === 'interviewing' || o === 'assessment') return 'interview';
  return 'waiting';
}

/** A company's risk level → accent family (safe = emerald, warn = amber-red, danger = red). */
export function accentKeyForRisk(risk) {
  return risk === 'safe' ? 'hired' : risk === 'danger' ? 'ghosted' : 'rejected';
}

/** The risk level the score alone implies (same thresholds as lib/growth.ts / api/reports.js). */
/** @returns {'safe'|'warn'|'danger'} */
export function riskForScore(score) {
  return gradeRisk(Number(score) || 0) || 'danger';
}

/** '#rrggbb' + alpha → 'rgba(r,g,b,a)'. */
export function rgba(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** White at `alpha` over INK, as a solid rgb — what the eye actually sees. */
export function whiteOnInk(alpha) {
  const n = parseInt(INK.slice(1), 16);
  const ch = (c) => Math.round(c + alpha * (255 - c));
  return [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)];
}

function luminance([r, g, b]) {
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function toRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG contrast ratio between two colours given as [r,g,b] or '#rrggbb'. */
export function contrast(a, b) {
  const la = luminance(Array.isArray(a) ? a : toRgb(a));
  const lb = luminance(Array.isArray(b) ? b : toRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Type scale shared by the canvas kit and the OG route (px at 1080-wide; the OG scales ×0.8). */
export const TYPE = Object.freeze({
  display: '"Syne", sans-serif',
  text: '"Instrument Sans", sans-serif',
  wordmark: 40,
  meta: 22,
  headline: 100,
  headlineMin: 72,
  sub: 30,
  number: 190,
  numberLabel: 26,
  context: 24,
  footerUrl: 26,
  footerNote: 22,
});
