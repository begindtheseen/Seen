'use client'

// What any part of the admin can ask the shell to do. Sections reach it with useShell().
import { createContext, useContext, type ReactNode } from 'react'
import type { AdminItemKind } from '../contract.ts'
import type { ShellSection } from './url.ts'

export type PanelSpec =
  | { kind: 'search' }
  | { kind: 'more' }
  | { kind: 'jobs'; focus?: string }
  /** A one-off sheet that is not an item (a form). Prefer an item or an inline ConfirmStep. */
  | { kind: 'custom'; title: string; description?: string; render: (close: () => void) => ReactNode }

export type ShellApi = {
  section: ShellSection
  /** Switch section; with `filter`, open it with exactly those filters (a Today queue row). */
  goSection: (section: ShellSection, filter?: Record<string, string>) => void
  /** Open an item's sheet (pushed: Back closes it). From inside a sheet it replaces the content. */
  openItem: (kind: AdminItemKind, id: string) => void
  closeItem: () => void
  openPanel: (panel: PanelSpec) => void
  closePanel: () => void
  /** Is any sheet open (sections skip their keyboard shortcuts then). */
  sheetOpen: boolean
  username: string
  signOut: () => void
}

export const ShellContext = createContext<ShellApi | null>(null)

export function useShell(): ShellApi {
  const v = useContext(ShellContext)
  if (!v) throw new Error('useShell: render inside the admin shell')
  return v
}
