import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heroCells, layoutGrid, MAX_DAY_CELLS } from './cardLayout.js'

test('a decision after N days is N-1 waiting cells and one decision cell', () => {
  const c = heroCells('rejected', 9)
  assert.equal(c.length, 9)
  assert.equal(c.filter(x => x.kind === 'wait').length, 8)
  assert.equal(c[8].kind, 'decision')
  assert.deepEqual(heroCells('hired', 1), [{ kind: 'decision' }])
  assert.deepEqual(heroCells('hired', 0), [{ kind: 'decision' }])
  assert.deepEqual(heroCells('interview', null), [{ kind: 'decision' }])
})

test('ghosted strips are all waiting cells that fade out at the end', () => {
  const c = heroCells('ghosted', 23)
  assert.equal(c.length, 23)
  assert.ok(c.every(x => x.kind === 'wait'))
  assert.equal(c[0].alpha, 1)
  assert.ok(c[22].alpha < 0.2, String(c[22].alpha))
  for (let i = 1; i < c.length; i++) assert.ok(c[i].alpha <= c[i - 1].alpha + 1e-9)
  assert.equal(heroCells('ghosted', 1).length, 1)
  assert.deepEqual(heroCells('ghosted', null), [{ kind: 'wait', alpha: 0.5 }])
})

test(`past ${MAX_DAY_CELLS} days the rest folds into one "+N" cell`, () => {
  const g = heroCells('ghosted', 47)
  assert.equal(g.length, MAX_DAY_CELLS + 1)
  assert.deepEqual(g[MAX_DAY_CELLS], { kind: 'more', label: '+17', alpha: 0.1 })
  const r = heroCells('rejected', 47)
  assert.equal(r.length, MAX_DAY_CELLS + 1)
  assert.equal(r[MAX_DAY_CELLS - 1].kind, 'more')
  assert.equal(r[MAX_DAY_CELLS - 1].label, '+17') // 46 waiting days: 29 shown + 17 folded
  assert.equal(r[MAX_DAY_CELLS].kind, 'decision')
  assert.equal(heroCells('rejected', 31).length, MAX_DAY_CELLS + 1)
  assert.equal(heroCells('rejected', 30).length, MAX_DAY_CELLS)
})

test('tracked events mark their day cell and keep it visible through a ghosted fade', () => {
  const c = heroCells('ghosted', 23, [{ day: 4, kind: 'reply' }, { day: 21, kind: 'interview' }])
  assert.equal(c[3].mark, 'reply')
  assert.equal(c[20].mark, 'interview')
  assert.equal(c[20].alpha, 1)
  assert.ok(c[21].alpha < 1)
  // a mark on the decision day never overrides the decision cell; day 0 lands on the first cell
  const r = heroCells('hired', 12, [{ day: 12, kind: 'interview' }, { day: 0, kind: 'reply' }])
  assert.equal(r[11].kind, 'decision')
  assert.equal(r[0].mark, 'reply')
  assert.deepEqual(heroCells('rejected', 9), heroCells('rejected', 9, []))
})

test('grid: long stories are 7 per row, short ones get fewer, larger tiles; always inside the box', () => {
  for (const n of [1, 2, 3, 5, 8, 9, 12, 14, 15, 23, 30, 31]) {
    const g = layoutGrid(n, 512, 300)
    assert.ok(g.width <= 512 && g.height <= 300, `${n}: ${g.width}×${g.height}`)
    assert.ok(g.perRow * g.rows >= n)
    assert.ok(g.cell >= 40, `${n}: cell ${g.cell}`)
  }
  assert.equal(layoutGrid(23, 512, 300).perRow, 7)
  assert.equal(layoutGrid(31, 512, 300).rows, 5)
  assert.equal(layoutGrid(5, 512, 300).perRow, 3)
  assert.equal(layoutGrid(12, 512, 300).perRow, 4)
  assert.ok(layoutGrid(5, 512, 300).cell > layoutGrid(23, 512, 300).cell)
  assert.equal(layoutGrid(1, 512, 300).cell, 150)
})
