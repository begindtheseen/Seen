'use client'

// THE form field: a real <label htmlFor> tied to the control by useId, an optional hint and an error
// that the control points at with aria-describedby (audit 2026-10-25: six résumé fields had a <label>
// with no htmlFor, so a screen reader announced them as unnamed edit boxes).
//
//   <Field label="Email" hint="We only email outcomes you ask for." error={err}>
//     {(p) => <input type="email" className="ui-input" {...p} />}
//   </Field>
//
// …or the shorthands below: <TextInput>, <TextArea>, <SelectInput>, which render the control for you.
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import Icon from './Icon'

export type ControlProps = {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
  required?: boolean
}

/** The ids a field hands its control. Pure, so the wiring is unit-tested (components/ui/ui.test.mjs). */
export function fieldIds(base: string, { hint, error }: { hint?: boolean; error?: boolean }) {
  const id = `f${base.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-err` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  return { id, hintId, errorId, describedBy }
}

export type FieldProps = {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** Adds "(optional)" after the label. Required fields say nothing — most fields are required. */
  optional?: boolean
  required?: boolean
  /** Visually hide the label (it is still read). Use only when a visible heading already names it. */
  hideLabel?: boolean
  className?: string
  /** Use your own id (e.g. when a link elsewhere targets the field). */
  id?: string
  children: (control: ControlProps) => ReactNode
}

export default function Field({ label, hint, error, optional, required, hideLabel, className, id: idProp, children }: FieldProps) {
  const auto = useId()
  const ids = fieldIds(idProp || auto, { hint: !!hint, error: !!error })
  const id = idProp || ids.id
  return (
    <div className={className ? `ui-field ${className}` : 'ui-field'}>
      <label htmlFor={id} className={hideLabel ? 'ui-field__label sr-only' : 'ui-field__label'}>
        {label}{optional ? <span className="ui-field__opt"> (optional)</span> : null}
      </label>
      {children({ id, 'aria-describedby': ids.describedBy, ...(error ? { 'aria-invalid': true as const } : {}), ...(required ? { required: true } : {}) })}
      {error ? <p id={ids.errorId} className="ui-field__error" role="alert"><Icon name="circle-x" size={14} />{error}</p> : null}
      {hint ? <p id={ids.hintId} className="ui-field__hint">{hint}</p> : null}
    </div>
  )
}

type Shared = Omit<FieldProps, 'children'>

export function TextInput({ label, hint, error, optional, required, hideLabel, className, id, ...input }: Shared & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  return (
    <Field {...{ label, hint, error, optional, required, hideLabel, className, id }}>
      {(p) => <input className="ui-input" {...input} {...p} />}
    </Field>
  )
}

export function TextArea({ label, hint, error, optional, required, hideLabel, className, id, ...ta }: Shared & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>) {
  return (
    <Field {...{ label, hint, error, optional, required, hideLabel, className, id }}>
      {(p) => <textarea className="ui-input" {...ta} {...p} />}
    </Field>
  )
}

export function SelectInput({ label, hint, error, optional, required, hideLabel, className, id, children, ...sel }: Shared & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & { children: ReactNode }) {
  return (
    <Field {...{ label, hint, error, optional, required, hideLabel, className, id }}>
      {(p) => <select className="ui-input" {...sel} {...p}>{children}</select>}
    </Field>
  )
}
