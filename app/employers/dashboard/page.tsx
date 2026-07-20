import { Suspense } from 'react'
import { EmployerHub } from '@/components/employer/EmployerHub'

// The employer hub — one unified, tabbed surface (Overview · Listings · Analytics · Updates) with a
// shared header + reputation hero, replacing the old four disconnected long-scroll pages. The hub is
// a client component (it reads useSearchParams for scoping + the ?tab= state), so it's wrapped in a
// Suspense boundary here per Next's requirement.

export default function EmployerDashboardPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>}>
      <EmployerHub />
    </Suspense>
  )
}
