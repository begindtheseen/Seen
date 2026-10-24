// ── Card layout math — the outcome card's hero calendar, pure and tested ─────────────────
// `heroCells` decides what the day-grid says (one cell per day since applying, the decision
// day marked, ghosting fading out, 30-day cap with an overflow cell); `layoutGrid` decides
// how it sits in its box (more cells per row for long stories, bigger tiles for short ones).
// No DOM. Tests: lib/cardLayout.test.mjs.

/** Days shown as individual cells before the strip folds the rest into one "+N" cell. */
export const MAX_DAY_CELLS = 30;

/**
 * The cells of the hero strip, oldest first.
 * kind: 'wait' (a day of silence) · 'decision' (the day they answered) · 'more' (the folded "+N")
 * alpha: the fill strength 0–1 for 'wait' cells (ghosted stories fade toward 0 at the end).
 */
export function heroCells(outcomeKind, days) {
  const n = days == null || !Number.isFinite(Number(days)) ? null : Math.max(0, Math.round(Number(days)));
  const ghosted = outcomeKind === 'ghosted' || outcomeKind === 'waiting';
  const cells = [];
  if (n == null) {
    // No day count: a single cell says only what we know.
    cells.push(ghosted ? { kind: 'wait', alpha: 0.5 } : { kind: 'decision' });
    return cells;
  }
  if (ghosted) {
    const shown = Math.min(n, MAX_DAY_CELLS);
    const count = Math.max(1, shown);
    // The last 45% of the strip fades to almost nothing: the literal shape of being ghosted.
    const fadeFrom = Math.floor(count * 0.55);
    for (let i = 0; i < count; i++) {
      const t = i < fadeFrom ? 0 : (i - fadeFrom + 1) / (count - fadeFrom);
      cells.push({ kind: 'wait', alpha: 1 - t * 0.9 });
    }
    if (n > MAX_DAY_CELLS) cells.push({ kind: 'more', label: `+${n - MAX_DAY_CELLS}`, alpha: 0.1 });
    return cells;
  }
  // A decision: waiting days, then the day they answered. Day 0 / day 1 is one solid cell.
  const waiting = Math.max(0, n - 1);
  if (waiting > MAX_DAY_CELLS - 1) {
    for (let i = 0; i < MAX_DAY_CELLS - 1; i++) cells.push({ kind: 'wait', alpha: 1 });
    cells.push({ kind: 'more', label: `+${waiting - (MAX_DAY_CELLS - 1)}`, alpha: 1 });
  } else {
    for (let i = 0; i < waiting; i++) cells.push({ kind: 'wait', alpha: 1 });
  }
  cells.push({ kind: 'decision' });
  return cells;
}

/**
 * Fit `count` cells into a `boxW` × `boxH` box. Long stories read as a calendar (7 per row);
 * short ones get fewer, larger tiles so the graphic always fills its box.
 * Returns { perRow, rows, cell, gap, width, height } in px.
 */
export function layoutGrid(count, boxW, boxH, opts = {}) {
  const n = Math.max(1, Math.round(count));
  const maxCell = opts.maxCell ?? 150;
  const gapRatio = opts.gapRatio ?? 0.17;
  const perRow = n <= 3 ? n : n <= 8 ? Math.ceil(n / 2) : n <= 14 ? Math.ceil(n / 3) : 7;
  const rows = Math.ceil(n / perRow);
  const cell = Math.floor(Math.min(
    boxW / (perRow + (perRow - 1) * gapRatio),
    boxH / (rows + (rows - 1) * gapRatio),
    maxCell,
  ));
  const gap = Math.round(cell * gapRatio);
  return { perRow, rows, cell, gap, width: perRow * cell + (perRow - 1) * gap, height: rows * cell + (rows - 1) * gap };
}
