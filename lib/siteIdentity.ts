// Seen's own identity as schema.org data: the Organization node the homepage, /data (as the dataset's
// creator and publisher) and any other page can reference, so search engines and AI answer engines tie
// seenjobs.io to one publisher and, once they exist, to Seen's social profiles.
//
// `sameAs` comes from NEXT_PUBLIC_SAME_AS (comma-separated https URLs, e.g.
// "https://www.linkedin.com/company/seenjobs,https://x.com/seenjobs"). Empty by default: a profile is
// listed only after the owner creates it and sets the variable, never guessed.
//
// Pure (reads only the env value passed in); relative imports only.

export const SITE_URL = 'https://seenjobs.io'
export const SITE_ORG_ID = `${SITE_URL}/#organization`

/** The https profile URLs in a comma-separated list; anything that is not an absolute https URL is dropped. */
export function sameAsProfiles(raw: string | null | undefined = process.env.NEXT_PUBLIC_SAME_AS): string[] {
  const out: string[] = []
  for (const part of String(raw ?? '').split(',')) {
    const v = part.trim()
    if (!v) continue
    try {
      const u = new URL(v)
      if (u.protocol !== 'https:' || !u.hostname.includes('.')) continue
      const href = u.toString()
      if (!out.includes(href)) out.push(href)
    } catch {
      /* not a URL: skip */
    }
  }
  return out
}

export type OrganizationLd = {
  '@type': 'Organization'
  '@id': string
  name: string
  url: string
  logo: { '@type': 'ImageObject'; url: string }
  email: string
  description: string
  sameAs?: string[]
}

/** The Organization node (no @context: embed it in a @graph, or spread it into one with a @context). */
export function siteOrganization(raw?: string | null): OrganizationLd {
  const sameAs = sameAsProfiles(raw === undefined ? process.env.NEXT_PUBLIC_SAME_AS : raw)
  return {
    '@type': 'Organization',
    '@id': SITE_ORG_ID,
    name: 'Seen',
    url: SITE_URL,
    logo: { '@type': 'ImageObject', url: `${SITE_URL}/favicon.svg` },
    email: 'hello@seenjobs.io',
    description: 'Seen publishes how employers treat job applicants: who replies, who ghosts, and how long it takes, from applicant reports.',
    ...(sameAs.length ? { sameAs } : {}),
  }
}

/** A standalone JSON-LD document for the Organization (for a page that has no other graph). */
export function siteOrganizationJsonLd(raw?: string | null) {
  return { '@context': 'https://schema.org', ...siteOrganization(raw) }
}
