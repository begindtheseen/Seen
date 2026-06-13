'use client'

import { useState } from 'react'
import type { Application } from '@/lib/types'

interface Props {
  app: Application
  onSubmit: (rounds: number, notes: string) => void
  onSkip: () => void
}

export default function RoundsPrompt({ app, onSubmit, onSkip }: Props) {
  const [rounds, setRounds] = useState(0)
  const [notes, setNotes] = useState('')

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) onSkip() }}
    >
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: '1.5rem 1.5rem 2rem', animation: 'fadeUp .25s ease both' }}>
        <div style={{ width: 36, height: 3, background: 'var(--line2)', borderRadius: 2, margin: '0 auto .85rem' }} />
        <div style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.25rem', letterSpacing: '-.02em' }}>
          🎉 Congrats on the offer!
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', marginBottom: '1.25rem' }}>
          {app.company} · {app.role}
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--dim)', marginBottom: '.5rem' }}>
            How many interview rounds total?
          </div>
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            {[1, 2, 3, 4, 5, 6].map(n => (
              <button
                key={n}
                onClick={() => setRounds(n)}
                style={{
                  background: rounds === n ? 'var(--green)' : 'var(--raised)',
                  border: `1px solid ${rounds === n ? 'var(--green)' : 'var(--line2)'}`,
                  color: rounds === n ? 'var(--ink)' : 'var(--sub)',
                  borderRadius: 8, padding: '.5rem .85rem',
                  fontFamily: 'var(--mono)', fontSize: '.82rem', fontWeight: rounds === n ? 700 : 400,
                  cursor: 'pointer', transition: 'all .15s',
                }}
              >{n}</button>
            ))}
            <button
              onClick={() => setRounds(7)}
              style={{
                background: rounds === 7 ? 'var(--green)' : 'var(--raised)',
                border: `1px solid ${rounds === 7 ? 'var(--green)' : 'var(--line2)'}`,
                color: rounds === 7 ? 'var(--ink)' : 'var(--sub)',
                borderRadius: 8, padding: '.5rem .85rem',
                fontFamily: 'var(--mono)', fontSize: '.82rem',
                cursor: 'pointer', transition: 'all .15s',
              }}>7+</button>
          </div>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--dim)', marginBottom: '.5rem' }}>
            Anything notable? (optional)
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Fast process, great team, salary negotiated well..."
            rows={2}
            style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.6rem .85rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem', outline: 'none', resize: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '.6rem' }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1, justifyContent: 'center', fontSize: '.75rem', color: 'var(--muted)' }}
            onClick={onSkip}
          >Skip</button>
          <button
            style={{ flex: 2, background: 'var(--green)', border: 'none', borderRadius: 8, padding: '.7rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', color: 'var(--ink)', cursor: 'pointer' }}
            onClick={() => onSubmit(rounds, notes)}
          >Share to community →</button>
        </div>
      </div>
    </div>
  )
}
