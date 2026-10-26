// The a11y contract of the shared UI primitives (components/ui). Each component is transpiled and
// server-rendered with react-dom/server, and the markup is checked for the attributes assistive tech
// relies on. Behaviour that needs a live DOM (the focus trap itself) lives in lib/hooks/useFocusTrap
// and is exercised by the Playwright pass; here we pin the wiring that makes it work.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadTsx, render, h } from './tsxForTest.mjs'
import { ghostRateTone, responseRateTone, gradeTone, gradeToneFromLetter, TONE_ICON } from '../../lib/ui/tone.js'
import { gradeRisk, gradeLetter } from '../../lib/gradeScale.js'

const el = await h()
const { default: Button, buttonClass } = await loadTsx('components/ui/Button.tsx')
const { default: Field, TextInput, fieldIds } = await loadTsx('components/ui/Field.tsx')
const { DialogSurface, dialogA11y, dialogKey } = await loadTsx('components/ui/Dialog.tsx')
const { default: Icon } = await loadTsx('components/ui/Icon.tsx')
const { default: Badge, Chip } = await loadTsx('components/ui/Badge.tsx')
const { default: Disclosure } = await loadTsx('components/ui/Disclosure.tsx')
const { default: StatTile } = await loadTsx('components/ui/StatTile.tsx')
const attr = (html, name) => { const m = html.match(new RegExp(`${name}="([^"]*)"`)); return m ? m[1] : null }

test('Button: a real <button type="button"> by default, one class per variant/size', async () => {
  const html = await render(el(Button, { variant: 'primary' }, 'Track it'))
  assert.match(html, /^<button type="button" class="ui-btn ui-btn--primary"/)
  assert.equal(buttonClass({ variant: 'ghost', size: 'sm', full: true }), 'ui-btn ui-btn--ghost ui-btn--sm ui-btn--full')
  const sub = await render(el(Button, { type: 'submit' }, 'Save'))
  assert.match(sub, /type="submit"/)
})

test('Button: internal href → link, external → plain anchor, disabled link has no href', async () => {
  assert.match(await render(el(Button, { href: '/tracker' }, 'Open')), /^<a href="\/tracker" class="ui-btn/)
  assert.match(await render(el(Button, { href: 'https://example.com/job', target: '_blank', rel: 'noopener noreferrer' }, 'Apply')), /href="https:\/\/example.com\/job"/)
  const dis = await render(el(Button, { href: '/x', disabled: true }, 'Soon'))
  assert.equal(attr(dis, 'href'), null)
  assert.equal(attr(dis, 'aria-disabled'), 'true')
})

test('Button: loading is announced and blocks the click', async () => {
  const html = await render(el(Button, { loading: true, variant: 'primary' }, 'Saving'))
  assert.match(html, /disabled=""/)
  assert.equal(attr(html, 'aria-busy'), 'true')
  assert.match(html, /ui-btn__spin/)
})

test('Field: the label is tied to the control, hint and error are described-by', async () => {
  const html = await render(el(TextInput, { label: 'Company', hint: 'As it appears on the posting', error: 'Required' }))
  const id = attr(html.match(/<input[^>]*>/)[0], 'id')
  assert.ok(id, 'input has an id')
  assert.equal(attr(html.match(/<label[^>]*>/)[0], 'for'), id, 'label htmlFor = input id')
  const described = attr(html.match(/<input[^>]*>/)[0], 'aria-describedby').split(' ')
  assert.equal(described.length, 2)
  for (const d of described) assert.match(html, new RegExp(`id="${d}"`), `described-by target ${d} exists`)
  assert.equal(attr(html.match(/<input[^>]*>/)[0], 'aria-invalid'), 'true')
  assert.match(html, /role="alert"/)
})

test('Field: no hint/error → no dangling aria-describedby; render prop gets the same id', async () => {
  const html = await render(el(Field, { label: 'City' }, (p) => el('select', { className: 'ui-input', ...p }, el('option', null, 'Phoenix'))))
  const sel = html.match(/<select[^>]*>/)[0]
  assert.equal(attr(sel, 'aria-describedby'), null)
  assert.equal(attr(html.match(/<label[^>]*>/)[0], 'for'), attr(sel, 'id'))
  const ids = fieldIds(':r7:', { hint: true })
  assert.deepEqual([ids.id, ids.hintId, ids.errorId, ids.describedBy], ['fr7', 'fr7-hint', undefined, 'fr7-hint'])
})

test('Dialog: role=dialog, aria-modal, named by its title, described by its description', async () => {
  const html = await render(el(DialogSurface, { title: 'Upgrade', description: 'One pass, 30 days.', onClose() {}, titleId: 'dt', descId: 'dd' }, el('p', null, 'body')))
  const panel = html.match(/^<div[^>]*>/)[0]
  assert.equal(attr(panel, 'role'), 'dialog')
  assert.equal(attr(panel, 'aria-modal'), 'true')
  assert.equal(attr(panel, 'aria-labelledby'), 'dt')
  assert.equal(attr(panel, 'aria-describedby'), 'dd')
  assert.match(html, /<h2 id="dt"[^>]*>Upgrade<\/h2>/)
  assert.match(html, /<p id="dd"[^>]*>One pass, 30 days.<\/p>/)
  assert.match(html, /<button type="button" class="ui-dialog__close"[^>]*aria-label="Close"/)
  // no description → no aria-describedby pointing at nothing
  const bare = await render(el(DialogSurface, { title: 'Hi', onClose() {}, titleId: 'a', descId: 'b' }))
  assert.equal(attr(bare.match(/^<div[^>]*>/)[0], 'aria-describedby'), null)
  assert.deepEqual(dialogA11y({ titleId: 'x' }), { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'x', tabIndex: -1 })
})

test('Dialog: Escape closes only when dismissable', () => {
  let closed = 0
  assert.equal(dialogKey('Escape', true, () => closed++), true)
  assert.equal(closed, 1)
  assert.equal(dialogKey('Escape', false, () => closed++), false)
  assert.equal(dialogKey('Enter', true, () => closed++), false)
  assert.equal(closed, 1)
})

test('Dialog: a solid overlay surface, no glass, focus trapped via the shared hook', () => {
  const css = readFileSync(fileURLToPath(new URL('./ui.css', import.meta.url)), 'utf8')
  const rule = css.match(/\n\.ui-dialog\{[^}]*\}/)[0]
  assert.match(rule, /background:var\(--surface-overlay\)/)
  assert.doesNotMatch(css, /backdrop-filter/)
  const src = readFileSync(fileURLToPath(new URL('./Dialog.tsx', import.meta.url)), 'utf8')
  assert.match(src, /useFocusTrap\(panel, open\)/)
  assert.match(src, /<ModalPortal>/)
})

test('Icon: decorative by default, role=img with a name when labelled', async () => {
  const deco = await render(el(Icon, { name: 'ghost' }))
  assert.equal(attr(deco, 'aria-hidden'), 'true')
  assert.equal(attr(deco, 'role'), null)
  const named = await render(el(Icon, { name: 'triangle-alert', label: 'Warning' }))
  assert.equal(attr(named, 'role'), 'img')
  assert.equal(attr(named, 'aria-label'), 'Warning')
  assert.equal(attr(named, 'aria-hidden'), null)
})

test('Badge: a toned badge always carries an icon and a word', async () => {
  for (const tone of ['good', 'caution', 'bad']) {
    const html = await render(el(Badge, { tone }, 'Low ghost rate'))
    assert.match(html, new RegExp(`ui-badge--${tone}`))
    assert.match(html, /<svg[^>]*aria-hidden="true"/)
    assert.match(html, /Low ghost rate<\/span>$/)
  }
  const neutral = await render(el(Badge, null, 'Remote'))
  assert.doesNotMatch(neutral, /<svg/)
})

test('Chip: a real button that exposes its toggle state', async () => {
  assert.match(await render(el(Chip, { selected: true }, 'Remote')), /<button type="button" class="ui-chip" aria-pressed="true"/)
  assert.doesNotMatch(await render(el(Chip, null, 'Clear')), /aria-pressed/)
})

test('Disclosure: native details/summary, open when asked', async () => {
  const html = await render(el(Disclosure, { title: 'Quotes', defaultOpen: true }, el('p', null, 'x')))
  assert.match(html, /^<details class="ui-disc" open="">/)
  assert.match(html, /<summary>/)
})

test('StatTile: a toned figure says its word next to the icon', async () => {
  const html = await render(el(StatTile, { label: 'Ghost rate', value: '62%', tone: 'bad', toneWord: 'High' }))
  assert.match(html, /ui-stat__value--bad/)
  assert.match(html, /<span>High<\/span>/)
  const empty = await render(el(StatTile, { label: 'Avg wait', value: null }))
  assert.match(empty, /—/)
})

test('tone: thresholds in one place, grades follow the letter', () => {
  assert.equal(ghostRateTone(0.02), 'good')
  assert.equal(ghostRateTone(0.4), 'caution')
  assert.equal(ghostRateTone(0.62), 'bad')
  assert.equal(ghostRateTone(null), null)
  assert.equal(responseRateTone(0.87), 'good')
  assert.equal(responseRateTone(0.45), 'caution')
  assert.equal(responseRateTone(0.13), 'bad')
  for (const s of [100, 93, 88, 80, 79, 72, 69, 40, 0]) {
    const risk = gradeRisk(s)
    assert.equal(gradeTone(s), risk === 'safe' ? 'good' : risk === 'warn' ? 'caution' : 'bad', `score ${s}`)
    assert.equal(gradeToneFromLetter(gradeLetter(s)), gradeTone(s))
  }
  assert.deepEqual(Object.keys(TONE_ICON), ['good', 'caution', 'bad'])
})
