'use client'

// THE dialog. Every overlay that asks something of the user goes through here (audit 2026-10-25:
// UpgradeModal, SurveyModal, CardShareModal, ResumeSurveyModal and CoPreviewModal had no role=dialog,
// no aria-modal and no focus trap; 15+ hand-rolled modals).
//
// Contract (pinned by components/ui/ui.test.mjs):
//   · role="dialog" + aria-modal="true", named by its title (aria-labelledby) and described by its
//     description (aria-describedby) when one is given;
//   · focus moves inside on open, Tab cycles inside, focus returns to the opener on close
//     (lib/hooks/useFocusTrap);
//   · Escape closes; a click on the scrim closes unless `dismissable={false}`;
//   · a SOLID surface (#0e111c, --surface-overlay) — never translucent glass over content;
//   · rendered at <body> with the page scroll locked (components/ModalPortal).
import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import Icon from './Icon'

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Buttons row at the bottom (right-aligned; full-width on phones). */
  footer?: ReactNode
  /** false = Escape and scrim clicks do nothing (use for a step that must be answered). */
  dismissable?: boolean
  /** Hide the visible title (still names the dialog). */
  hideTitle?: boolean
  className?: string
  children?: ReactNode
}

/** The attributes the panel carries — pure so the a11y contract is unit-tested. */
export function dialogA11y(ids: { titleId: string; descId?: string }) {
  return {
    role: 'dialog' as const,
    'aria-modal': true as const,
    'aria-labelledby': ids.titleId,
    ...(ids.descId ? { 'aria-describedby': ids.descId } : {}),
    tabIndex: -1,
  }
}

/** Escape closes (when dismissable). Returns true when it handled the key. Pure for the test. */
export function dialogKey(key: string, dismissable: boolean, onClose: () => void): boolean {
  if (key === 'Escape' && dismissable) { onClose(); return true }
  return false
}

type SurfaceProps = Omit<DialogProps, 'open'> & { titleId: string; descId?: string; panelRef?: Ref<HTMLDivElement> }

/** The panel without the portal/effects — what the server would render; used by the test. */
export function DialogSurface({ title, description, size = 'md', footer, hideTitle, className, children, onClose, titleId, descId, panelRef }: SurfaceProps) {
  const cls = ['ui-dialog', size !== 'md' ? `ui-dialog--${size}` : '', className || ''].filter(Boolean).join(' ')
  return (
    <div ref={panelRef} className={cls} {...dialogA11y({ titleId, descId: description ? descId : undefined })} onClick={(e) => e.stopPropagation()}>
      <div className="ui-dialog__head">
        <div className="ui-dialog__titles">
          <h2 id={titleId} className={hideTitle ? 'sr-only' : 'ui-dialog__title'}>{title}</h2>
          {description ? <p id={descId} className="ui-dialog__desc">{description}</p> : null}
        </div>
        <button type="button" className="ui-dialog__close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={20} />
        </button>
      </div>
      {children}
      {footer ? <div className="ui-dialog__foot">{footer}</div> : null}
    </div>
  )
}

export default function Dialog({ open, onClose, dismissable = true, ...rest }: DialogProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const titleId = `dlg${uid}-t`
  const descId = `dlg${uid}-d`
  const panel = useRef<HTMLDivElement>(null)
  useFocusTrap(panel, open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (dialogKey(e.key, dismissable, onClose)) e.stopPropagation() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, dismissable, onClose])

  if (!open) return null
  return (
    <ModalPortal>
      <div className="ui-dialog__scrim" onClick={() => { if (dismissable) onClose() }}>
        <DialogSurface {...rest} onClose={onClose} titleId={titleId} descId={descId} panelRef={panel} />
      </div>
    </ModalPortal>
  )
}
