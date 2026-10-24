import type { Metadata } from 'next'

// ONE builder for every route's <head> metadata (audit 2026-10-24: /companies, /jobs, /pricing, /faq,
// /legal and /employers/dashboard carried the homepage title + `canonical=https://seenjobs.io`, so they
// declared themselves duplicates of the homepage; /agencies, /terms, /privacy, /content-policy and
// /employers/verified rendered "… | Seen | Seen" because the page title already carried the suffix the
// root layout's `title.template` adds; /agencies, /employers, the legal pages and /contact had no
// og:image because an explicit `openGraph` object REPLACES the inherited one, dropping the file-based
// image).
//
// Rules this encodes so no route can drift again:
//   - `title` is the bare page name. The root layout's template appends " | Seen" exactly once; a
//     trailing "| Seen" in the input is stripped so a copy-paste never doubles it.
//   - `canonical` is always the route's OWN absolute URL (never the homepage).
//   - Every route gets the default OG asset (`app/opengraph-image.tsx`, served at /opengraph-image)
//     unless it passes its own `image`, plus matching twitter:card data.
//   - Private, signed-in surfaces pass `noindex: true` and are kept out of search results; everything
//     else inherits the root robots policy.

export const SITE_URL = 'https://seenjobs.io'
export const SITE_NAME = 'Seen'
export const DEFAULT_OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'Seen — know how a company treats applicants before you apply',
}

export type PageMeta = {
  /** Bare page name; " | Seen" is added once by the root layout template. */
  title: string
  description: string
  /** Route path starting with "/" (e.g. "/pricing"). Becomes the canonical + og:url. */
  path: string
  /** Share-card title, when it should differ from the <title>. */
  ogTitle?: string
  /** Share-card description, when it should differ from the meta description. */
  ogDescription?: string
  /** A route-specific image; defaults to the site-wide OG asset. */
  image?: { url: string; width?: number; height?: number; alt?: string }
  keywords?: string[]
  /** Signed-in / private surfaces: keep them out of search results. */
  noindex?: boolean
  /** og:type — 'website' unless the page is an article (company FAQ pages). */
  type?: 'website' | 'article'
}

/** Strip a trailing "| Seen" / "— Seen" so the layout template adds the suffix exactly once. */
export function bareTitle(title: string): string {
  return title.replace(/\s*[|\-–—]\s*Seen\s*$/i, '').trim()
}

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export function pageMetadata(meta: PageMeta): Metadata {
  const title = bareTitle(meta.title)
  const url = absoluteUrl(meta.path)
  const image = meta.image ?? DEFAULT_OG_IMAGE
  const ogTitle = meta.ogTitle ?? `${title} | ${SITE_NAME}`
  const ogDescription = meta.ogDescription ?? meta.description
  const out: Metadata = {
    title,
    description: meta.description,
    alternates: { canonical: url },
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url,
      type: meta.type ?? 'website',
      siteName: SITE_NAME,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDescription,
      images: [image.url],
    },
  }
  if (meta.keywords?.length) out.keywords = meta.keywords
  if (meta.noindex) out.robots = { index: false, follow: false, googleBot: { index: false, follow: false } }
  return out
}
