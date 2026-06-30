import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/reset', '/profile'] },
    ],
    sitemap: 'https://seenjobs.io/sitemap.xml',
    host: 'https://seenjobs.io',
  }
}
