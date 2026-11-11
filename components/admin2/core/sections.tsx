'use client'

// The section registry: the ONE place a section is plugged into the shell. To build a section, replace
// its `load` line with your module (default export = the section component) — see README.md.
// Each section is loaded on first visit and then KEPT MOUNTED (hidden) when the owner leaves, so its
// filters, selection, scroll and half-typed fields survive a round trip.
import type { ComponentType } from 'react'
import type { IconName } from '@/components/ui/Icon'
import type { ShellSection } from './url.ts'

export type SectionProps = {
  /** This section is the one on screen (keyboard shortcuts and focus refetch only when true). */
  active: boolean
}

export type SectionDef = {
  key: ShellSection
  label: string
  icon: IconName
  /** Desktop key (1–6). */
  hotkey?: string
  /** Phone: in the bottom bar, or under More. */
  phone: 'bar' | 'more'
  /** The section module (default export). Loaded on first visit; a failed load can be retried. */
  load: () => Promise<{ default: ComponentType<SectionProps> }>
}

export const SECTIONS: SectionDef[] = [
  { key: 'today', label: 'Today', icon: 'layout-dashboard', hotkey: '1', phone: 'bar', load: () => import('../sections/today/TodaySection.tsx') },
  { key: 'review', label: 'Review', icon: 'inbox', hotkey: '2', phone: 'bar', load: () => import('../sections/review/ReviewSection.tsx') },
  { key: 'listings', label: 'Listings', icon: 'briefcase', hotkey: '3', phone: 'bar', load: () => import('../sections/listings/ListingsSection.tsx') },
  { key: 'companies', label: 'Companies', icon: 'building-2', hotkey: '4', phone: 'more', load: () => import('../sections/companies/CompaniesSection.tsx') },
  { key: 'people', label: 'People', icon: 'users', hotkey: '5', phone: 'bar', load: () => import('../sections/people/PeopleSection.tsx') },
  { key: 'system', label: 'System', icon: 'gauge', hotkey: '6', phone: 'more', load: () => import('../sections/system/SystemSection.tsx') },
]

// The core's lab: a section that exercises every primitive and the whole action/job pipeline against a
// fixture server. Compiled in ONLY when the build sets NEXT_PUBLIC_ADMIN_LAB=1 (never in production).
if (process.env.NEXT_PUBLIC_ADMIN_LAB === '1') {
  SECTIONS.push({ key: 'lab', label: 'Lab', icon: 'sliders-horizontal', phone: 'more', load: () => import('./devlab/LabSection.tsx') })
}

export const SECTION_KEYS: string[] = SECTIONS.map((s) => s.key)
export const sectionDef = (key: string) => SECTIONS.find((s) => s.key === key) || SECTIONS[0]
