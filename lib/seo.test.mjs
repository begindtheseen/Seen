import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pageMetadata, bareTitle, DEFAULT_OG_IMAGE } from './seo.ts'

// Every route's <head> comes from lib/seo.ts pageMetadata (audit 2026-10-24: duplicate homepage
// canonicals, "| Seen | Seen" double suffixes, missing og:image). These checks fail the suite if a
// route grows its own hand-written block again.
const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.join(here, '..', 'app')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/^(page|layout)\.tsx$/.test(name)) out.push(p)
  }
  return out
}

test('pageMetadata: bare title (template adds the suffix once), own canonical, default og:image', () => {
  const m = pageMetadata({ title: 'Pricing | Seen', description: 'd', path: '/pricing' })
  assert.equal(m.title, 'Pricing')
  assert.equal(m.alternates.canonical, 'https://seenjobs.io/pricing')
  assert.equal(m.openGraph.url, 'https://seenjobs.io/pricing')
  assert.equal(m.openGraph.title, 'Pricing | Seen')
  assert.deepEqual(m.openGraph.images, [DEFAULT_OG_IMAGE])
  assert.deepEqual(m.twitter.images, [DEFAULT_OG_IMAGE.url])
  assert.equal(m.robots, undefined)
  assert.equal(pageMetadata({ title: 'x', description: 'd', path: '/dashboard', noindex: true }).robots.index, false)
  assert.equal(pageMetadata({ title: 'x', description: 'd', path: 'https://seenjobs.io/faq/a', type: 'article' }).openGraph.type, 'article')
})

test('bareTitle strips every suffix spelling', () => {
  for (const t of ['Terms | Seen', 'Terms — Seen', 'Terms - Seen', 'Terms – Seen', 'Terms']) assert.equal(bareTitle(t), 'Terms')
})

test('no route hand-writes a "| Seen" title or the homepage canonical', () => {
  const offenders = []
  for (const f of walk(appDir)) {
    const src = readFileSync(f, 'utf8')
    const rel = path.relative(appDir, f)
    if (rel === 'layout.tsx') continue // the root layout owns the template + the "/" canonical
    if (/title:\s*['"`][^'"`\n]*\|\s*Seen['"`]/.test(src)) offenders.push(`${rel}: title carries "| Seen"`)
    if (/canonical:\s*['"`](https:\/\/seenjobs\.io)?\/?['"`]/.test(src)) offenders.push(`${rel}: canonical is the homepage`)
  }
  assert.deepEqual(offenders, [])
})

test('every metadata-bearing route except the root and company layouts goes through pageMetadata', () => {
  const offenders = []
  for (const f of walk(appDir)) {
    const src = readFileSync(f, 'utf8')
    const rel = path.relative(appDir, f)
    if (rel === 'layout.tsx' || rel === path.join('company', '[slug]', 'layout.tsx')) continue
    if (/export (const metadata|async function generateMetadata)/.test(src) && !src.includes('pageMetadata(')) offenders.push(rel)
  }
  assert.deepEqual(offenders, [])
})
