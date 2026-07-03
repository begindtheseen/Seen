'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')

// Query-param handler for the old /compare?a=&b= deep links — kept CLIENT-side so the /compare
// server page stays fully static (reading searchParams server-side was a dynamic-usage build
// failure). One param prefills the picker; both params redirect to the canonical
// /compare/[a]-vs-[b] SEO page. Must render inside a <Suspense> boundary (useSearchParams).
export function CompareQuery() {
  const router = useRouter()
  const sp = useSearchParams()
  const a = (sp.get('a') || '').trim()
  const b = (sp.get('b') || '').trim()
  useEffect(() => {
    if (a && b) {
      const sa = slugify(a), sb = slugify(b)
      if (sa && sb) router.replace(`/compare/${sa}-vs-${sb}`)
    }
  }, [a, b, router])
  return <ComparePicker initialA={a} initialB={b} />
}

// Two-company picker. On submit, routes to the canonical /compare/[a]-vs-[b] SEO page.
export default function ComparePicker({ initialA = '', initialB = '' }: { initialA?: string; initialB?: string }) {
  const router = useRouter()
  const [a, setA] = useState(initialA)
  const [b, setB] = useState(initialB)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const sa = slugify(a), sb = slugify(b)
    if (!sa || !sb) return
    router.push(`/compare/${sa}-vs-${sb}`)
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', maxWidth: 720, margin: '0 auto 2rem' }}>
      <input value={a} onChange={e => setA(e.target.value)} placeholder="First company"
        style={{ flex: '1 1 160px', minWidth: 0, background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.7rem .9rem', color: 'var(--white)', fontFamily: 'var(--body)', fontSize: '.85rem', outline: 'none' }} />
      <span style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--dim)', fontSize: '.8rem' }}>vs</span>
      <input value={b} onChange={e => setB(e.target.value)} placeholder="Second company"
        style={{ flex: '1 1 160px', minWidth: 0, background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.7rem .9rem', color: 'var(--white)', fontFamily: 'var(--body)', fontSize: '.85rem', outline: 'none' }} />
      <button type="submit" className="btn" style={{ flex: '0 0 auto', background: 'linear-gradient(135deg,var(--g-start),var(--g-mid),var(--g-end))', color: '#fff', padding: '.7rem 1.4rem', fontWeight: 800 }}>Compare</button>
    </form>
  )
}
