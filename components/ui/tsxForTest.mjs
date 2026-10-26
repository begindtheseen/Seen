// Test support: load a TSX/TS component from the repo in plain `node --test` (no bundler).
// Transpiles the file and every repo-local TS/TSX file it imports (relative or '@/…') with the
// TypeScript compiler into a temp folder, points bare 'react*' imports at the installed packages and
// swaps 'next/link' for a plain <a> stub, then imports the entry. Used by components/ui/ui.test.mjs.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, relative } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const req = createRequire(join(ROOT, 'package.json'))
const BARE = {
  react: pathToFileURL(req.resolve('react')).href,
  'react/jsx-runtime': pathToFileURL(req.resolve('react/jsx-runtime')).href,
  'react-dom': pathToFileURL(req.resolve('react-dom')).href,
  'react-dom/server': pathToFileURL(req.resolve('react-dom/server')).href,
}

export async function loadTsx(entry) {
  const out = mkdtempSync(join(tmpdir(), 'seen-ui-'))
  const stub = join(out, '__next_link.mjs')
  writeFileSync(stub, `import { createElement, forwardRef } from ${JSON.stringify(BARE.react)};
export default forwardRef(function Link({ href, prefetch, ...p }, ref) { return createElement('a', { ref, href, ...p }) })\n`)
  const done = new Map()
  const resolveRepo = (spec, from) => {
    const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : resolve(dirname(from), spec)
    for (const cand of [base, base + '.tsx', base + '.ts', join(base, 'index.tsx'), join(base, 'index.ts')]) {
      if (existsSync(cand) && /\.(tsx?|m?js)$/.test(cand)) return cand
    }
    return null
  }
  const build = (file) => {
    if (done.has(file)) return done.get(file)
    if (/\.m?js$/.test(file)) { const u = pathToFileURL(file).href; done.set(file, u); return u }
    const target = join(out, relative(ROOT, file)).replace(/\.tsx?$/, '.mjs')
    const url = pathToFileURL(target).href
    done.set(file, url)
    let src = readFileSync(file, 'utf8').replace(/^'use client'\s*\n/, '')
    src = src.replace(/(from\s+|import\s*\(\s*)(['"])([^'"]+)\2/g, (m, pre, q, spec) => {
      if (BARE[spec]) return `${pre}${q}${BARE[spec]}${q}`
      if (spec === 'next/link') return `${pre}${q}${pathToFileURL(stub).href}${q}`
      if (spec.startsWith('.') || spec.startsWith('@/')) {
        const hit = resolveRepo(spec, file)
        if (!hit) throw new Error(`tsxForTest: cannot resolve ${spec} from ${file}`)
        return `${pre}${q}${build(hit)}${q}`
      }
      return m
    })
    const js = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: file,
    }).outputText.replace(/from\s+(['"])react\/jsx-runtime\1/g, `from ${JSON.stringify(BARE['react/jsx-runtime'])}`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, js)
    return url
  }
  return import(build(resolve(ROOT, entry)))
}

export async function render(element) {
  const { renderToStaticMarkup } = await import(BARE['react-dom/server'])
  return renderToStaticMarkup(element)
}

export async function h() {
  const React = await import(BARE.react)
  return React.createElement
}
