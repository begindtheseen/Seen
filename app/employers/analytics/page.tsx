import { redirect } from 'next/navigation'

// The standalone analytics page is now the Analytics TAB of the unified employer hub. This route
// still exists because the marketing /employers tools grid links to it — it redirects into the hub's
// analytics tab, preserving ?company= and ?godview= so scoping/god-view survive the hop.

export const dynamic = 'force-dynamic'

export default async function EmployerAnalyticsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ company?: string | string[]; godview?: string | string[] }>
}) {
  const sp = await searchParams
  const company = (Array.isArray(sp.company) ? sp.company[0] : sp.company) || ''
  const godview = (Array.isArray(sp.godview) ? sp.godview[0] : sp.godview) || ''

  const usp = new URLSearchParams()
  usp.set('tab', 'analytics')
  if (company) usp.set('company', company)
  if (godview) usp.set('godview', godview)
  redirect(`/employers/dashboard?${usp.toString()}`)
}
