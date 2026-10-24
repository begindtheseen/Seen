import Link from 'next/link'
import PageHeader from '@/components/shell/PageHeader'
import styles from './openData.module.css'

/** Shown when the dataset snapshot cannot be read: no numbers rather than wrong ones. */
export default function ListUnavailable() {
  return (
    <div className="page-full">
      <div className={styles.wrap}>
        <PageHeader eyebrow="Monthly list" title="This list could not be loaded" crumbs={[{ href: '/lists', label: 'Lists' }]} crumbLabel="Unavailable" />
        <p className={styles.p}>The data behind it could not be read just now, so no numbers are shown. Try again in a few minutes, or browse the <Link href="/companies">company scoreboard</Link>.</p>
      </div>
    </div>
  )
}
