import type { MetadataRoute } from 'next'
import { SEED_COMPANIES, slugify as growthSlugify } from '@/lib/growth'

// Dynamic sitemap: static routes + every scored company page + the seeded growth surfaces
// (FAQ long-tail, compare, reddit). Refreshes hourly so newly scored companies get indexed.
// Pulls names server-side (service key, never shipped to client).
export const revalidate = 3600

const BASE = 'https://seenjobs.io'

async function getCompanyNames(): Promise<string[]> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return []
  try {
    const r = await fetch(
      `${url}/rest/v1/company_scores?select=company_name&order=report_count.desc&limit=10000`,
      // AbortSignal.timeout so build-time sitemap generation can never hang on a slow Supabase.
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) }
    )
    if (!r.ok) return []
    const rows = await r.json()
    return (Array.isArray(rows) ? rows : []).map((x: { company_name: string }) => x.company_name).filter(Boolean)
  } catch {
    return []
  }
}

const slugify = (name: string) => encodeURIComponent(name.toLowerCase().trim().replace(/\s+/g, '-'))

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/companies`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/jobs`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/feed`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE}/demand`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/resume`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/report`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/compare`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/reddit`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
  ]

  // Growth surfaces: long-tail FAQ pages for the seeded top companies. These are the high-intent
  // queries ("does <x> ghost applicants", "<x> hiring process"). Other companies render on-demand.
  const faqRoutes: MetadataRoute.Sitemap = SEED_COMPANIES.flatMap(name => {
    const c = growthSlugify(name)
    return [
      { url: `${BASE}/faq/does-${c}-ghost-applicants`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.7 },
      { url: `${BASE}/faq/${c}-hiring-process`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.7 },
    ]
  })

  const companies = await getCompanyNames()
  const companyRoutes: MetadataRoute.Sitemap = companies.map(name => ({
    url: `${BASE}/company/${slugify(name)}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  return [...staticRoutes, ...faqRoutes, ...companyRoutes]
}
