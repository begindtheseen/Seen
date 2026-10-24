'use client'

import { useEffect } from 'react'

// Marks the document while the 404 page is mounted (`<html data-not-found="1">`) so ambient UI that
// cannot see the route tree — the micro-survey host in the root layout — knows this is a dead end
// and stays quiet (user audit 2026-10-23: a "Quick question" card popped on the 404 page). The
// not-found page is a server component, so the one client effect lives here. Removed on unmount.
export default function NotFoundMarker() {
  useEffect(() => {
    document.documentElement.dataset.notFound = '1'
    return () => { delete document.documentElement.dataset.notFound }
  }, [])
  return null
}
