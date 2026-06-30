import { ImageResponse } from 'next/og'

// Default site-wide OG share image (homepage + any route without its own image).
export const runtime = 'nodejs'
export const alt = 'Seen — know how a company treats applicants before you apply'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#05070f',
          backgroundImage:
            'radial-gradient(ellipse at 25% 0%, rgba(99,102,241,0.20) 0%, transparent 55%), radial-gradient(ellipse at 90% 100%, rgba(124,58,237,0.16) 0%, transparent 55%)',
          padding: '72px 80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 18, height: 18, borderRadius: 999, background: '#3b82f6' }} />
          <div style={{ fontSize: 36, fontWeight: 800, color: '#f9fafb', letterSpacing: -0.5 }}>
            Seen
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 84,
            fontWeight: 800,
            color: '#f9fafb',
            letterSpacing: -2,
            lineHeight: 1.04,
            marginTop: 36,
            maxWidth: 980,
          }}
        >
          Know how a company treats applicants — before you apply.
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 32,
            color: '#9ca3af',
            marginTop: 28,
            lineHeight: 1.4,
            maxWidth: 920,
          }}
        >
          Ghost rates, response times, and hiring grades for 47,000+ companies — from real applicant reports.
        </div>

        <div style={{ display: 'flex', gap: 16, marginTop: 44 }}>
          <Pill text="Ghost rate" color="#ef4444" />
          <Pill text="Response time" color="#10b981" />
          <Pill text="Seen Grade A–F" color="#3b82f6" />
        </div>

        <div style={{ display: 'flex', fontSize: 26, color: '#6b7280', marginTop: 48 }}>
          seenjobs.io
        </div>
      </div>
    ),
    size
  )
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        fontSize: 26,
        fontWeight: 700,
        color,
        background: `${color}1f`,
        border: `1px solid ${color}55`,
        borderRadius: 10,
        padding: '12px 22px',
      }}
    >
      {text}
    </div>
  )
}
