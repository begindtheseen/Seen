'use client'

// THE admin overlay (audit §3.2: one overlay level, ever). A bottom sheet on a phone, a side sheet on
// a desktop. It closes four ways — ✕ (a 44px target that never scrolls away), Esc, a tap on the
// backdrop, and Back — and returns focus to whatever opened it. The page behind is locked while it is
// open and unlocked on EVERY close path (unmount included), because ModalPortal ref-counts the lock in
// an effect cleanup.
//
// Back: a sheet whose open state is in the URL (an item, `?item=`) is closed by the URL place itself, so
// it passes `urlBacked`; any other sheet (search, More, jobs, sign-in) owns one history entry through
// usePanelEntry (core/place.ts), so the phone's Back closes it instead of leaving, and a close by ✕ /
// Esc / backdrop takes that entry back.
//
// The shell renders exactly one <Sheet> (SheetHost). Sections never render their own; they open an
// item (`useShell().openItem`) or put a ConfirmStep inside the item's sheet.
import { useEffect, useId, useRef, type ReactNode } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import { usePanelEntry } from '../core/place.ts'
import Icon from '@/components/ui/Icon'
import styles from './Sheet.module.css'

export type SheetProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** One line under the title. */
  description?: ReactNode
  /** The open state lives in the URL (Back is handled by the URL place, not by this sheet). */
  urlBacked?: boolean
  /** false = Esc / backdrop / Back do nothing (✕ still closes). Use only while a write is in flight. */
  dismissable?: boolean
  /** Sticky bottom row (actions). */
  footer?: ReactNode
  children?: ReactNode
  /** data-testid for the panel. */
  testId?: string
}

/** Esc handling, pure for the test. */
export function sheetKey(key: string, dismissable: boolean, onClose: () => void): boolean {
  if (key === 'Escape' && dismissable) { onClose(); return true }
  return false
}

export default function Sheet({ open, onClose, title, description, urlBacked, dismissable = true, footer, children, testId }: SheetProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useFocusTrap(panel, open)
  // Not URL-backed: this sheet owns one history entry, so Back closes it (core/place.ts).
  usePanelEntry(open && !urlBacked && dismissable, () => closeRef.current())

  useEffect(() => {
    if (!open) return
    // On window, so it runs after React's own handlers: a step inside the sheet (ConfirmStep) that
    // handles Esc calls preventDefault, and the sheet then leaves it alone.
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (sheetKey(e.key, dismissable, () => closeRef.current())) { e.stopPropagation(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismissable])

  if (!open) return null
  return (
    <ModalPortal>
      <div className={styles.scrim} onClick={() => { if (dismissable) closeRef.current() }} data-testid="sheet-scrim">
        <div
          ref={panel}
          className={styles.panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${uid}-t`}
          aria-describedby={description ? `${uid}-d` : undefined}
          tabIndex={-1}
          data-testid={testId || 'sheet'}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.head}>
            <div className={styles.titles}>
              <h2 id={`${uid}-t`} className={styles.title}>{title}</h2>
              {description ? <p id={`${uid}-d`} className={styles.desc}>{description}</p> : null}
            </div>
            <button type="button" className={styles.close} onClick={() => closeRef.current()} aria-label="Close" data-testid="sheet-close">
              <Icon name="x" size={20} />
            </button>
          </div>
          <div className={styles.body}>{children}</div>
          {footer ? <div className={styles.foot}>{footer}</div> : null}
        </div>
      </div>
    </ModalPortal>
  )
}
