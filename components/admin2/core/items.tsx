'use client'

// The item registry: what `?item=<kind>:<id>` opens. To give a kind its sheet, add one line mapping it
// to your module (default export = the item view) — see README.md. A kind with no view, an unknown
// kind, and an id the server does not know all show a plain "not found" state in the sheet.
import type { ComponentType } from 'react'
import type { AdminItemKind } from '../contract.ts'

export type ItemViewProps = {
  kind: AdminItemKind
  id: string
  /** Close the sheet (the whole stack). */
  close: () => void
  /** Open another item IN this sheet; Back returns here. */
  open: (kind: AdminItemKind, id: string) => void
  /** Set the sheet's title once the item is read ("Report from Walmart"). */
  setTitle: (title: string, description?: string) => void
}

export const ITEM_LABEL: Record<AdminItemKind, string> = {
  report: 'Report', job: 'Listing', company: 'Company', user: 'Account', ticket: 'Listing ticket', dispute: 'Reddit dispute',
  claim: 'Employer claim', reply: 'Employer reply', purchase: 'Employer purchase', issue: 'Data issue', cluster: 'Account cluster',
}

/** kind → its view module (default export). Loaded when first opened; a failed load can be retried. */
export const ITEM_VIEWS: Partial<Record<AdminItemKind, () => Promise<{ default: ComponentType<ItemViewProps> }>>> = {}

if (process.env.NEXT_PUBLIC_ADMIN_LAB === '1') {
  ITEM_VIEWS.report ??= () => import('./devlab/LabItem.tsx')
}
