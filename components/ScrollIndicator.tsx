'use client'

export default function ScrollIndicator() {
  return (
    <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'center', padding: '.3rem 0', flexShrink: 0 }}>
      <button
        onClick={() => { document.getElementById('lpBelowFold')?.scrollIntoView({ behavior: 'smooth' }) }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '.4rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.2rem', opacity: .3, transition: 'opacity .2s', animation: 'float 2.4s ease infinite' }}
        title="More below"
      >
        <div style={{ width: 20, height: 1, background: 'rgba(255,255,255,.4)' }} />
        <div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid rgba(255,255,255,.5)' }} />
      </button>
    </div>
  )
}
