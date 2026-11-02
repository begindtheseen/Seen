# Seen — the design system (locked 2026-11-02)

This file is the whole visual system. Every page, component and AI-generated change follows it.
Nothing here is a suggestion: `lib/ui/designRules.test.mjs` fails the test suite on a break it can see in
the source, and `node scripts/design-audit.mjs` fails on a break it can see in the rendered page.
A new colour, size, radius, shadow or font is a token in `app/globals.css` or it does not ship.

## 1. Personality — three words, and what each one means on screen

Seen tells job seekers who actually responds before they spend an hour applying. The product is
**Candid. Calm. Exact.** The reference is not another SaaS site: it is an **air-traffic control room at
night** — a dark room, every reading real, one thing lit at a time, nothing moving unless something changed.

| Word | What it means visually |
|------|------------------------|
| **Candid** | A number is shown as a number, with its confidence beside it ("No grade without enough evidence"). The accent marks the one thing you can *do* here, never decoration. No glow, gradient or sheen that implies more than the data supports. Semantic colour (good / caution / bad) always comes with a word and an icon. |
| **Calm** | Dark solid surfaces. An 8px rhythm with generous section spacing. One headline per screen, one filled button per screen. Motion only when state changes, never to attract attention. Overlays dim with a solid colour, never blur. |
| **Exact** | Syne headlines at tight tracking. Tabular figures everywhere (columns of numbers line up). 1px hairline borders at three fixed alphas. One radius scale, four shadows, one type scale. Twelve pixels is the smallest text at any width. |

## 2. Colour — 60 / 30 / 10, and every value is a token

The site is **60% dark field, 30% neutral ink, 10% colour**. Colour is spent on actions and states,
not on labels, headings or ornament.

| Share | Role | Tokens (app/globals.css) |
|-------|------|--------------------------|
| **60** — the field | page and card surfaces | `--bg` `--surface-1` `--surface-2` `--surface-3` `--surface-overlay` |
| **30** — the ink | text tiers, borders, outlined controls, inputs, chips | `--text-1` … `--text-4` · `--border-1/2/3` |
| **10** — the signal | THE primary button, links, the active tab/nav item, focus ring, one highlighted word in a hero; and state colour on things that have a state | `--cta` `--cta-hover` `--accent` `--accent-strong` `--accent-tint` `--accent-line` · `--good*` `--caution*` `--bad*` `--info*` |

Rules:
- **One accent, flat.** Blue (`--accent` for text/icons at 7:1, `--accent-strong` / `--cta` for fills). No second hue "for pop".
- **Eyebrows, kickers, section labels and meta are ink (`--text-3`), never the accent.** If everything is highlighted, nothing is.
- **Semantic colours are decided by a threshold** (`lib/ui/tone.js`) and always paired with a word and an icon.
- **Retired for good:** indigo, violet, purple, fuchsia; any gradient that mixes two colours; glow shadows; gradient text; glass over content; `backdrop-filter` on a full-screen overlay (iOS paints it black).
- **No raw hex or rgb in a component or page** (`*.module.css`, `.tsx` style props). The only files that may hold literal colours are `app/globals.css` (the tokens), the OG-image and canvas renderers (they cannot read CSS variables), and SVG assets.

## 3. Type — two fonts, one scale, one headline

| Family | Token | Weights | Use |
|--------|-------|---------|-----|
| **Syne** | `--display` | 700, 800 | H1–H3 only. Never buttons, prices or figures. |
| **Instrument Sans** | `--body` (and `--mono`, which now aliases it) | 400, 500, 600 | Everything people read and press, figures included. |

- **Exactly two families ship** (`app/layout.tsx` loads them with `next/font/local` from `app/fonts/`). A third font, a build-time Google download, or a weight not listed is a failed test.
- **Tabular figures are on for the whole page** (`body{font-variant-numeric:tabular-nums}`), so stats, prices, dates and odometers never shift as digits change.
- **The scale is the `--fs-*` tokens** (12 / 13 / 14 / 15 / 17 / 20 / 24 / 28 / 32 / 40 / 56 / display). 12px is the floor at every width; below 15px, hierarchy comes from weight (600), case and colour tier, not from smaller text.
- **One `<h1>` per screen.** It is the only Syne display-size element on the page. Section titles are H2 at `--fs-h2`, card titles are body-weight 600.
- Eyebrows: 12px, 600, `letter-spacing:var(--ls-meta)`, uppercase, `--text-3`.

## 4. Spacing — the 8px grid

- **Layout spacing is a multiple of 8**: section padding, gaps between blocks, card padding, margins between elements → `--sp-2` 8 · `--sp-4` 16 · `--sp-6` 24 · `--sp-8` 32 · `--sp-12` 48 · `--sp-16` 64 · `--sp-24` 96.
- **Inside a component, 4px steps are allowed** (icon-to-label gap, chip and input padding): `--sp-1` 4 · `--sp-3` 12 · `--sp-5` 20. Above 32px only multiples of 8 exist.
- 1px and 2px are for hairlines and chip insets, nothing else.
- Radii: `--r-chip` 6 · `--r-control` 10 · `--r-card` 14 · `--r-panel` 20 · `--r-pill`. Shadows: `--sh-control` `--sh-raised` `--sh-overlay` `--sh-focus` — the only four.
- Content widths: `--w-narrow` 720 · `--w-mid` 960 · `--w-wide` 1200. Phone gutter 16px; no horizontal scroll at 360/390/430.

The whole codebase was snapped to this grid on 2026-11-02 (1,140 values, each moved ≤2px). The test keeps it there.

## 5. Layout — one scroll, one button, less on the screen

- **One scroll per page.** No nested scroll regions in the main flow; drawers and sheets are the only exceptions.
- **One primary (filled `--cta`) button per screen.** Everything else is outlined, ghost or a text link. A list of cards carries outlined actions; the page's filled button is the thing the page is for (Search on /jobs, Track on /tracker, Start on /pricing).
- **Less density reads as more expensive.** A card shows at most one title, one line of support and one row of meta. A row holds ≤3 facts. Cards sit ≤3 across on desktop. Empty states say what to do next in one sentence and one button.
- **Phone first at 390px**, then 768 and 1200. Controls ≥44px tall; text ≥12px; a `1fr` track is always `minmax(0,1fr)` (a nowrap child must not widen the page).
- **Navigation remembers where you came from** (`lib/nav/`): Back closes what you opened, scroll comes back, the list is still there.

## 6. Motion

Transform and opacity only; durations are the `--dur-*` tokens; one or two moving elements per view; everything
neutralised under `prefers-reduced-motion`. Animations finish instantly while the tab is hidden (`html.tab-hidden`).
No attention-seeking loops, no parallax, no aurora.

## 7. The checklist before anything ships

1. Every colour, size, radius, shadow and font is a token. No raw values.
2. One `<h1>`, one filled button, one scroll on the screen.
3. Labels are ink; colour is on actions and states only.
4. Spacing on the grid; text ≥12px; controls ≥44px; nothing overflows at 390.
5. `node --test lib/ui/designRules.test.mjs` passes; `node scripts/design-audit.mjs` passes against `next start`; `node scripts/overlap-sweep.mjs` is clean.

## 8. Using the ui-ux-pro-max skill

`.claude/skills/ui-ux-pro-max/` (searchable UX rules, patterns, chart types, accessibility criteria) is for decisions
**inside** this system — a component pattern, a WCAG criterion, a chart type, an empty-state pattern:

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "error summary validation" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "comparison bar" --domain chart
```

Do not use its `--design-system` output to pick a palette, a font or a style: those are decided above. Its
Quick Reference §1–§3 (accessibility, touch, performance) is the review list for any new screen.
