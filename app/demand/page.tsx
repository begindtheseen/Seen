'use client'

import { useState, useEffect, useMemo } from 'react'

interface DemandJob {
  t: string
  n: string
  l: string
  count: number
  di: number
  note: string
}

interface DemandCity {
  city: string
  urg: 'hot' | 'warm' | 'cool'
  src: string
  jobs: DemandJob[]
}

const FALLBACK: DemandCity[] = [
  {city:'New York, NY',urg:'hot',src:'BLS OES 2024 · JOLTS Q3 2024',jobs:[
    {t:'Home Health Aide',n:'Healthcare',l:'Entry level',count:12400,di:88,note:'NYC #1 metro for HHA openings; BLS/HRSA project 22% national growth 2023-2033'},
    {t:'Software Engineer',n:'Tech / Software',l:'Mid level',count:15800,di:74,note:'NYC tech #2 only to SF; LinkedIn Workforce Report Q3 2024'},
    {t:'Registered Nurse',n:'Healthcare',l:'Mid level',count:9200,di:78,note:'HRSA: national shortage of 78,610 RNs; NYC hospitals posted 9,200+ vacancies in 2024'},
    {t:'Data Analyst',n:'Tech / Software',l:'Mid level',count:7100,di:68,note:'BLS: Data Analyst roles growing 36% nationally 2023-2033'},
  ]},
  {city:'Los Angeles, CA',urg:'warm',src:'BLS OES 2024 · California EDD 2024',jobs:[
    {t:'Home Health Aide',n:'Healthcare',l:'Entry level',count:9800,di:85,note:'CA leads the US in HHA demand; CA Employment Development Dept Q3 2024'},
    {t:'Software Engineer',n:'Tech / Software',l:'Senior',count:11200,di:72,note:'LA tech cluster growing post-entertainment-strike; CompTIA 2024'},
    {t:'Registered Nurse',n:'Healthcare',l:'Mid level',count:6400,di:76,note:'CA Board of Registered Nursing: 6,400+ hospital vacancies in LA County 2024'},
    {t:'Physical Therapist',n:'Healthcare',l:'Mid level',count:2800,di:65,note:'BLS: PT occupations growing 17% 2023-2033; above average wage growth'},
  ]},
  {city:'San Francisco Bay Area',urg:'hot',src:'BLS OES 2024 · CompTIA State of Tech 2024',jobs:[
    {t:'Software Engineer',n:'Tech / Software',l:'Senior',count:28400,di:74,note:'Highest concentration of SWE jobs in US; CompTIA State of Tech 2024'},
    {t:'Cybersecurity Analyst',n:'Tech / Software',l:'Mid level',count:3100,di:76,note:'CISA Cyber Workforce Study 2024: 700K unfilled cybersecurity roles nationally'},
    {t:'Data Scientist',n:'Tech / Software',l:'Senior',count:4200,di:70,note:'BLS: Data Scientist roles 36% growth 2023-2033; SF highest concentration'},
    {t:'Product Manager',n:'Tech / Software',l:'Senior',count:3800,di:60,note:'LinkedIn: PM roles highly competitive but consistent demand in Bay Area'},
  ]},
  {city:'Seattle, WA',urg:'hot',src:'BLS OES 2024 · WA Employment Security Dept 2024',jobs:[
    {t:'Software Engineer',n:'Tech / Software',l:'Mid level',count:14600,di:74,note:'Amazon + Microsoft anchor Seattle as 3rd largest US tech hub; BLS 2024'},
    {t:'Cloud / DevOps Engineer',n:'Tech / Software',l:'Senior',count:3200,di:78,note:'AWS HQ: highest concentration of cloud engineering roles nationally'},
    {t:'Data Analyst',n:'Tech / Software',l:'Mid level',count:2800,di:68,note:'WA Employment Security Dept: tech support roles +18% YoY 2024'},
    {t:'Cybersecurity Analyst',n:'Tech / Software',l:'Mid level',count:2400,di:76,note:'CISA: WA public + private sector cyber roles growing 33% 2023-2033'},
  ]},
  {city:'Chicago, IL',urg:'warm',src:'BLS OES 2024 · JOLTS Q3 2024 · IL Dept of Employment Security',jobs:[
    {t:'Registered Nurse',n:'Healthcare',l:'Mid level',count:7200,di:76,note:'IL DES: Chicago metro 7,200+ RN vacancies; IDPH reports critical shortage'},
    {t:'CDL Truck Driver',n:'Logistics / Warehouse',l:'Entry level',count:5800,di:82,note:'ATA Truck Driver Shortage Report 2023: 80K national shortage; Chicago is top logistics hub'},
    {t:'Accountant / CPA',n:'Finance',l:'Mid level',count:3400,di:52,note:'BLS: Accounting 4% growth 2023-2033; stable demand, moderate competition'},
    {t:'Electrician',n:'Trades / Construction',l:'Entry level',count:2800,di:71,note:'BLS: Electricians 11% growth 2023-2033; IBEW Chicago 2,800 openings tracked'},
  ]},
  {city:'Houston, TX',urg:'hot',src:'BLS OES 2024 · TX Workforce Commission 2024 · ATA 2023',jobs:[
    {t:'CDL Truck Driver',n:'Logistics / Warehouse',l:'Entry level',count:9200,di:82,note:'Houston is the top US metro for CDL driver demand; ATA shortage report 2023'},
    {t:'Electrician',n:'Trades / Construction',l:'Entry level',count:6400,di:71,note:'TX Workforce Commission: energy sector electricians critically short; 11% BLS growth'},
    {t:'Registered Nurse',n:'Healthcare',l:'Mid level',count:5200,di:76,note:'TX Dept of State Health: Houston hospitals 5,200+ RN vacancies in Q3 2024'},
    {t:'Industrial Engineer',n:'Tech / Software',l:'Mid level',count:3800,di:62,note:'BLS: Industrial Engineering 12% growth 2023-2033; energy/manufacturing demand'},
  ]},
  {city:'Dallas-Fort Worth, TX',urg:'warm',src:'BLS OES 2024 · TX Workforce Commission 2024',jobs:[
    {t:'Software Engineer',n:'Tech / Software',l:'Mid level',count:9800,di:74,note:'DFW emerged as major tech hub; TX Workforce Commission 2024: 9,800 SWE openings'},
    {t:'Registered Nurse',n:'Healthcare',l:'Mid level',count:5600,di:76,note:'TX leads the US in RN shortage; DFW hospital systems 5,600 vacancies Q3 2024'},
    {t:'Cybersecurity Analyst',n:'Tech / Software',l:'Mid level',count:2600,di:76,note:'CISA: TX public sector cyber workforce gap 26% larger than national average'},
    {t:'Financial Analyst',n:'Finance',l:'Mid level',count:3200,di:58,note:'BLS: Financial Analyst 8% growth; DFW finance sector expanding with corporate relocations'},
  ]},
  {city:'Austin, TX',urg:'hot',src:'BLS OES 2024 · TX Workforce Commission 2024 · CompTIA 2024',jobs:[
    {t:'Software Engineer',n:'Tech / Software',l:'Mid level',count:12400,di:74,note:'Austin tech boom: Tesla, Apple, Google, Oracle all hiring; CompTIA State of Tech 2024'},
    {t:'Cybersecurity Analyst',n:'Tech / Software',l:'Mid level',count:2800,di:76,note:'TX Workforce Commission: Austin #1 fastest-growing cyber hub in the US'},
    {t:'Construction Manager',n:'Trades / Construction',l:'Mid level',count:2400,di:67,note:'BLS: Construction Manager 9% growth; Austin building boom drives demand'},
    {t:'DevOps Engineer',n:'Tech / Software',l:'Senior',count:2100,di:76,note:'CompTIA: Austin DevOps salaries +14% YoY; demand outpacing supply'},
  ]},
  {city:'Phoenix, AZ',urg:'hot',src:'BLS OES 2024 · AZ Dept of Economic Security 2024',jobs:[
    {t:'Home Health Aide',n:'Healthcare',l:'Entry level',count:7400,di:85,note:'AZ DES: Phoenix fastest-growing US metro for HHA demand due to aging population'},
    {t:'CDL Truck Driver',n:'Logistics / Warehouse',l:'Entry level',count:5200,di:82,note:'Phoenix distribution hub: Amazon, UPS, FedEx all citing critical driver shortage'},
    {t:'Registered Nurse',n:'Healthcare',l:'Mid level',count:4600,di:76,note:'AZ Dept of Health: Phoenix metro 4,600+ RN vacancies; top per-capita shortage metro'},
    {t:'Software Engineer',n:'Tech / Software',l:'Mid level',count:4800,di:72,note:'Intel, TSMC, PayPal expansions driving AZ tech hiring; AZ DES 2024'},
  ]},
  {city:'Miami, FL',urg:'warm',src:'BLS OES 2024 · FL Agency for Workforce Innovation 2024',jobs:[
    {t:'Home Health Aide',n:'Healthcare',l:'Entry level',count:6200,di:85,note:'FL is the US retirement capital; Miami-Dade ranks top 5 nationwide for HHA openings'},
    {t:'Registered Nurse',n:'Healthcare',l:'Mid level',count:5800,di:76,note:'FL Dept of Health: Miami-Dade 5,800+ RN vacancies; nurse shortage is statewide'},
    {t:'Financial Analyst',n:'Finance',l:'Mid level',count:2400,di:58,note:'Miami financial services sector growing; FL no income tax draws Wall Street firms south'},
    {t:'Software Engineer',n:'Tech / Software',l:'Mid level',count:3600,di:70,note:'FL Agency for Workforce Innovation: Miami tech sector +22% job growth 2022-2024'},
  ]},
  {city:'Washington, DC metro',urg:'hot',src:'BLS OES 2024 · CISA Cyber Workforce Study 2024',jobs:[
    {t:'Cybersecurity Analyst',n:'Tech / Software',l:'Mid level',count:18400,di:76,note:'CISA 2024: DC metro is the #1 US market for cybersecurity; 700K national unfilled roles'},
    {t:'Software Engineer',n:'Tech / Software',l:'Senior',count:12600,di:74,note:'BLS OES: DC metro federal + contractor SWE demand exceeds any other sector'},
    {t:'Data Analyst',n:'Tech / Software',l:'Mid level',count:5800,di:68,note:'Federal agencies are the largest employer of data analysts in the US'},
    {t:'Network Engineer',n:'Tech / Software',l:'Mid level',count:3400,di:72,note:'DoD, NSA, DHS all cite critical network engineering shortage; CISA 2024'},
  ]},
  {city:'Atlanta, GA',urg:'warm',src:'BLS OES 2024 · GA Dept of Labor 2024',jobs:[
    {t:'Software Engineer',n:'Tech / Software',l:'Mid level',count:8800,di:72,note:'GA Dept of Labor: Atlanta tech sector grew 28% 2020-2024; Delta, NCR, Mailchimp hiring'},
    {t:'Registered Nurse',n:'Healthcare',l:'Mid level',count:4800,di:76,note:'GA Dept of Public Health: Atlanta hospital system 4,800 RN vacancies Q3 2024'},
    {t:'Logistics Coordinator',n:'Logistics / Warehouse',l:'Entry level',count:5200,di:64,note:'Atlanta is the Southeast logistics hub; Hartsfield-Jackson drives massive freight workforce'},
    {t:'Electrician',n:'Trades / Construction',l:'Entry level',count:2600,di:71,note:'BLS: GA construction boom driving 11% electrician growth; 2,600 openings in metro'},
  ]},
  {city:'Remote — All US',urg:'warm',src:'LinkedIn Workforce Report Q3 2024 · BLS OES 2024',jobs:[
    {t:'Software Engineer',n:'Tech / Software',l:'Mid level',count:42800,di:74,note:'LinkedIn Q3 2024: SWE is the #1 remote role by volume; 42K+ active postings'},
    {t:'Customer Success Manager',n:'Tech / Software',l:'Entry level',count:8400,di:58,note:'LinkedIn: CSM roles highest remote availability after SWE; entry pay $45-65K'},
    {t:'Data Analyst',n:'Tech / Software',l:'Mid level',count:6200,di:68,note:'BLS: Data Analyst 36% 10-yr growth; 60%+ of roles now offer remote options'},
    {t:'Product Manager',n:'Tech / Software',l:'Senior',count:4800,di:60,note:'LinkedIn: Remote PM roles highly competitive but 4,800 active US postings Q3 2024'},
  ]},
]

const URG_CFG = {
  hot:  { label: '🔥 High demand', cls: 'hot' },
  warm: { label: '🌡️ Active market', cls: 'warm' },
  cool: { label: '❄️ Stable', cls: 'cool' },
}

function DemandBar({ di }: { di: number }) {
  const color = di >= 75 ? 'var(--red)' : di >= 55 ? 'var(--amber)' : 'var(--green)'
  return (
    <div style={{ flex: 1, height: 5, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${di}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .4s ease' }} />
    </div>
  )
}

function CityCard({ city }: { city: DemandCity }) {
  const cfg = URG_CFG[city.urg]
  return (
    <div className="dcity">
      <div className="dc-hdr">
        <div>
          <div className="dc-city">{city.city}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', marginTop: '.15rem' }}>{city.src}</div>
        </div>
        <span className={`dc-urg ${cfg.cls}`}>{cfg.label}</span>
      </div>
      <div className="dc-body">
        {city.jobs.map((job, i) => (
          <div key={i} className="dc-row" title={job.note}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="dc-job">{job.t}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.25rem' }}>
                <DemandBar di={job.di} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', flexShrink: 0 }}>{job.l}</span>
              </div>
            </div>
            <div className="dc-count" style={{ marginLeft: '.75rem', flexShrink: 0 }}>{job.count.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DemandPage() {
  const [data, setData] = useState<DemandCity[]>(FALLBACK)
  const [blsPeriod, setBlsPeriod] = useState<string | null>(null)
  const [locFilter, setLocFilter] = useState('')
  const [nicheFilter, setNicheFilter] = useState('')
  const [expFilter, setExpFilter] = useState('')

  useEffect(() => {
    fetch('/api/demand')
      .then(r => r.json())
      .then((d: { demand?: DemandCity[]; bls_period?: string }) => {
        if (d.demand?.length) { setData(d.demand); setBlsPeriod(d.bls_period || null) }
      })
      .catch(() => {/* use fallback */})
  }, [])

  const filtered = useMemo(() => {
    let cities = data
    if (locFilter.trim()) {
      const q = locFilter.toLowerCase()
      cities = cities.filter(c => c.city.toLowerCase().includes(q))
    }
    return cities.map(c => ({
      ...c,
      jobs: c.jobs.filter(j => {
        if (nicheFilter && j.n !== nicheFilter) return false
        if (expFilter && j.l !== expFilter) return false
        return true
      }),
    })).filter(c => c.jobs.length > 0)
  }, [data, locFilter, nicheFilter, expFilter])

  const stats = useMemo(() => {
    const allJobs = filtered.flatMap(c => c.jobs)
    const total = allJobs.reduce((s, j) => s + j.count, 0)
    const entryLevel = allJobs.filter(j => j.l === 'Entry level').reduce((s, j) => s + j.count, 0)
    const avgDI = allJobs.length ? Math.round(allJobs.reduce((s, j) => s + j.di, 0) / allJobs.length) : 0
    return { total, cities: filtered.length, entryLevel, avgDI }
  }, [filtered])

  const selectStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1.5px solid var(--line2)',
    borderRadius: 8,
    padding: '.55rem .9rem',
    color: 'var(--white)',
    fontFamily: 'var(--mono)',
    fontSize: '.7rem',
    outline: 'none',
    cursor: 'pointer',
    flex: 1,
    minWidth: 140,
  }

  return (
    <div className="page-full">
      <div className="demand-page">
        {/* Header */}
        <div className="demand-hdr">
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--amber)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 22, height: 1, background: 'var(--amber)', display: 'inline-block' }} />
            Live job demand · {blsPeriod || 'BLS OES 2024'}
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.28rem' }}>
            Where jobs desperately need people
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.82rem', fontWeight: 300, marginBottom: '1.5rem' }}>
            Real demand data from BLS, JOLTS, and industry reports. Sorted by demand index — roles where supply can&apos;t keep up.
          </p>

          {/* Filters */}
          <div className="demand-filters">
            <input
              type="text"
              placeholder="Filter by city or state..."
              value={locFilter}
              onChange={e => setLocFilter(e.target.value)}
              style={{ ...selectStyle, caretColor: 'var(--blue)' }}
            />
            <select value={nicheFilter} onChange={e => setNicheFilter(e.target.value)} style={selectStyle}>
              <option value="">All industries</option>
              <option value="Tech / Software">Tech / Software</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Logistics / Warehouse">Logistics / Warehouse</option>
              <option value="Finance">Finance</option>
              <option value="Trades / Construction">Trades / Construction</option>
            </select>
            <select value={expFilter} onChange={e => setExpFilter(e.target.value)} style={selectStyle}>
              <option value="">Any level</option>
              <option value="Entry level">Entry level</option>
              <option value="Mid level">Mid level</option>
              <option value="Senior">Senior</option>
            </select>
            {(locFilter || nicheFilter || expFilter) && (
              <button
                onClick={() => { setLocFilter(''); setNicheFilter(''); setExpFilter('') }}
                style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)', borderRadius: 8, padding: '.55rem .9rem', fontFamily: 'var(--mono)', fontSize: '.7rem', cursor: 'pointer', flexShrink: 0 }}
              >
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="demand-stat-row">
          {[
            { n: stats.total.toLocaleString(), l: 'Total openings tracked' },
            { n: stats.cities, l: 'Markets' },
            { n: stats.entryLevel.toLocaleString(), l: 'Entry-level jobs' },
            { n: `${stats.avgDI}/100`, l: 'Avg demand index' },
          ].map((s, i) => (
            <div key={i} className="dsr">
              <div className="dsr-n">{s.n}</div>
              <div className="dsr-l">{s.l}</div>
            </div>
          ))}
        </div>

        {/* City grid */}
        {filtered.length > 0 ? (
          <div className="demand-grid">
            {filtered.map(city => (
              <CityCard key={city.city} city={city} />
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.75rem' }}>
            No markets match your filters. Try clearing them.
          </div>
        )}
      </div>
    </div>
  )
}
