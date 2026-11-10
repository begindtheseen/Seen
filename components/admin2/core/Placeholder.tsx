'use client'

// A section that is not rebuilt yet: says so plainly and points at the legacy admin, which still works.
import Button from '@/components/ui/Button'
import { SectionHeader } from '../ui/bits.tsx'
import { EmptyState } from '../ui/states.tsx'
import type { SectionProps } from './sections.tsx'

export default function Placeholder({ name }: SectionProps & { name: string }) {
  return (
    <div>
      <SectionHeader title={name} sub="Not rebuilt yet in the new admin." />
      <EmptyState
        icon="hourglass"
        title={`${name} is still on the legacy admin.`}
        body="Everything it did still works there, with the same sign-in."
        action={<Button variant="secondary" href="/admin/legacy" iconRight="arrow-right">Open the legacy admin</Button>}
      />
    </div>
  )
}
