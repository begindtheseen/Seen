'use client'

// THE place field (owner 2026-11-12: "Location needs an auto filler … a fixed format that actually works"). Every place
// box on the site uses it and ends up holding ONE format: "City, ST" ("Boise, ID"), a whole state ("Texas"), or
// "Remote". Suggestions come from GET /api/places (lib/geo/placeSuggest.js — the same place reader the job search
// uses); nothing about places ships to the browser.
//
//   <LocationInput id="where" value={loc} onChange={setLoc} onCommit={(v, how) => { if (how === 'enter') search(v) }} />
//
// Behaviour (ARIA 1.2 combobox + listbox):
//   - typing shows up to 8 suggestions (after 2 letters or 3 digits); a cached answer shows at once, a new one after
//     a 120 ms pause, and an older request is cancelled when a newer one starts;
//   - ↑/↓ move, Enter picks the highlighted one (`how: 'select'`), Escape closes; a tap or click picks (`'pick'`);
//   - Enter with nothing highlighted, or leaving the box after typing, asks once what the text means and writes the
//     fixed form ("boise id" → "Boise, ID"); text that cannot be placed stays as typed (spacing / commas tidied only),
//     and a slow answer never holds the person up (lib/geo/placesClient.ts resolvePlaceText);
//   - the list floats over the page (no layout shift); rows are 44px; it never opens on its own when a page fills the
//     box (a saved city, GPS), so a form loaded with a value stays clean.
import { forwardRef, useCallback, useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react'
import Icon, { type IconName } from './Icon'
import { cachedPlaces, fetchPlaces, resolvePlaceText, type PlaceAnswer, type PlaceSuggestion } from '@/lib/geo/placesClient'
import { normalizeLocationText, placeKey } from '@/lib/geo/placeFormat.js'
import s from './LocationInput.module.css'

export type LocationCommit = 'select' | 'pick' | 'enter' | 'blur'

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'role' | 'autoComplete' | 'list'>
export type LocationInputProps = Native & {
  id: string
  value: string
  /** Every change: each keystroke, a picked suggestion, and the fixed form written on Enter / leaving the box. */
  onChange: (value: string) => void
  /** The field settled on a value: a suggestion was chosen, Enter was pressed, or the box was left after typing. */
  onCommit?: (value: string, how: LocationCommit) => void
  /** Offer "Remote" (default true). Off where remote has its own control (job alerts). */
  allowRemote?: boolean
  /** Offer whole states (default true). */
  allowState?: boolean
  /** Class for the wrapper (the input keeps `className`). */
  wrapClassName?: string
}

const DEBOUNCE_MS = 120
const ICON: Record<PlaceSuggestion['kind'], IconName> = { place: 'map-pin', zip: 'map-pin', state: 'map', remote: 'globe' }
const DETAIL: Partial<Record<PlaceSuggestion['kind'], string>> = { state: 'Whole state', remote: 'Anywhere in the US' }

/** Long enough to ask: 2+ letters, or 3+ digits (a ZIP being typed). */
export function worthAsking(text: string): boolean {
  const k = placeKey(text)
  return /^\d/.test(k) ? /^\d{3,}/.test(k) : k.replace(/[^a-z]/g, '').length >= 2
}

const LocationInput = forwardRef<HTMLInputElement, LocationInputProps>(function LocationInput(
  { id, value, onChange, onCommit, allowRemote = true, allowState = true, wrapClassName, className, onKeyDown, onBlur, onFocus, ...rest },
  ref,
) {
  const listId = `${useId().replace(/:/g, '')}-places`
  const [items, setItems] = useState<PlaceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const valueRef = useRef(value)
  valueRef.current = value
  const typed = useRef(false) // the person typed since the field last settled
  const focused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ctrl = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    ctrl.current?.abort()
    ctrl.current = null
  }, [])
  useEffect(() => cancel, [cancel])

  const show = useCallback((a: PlaceAnswer, text: string) => {
    const list = a.suggestions.filter(x => (allowRemote || x.kind !== 'remote') && (allowState || x.kind !== 'state'))
    setItems(list)
    setActive(-1)
    // Nothing to offer when the one suggestion is exactly what is in the box.
    const same = list.length === 1 && list[0].label === text.trim()
    setOpen(focused.current && list.length > 0 && !same)
  }, [allowRemote, allowState])

  const ask = useCallback((text: string) => {
    cancel()
    if (!worthAsking(text)) { setItems([]); setOpen(false); setActive(-1); return }
    const hit = cachedPlaces(text)
    if (hit) { show(hit, text); return }
    timer.current = setTimeout(async () => {
      timer.current = null
      const c = new AbortController()
      ctrl.current = c
      const a = await fetchPlaces(text, c.signal)
      if (c.signal.aborted || valueRef.current !== text) return
      if (a) show(a, text)
    }, DEBOUNCE_MS)
  }, [cancel, show])

  const close = useCallback(() => { setOpen(false); setActive(-1) }, [])

  const choose = useCallback((sug: PlaceSuggestion, how: LocationCommit) => {
    cancel()
    typed.current = false
    close()
    if (sug.label !== valueRef.current) onChange(sug.label)
    valueRef.current = sug.label
    onCommit?.(sug.label, how)
  }, [cancel, close, onChange, onCommit])

  // Enter with nothing highlighted / leaving the box: write the fixed form, or keep the text (tidied) when it has none.
  const settle = useCallback(async (how: 'enter' | 'blur') => {
    cancel()
    close()
    const v = valueRef.current
    if (!typed.current) { if (how === 'enter') onCommit?.(v, how); return }
    const fixed = await resolvePlaceText(v)
    if (valueRef.current !== v) return // typed on while the answer came back
    typed.current = false
    const out = fixed !== v ? fixed : normalizeLocationText(v, { keepCase: true })
    if (out !== v) { onChange(out); valueRef.current = out }
    onCommit?.(out, how)
  }, [cancel, close, onChange, onCommit])

  useEffect(() => {
    if (!open || active < 0) return
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  const typedText = placeKey(value)
  return (
    <div className={wrapClassName ? `${s.wrap} ${wrapClassName}` : s.wrap}>
      <input
        {...rest}
        ref={ref}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
        className={className}
        value={value}
        onChange={e => {
          typed.current = true
          valueRef.current = e.target.value
          onChange(e.target.value)
          ask(e.target.value)
        }}
        onFocus={e => { focused.current = true; onFocus?.(e) }}
        onBlur={e => {
          focused.current = false
          void settle('blur')
          onBlur?.(e)
        }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!items.length) return
            e.preventDefault()
            if (!open) { setOpen(true); setActive(e.key === 'ArrowDown' ? 0 : items.length - 1); return }
            setActive(i => (e.key === 'ArrowDown' ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1))
            return
          }
          if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); return }
          if (e.key === 'Enter') {
            e.preventDefault() // the field decides what Enter means, then tells the page (onCommit)
            if (open && active >= 0 && items[active]) choose(items[active], 'select')
            else void settle('enter')
            return
          }
          onKeyDown?.(e)
        }}
      />
      <ul ref={listRef} id={listId} role="listbox" aria-label="Suggested places" className={s.list} hidden={!open}>
        {items.map((it, i) => {
          const lead = it.label.toLowerCase().startsWith(typedText) && typedText ? it.label.slice(0, typedText.length) : ''
          return (
            <li
              key={it.label}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={s.opt}
              // Keep focus in the box: the pick happens on click, after which the list is gone.
              onPointerDown={e => e.preventDefault()}
              onMouseDown={e => e.preventDefault()}
              onMouseMove={() => { if (i !== active) setActive(i) }}
              onClick={() => choose(it, 'pick')}
            >
              <Icon name={ICON[it.kind]} size={16} className={s.icon} />
              <span className={s.label}>{lead ? <><b className={s.lead}>{lead}</b>{it.label.slice(lead.length)}</> : it.label}</span>
              {(it.detail || DETAIL[it.kind]) && <span className={s.detail}>{it.detail || DETAIL[it.kind]}</span>}
            </li>
          )
        })}
      </ul>
      <span className="sr-only" aria-live="polite">{open ? `${items.length} suggested place${items.length === 1 ? '' : 's'}. Use the up and down arrows to choose.` : ''}</span>
    </div>
  )
})

export default LocationInput
