import type { MetadataRoute } from 'next'

// Allow everyone — including AI answer-engine crawlers (GPTBot, ClaudeBot, PerplexityBot,
// Google-Extended, etc.) — so Seen's company facts can be cited by ChatGPT/Perplexity/Gemini.
// We WANT to be in their answers, so these are explicitly allowed, not blocked.
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider', 'Amazonbot', 'cohere-ai']

export default function robots(): MetadataRoute.Robots {
  const disallow = ['/admin', '/api/', '/reset', '/profile']
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow },
      ...AI_BOTS.map(bot => ({ userAgent: bot, allow: '/', disallow })),
    ],
    sitemap: 'https://seenjobs.io/sitemap.xml',
    host: 'https://seenjobs.io',
  }
}
