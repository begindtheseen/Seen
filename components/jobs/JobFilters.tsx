'use client'

import type { NicheFilter, LevelFilter, TypeFilter, PostedFilter } from '@/lib/hooks/useJobSearch'

export default function JobFilters({
  niche, setNiche,
  level, setLevel,
  jobType, setJobType,
  posted, setPosted,
  hasFilters, clearFilters,
  selectStyle,
}: {
  niche: NicheFilter; setNiche: (v: NicheFilter) => void
  level: LevelFilter; setLevel: (v: LevelFilter) => void
  jobType: TypeFilter; setJobType: (v: TypeFilter) => void
  posted: PostedFilter; setPosted: (v: PostedFilter) => void
  hasFilters: boolean; clearFilters: () => void
  selectStyle: React.CSSProperties
}) {
  return (
    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.6rem', alignItems: 'center' }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)' }}>Filter:</span>
      <select value={niche} onChange={e => setNiche(e.target.value as NicheFilter)} style={selectStyle}>
        <option value="">Any industry</option>
        <option value="tech">Tech / Software</option>
        <option value="healthcare">Healthcare</option>
        <option value="retail">Retail / Food Service</option>
        <option value="logistics">Logistics / Warehouse</option>
        <option value="finance">Finance</option>
        <option value="other">Other</option>
      </select>
      <select value={level} onChange={e => setLevel(e.target.value as LevelFilter)} style={selectStyle}>
        <option value="">Any level</option>
        <option value="entry">Entry level</option>
        <option value="mid">Mid level</option>
        <option value="senior">Senior</option>
      </select>
      <select value={jobType} onChange={e => setJobType(e.target.value as TypeFilter)} style={selectStyle}>
        <option value="">Any type</option>
        <option value="Full-time">Full-time</option>
        <option value="Part-time">Part-time</option>
        <option value="Contract">Contract</option>
      </select>
      <select value={posted} onChange={e => setPosted(e.target.value as PostedFilter)} style={selectStyle}>
        <option value="">Any time</option>
        <option value="1">Last 24 hours</option>
        <option value="7">Last week</option>
        <option value="30">Last month</option>
      </select>
      {hasFilters && (
        <button onClick={clearFilters} style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)', borderRadius: 6, padding: '.28rem .68rem', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer' }}>
          ✕ Clear
        </button>
      )}
    </div>
  )
}
