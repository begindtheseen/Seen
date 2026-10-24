import type { MetadataRoute } from 'next'
import { fetchSitemapCompanies } from '@/lib/server/sitemapCompanies.js'

// Dynamic sitemap: static routes + every GRADED company page. Refreshes hourly so newly graded
// companies get indexed. Pulls names server-side (service key, never shipped to client).
//
// Search plan 2026-10-24 — what is deliberately NOT here, because each answers noindex or points its
// canonical elsewhere, and a sitemap URL like that is a Search Console error:
//   - company pages with no grade (noindex, app/company/[slug]/layout.tsx);
//   - /faq/does-<x>-ghost-applicants and /faq/<x>-hiring-process (canonical = the company page, or
//     noindex when ungraded; app/faq/[slug]/page.tsx);
//   - job listings /jobs/[id] (noindex for now, app/jobs/[id]/layout.tsx).
export const revalidate = 3600

const BASE = 'https://seenjobs.io'

// Every graded company, read past PostgREST's 1,000-row cap (lib/server/sitemapCompanies.js).
async function getCompanies(): Promise<Array<{ name: string; lastModified: string | null }>> {
  return fetchSitemapCompanies({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY })
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
    { url: `${BASE}/resume/studio`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/report`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/compare`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/reddit`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/agencies`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/ghosted`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/methods`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
  ]

  const companies = await getCompanies()
  const companyRoutes: MetadataRoute.Sitemap = companies.map(({ name, lastModified }) => ({
    url: `${BASE}/company/${slugify(name)}`,
    lastModified: lastModified ? new Date(lastModified) : now,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  return [...staticRoutes, ...companyRoutes]
}
