// THE disclosure: a native <details>/<summary> (keyboard + screen reader behaviour for free), with a
// title, an optional one-line summary of what is inside, and a chevron. `defaultOpen` for content
// people came for (company quotes are open by default — audit #28).
import type { ReactNode } from 'react'
import Icon from './Icon'

export type DisclosureProps = {
  title: ReactNode
  summary?: ReactNode
  defaultOpen?: boolean
  id?: string
  className?: string
  children: ReactNode
}

export default function Disclosure({ title, summary, defaultOpen, id, className, children }: DisclosureProps) {
  return (
    <details className={className ? `ui-disc ${className}` : 'ui-disc'} open={defaultOpen} id={id}>
      <summary>
        <span className="ui-disc__title">{title}</span>
        {summary ? <span className="ui-disc__sum">{summary}</span> : null}
        <Icon name="chevron-down" size={18} className="ui-disc__chev" />
      </summary>
      <div className="ui-disc__body">{children}</div>
    </details>
  )
}
