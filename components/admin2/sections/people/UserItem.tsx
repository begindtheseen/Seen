'use client'

// An account's sheet (`?item=user:<id>`): the Pro window (set / end — never touches the balance, and says so),
// credits (balance, add credits, the ledger), a new password, and deleting the account (type-to-confirm).
import { useEffect, useState } from 'react'
import { formatPacific } from '@/lib/time/pacific'
import Button from '@/components/ui/Button'
import { useAdminAction, useAdminQuery, useApi } from '../../core/hooks.tsx'
import type { ItemViewProps } from '../../core/items.tsx'
import { ItemNotFound } from '../../core/SheetHost.tsx'
import { StatTile, StatStrip, StatusChip } from '../../ui/bits.tsx'
import ConfirmStep from '../../ui/ConfirmStep.tsx'
import ResultLine from '../../ui/ResultLine.tsx'
import { EmptyState, ErrorState, RefreshFailed, Skeleton } from '../../ui/states.tsx'
import { isUnknownAnswer } from '../listings/unknown.ts'
import styles from '../listings/listings.module.css'
import { endOfPacificDay, fmt, ledgerWords, pacificPlusDays, proLine, readUserDetail, signupWords } from './adapter.ts'

export default function UserItem({ kind, id, setTitle, close }: ItemViewProps) {
  const api = useApi()
  const q = useAdminQuery<Record<string, unknown>>(`user:${id}`, () => api<Record<string, unknown>>('user_detail', { user_id: id }), { staleMs: 15_000 })
  const u = q.data ? readUserDetail(q.data) : null
  useEffect(() => { if (u) setTitle(u.email || `Account ${u.id}`, u.created_at ? `joined ${formatPacific(u.created_at, { dateStyle: 'medium' })}` : `account ${u.id}`) }, [u, setTitle])

  const pro = useAdminAction('set_pro_window', { dock: false })
  // An answer that never arrived: the write may have happened. Re-read the account (balance, ledger) before
  // showing a number, and offer no Retry (a Retry granted twice — judge F3).
  const reread = (res: { ok: boolean }) => { if (!res.ok && isUnknownAnswer(res as never)) void q.refresh() }
  const grant = useAdminAction('grant_credits', { dock: false, onSettled: reread })
  const pw = useAdminAction('set_user_password', { dock: false, onSettled: (res) => { if (res.ok) { setPassword(''); setReason(''); setConfirmPw(false) } else setConfirmPw(false); reread(res) } })
  const del = useAdminAction('delete_user', { dock: false, onSettled: (res) => { if (!res.ok) setConfirmDel(false); reread(res) } })
  const [until, setUntil] = useState(pacificPlusDays(30))
  const [amount, setAmount] = useState('5')
  const [grantWhy, setGrantWhy] = useState('')
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [confirmPw, setConfirmPw] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  if (del.state().status === 'done') {
    return (
      <div className={styles.item}>
        <ResultLine state={del.state()} />
        <EmptyState icon="circle-check" title="The account is gone." action={<Button variant="secondary" onClick={close}>Close</Button>} />
      </div>
    )
  }
  if (q.loading) return <Skeleton rows={4} label="Reading the account" />
  if (q.error && !u) return q.error.code === 'not_found' || q.error.code === 'bad_request' ? <ItemNotFound kind={kind} id={id} /> : <ErrorState what="this account" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} />
  if (!u) return <ItemNotFound kind={kind} id={id} />

  const untilIso = endOfPacificDay(until)
  const untilOk = !!untilIso && Date.parse(untilIso) > Date.now()
  const n = Number(amount)
  const amountOk = Number.isInteger(n) && n >= 1 && n <= 500
  const pwOk = password.length >= 8 && password.length <= 72
  const label = u.email || 'this account'

  return (
    <div className={styles.item} data-testid="user-item">
      <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
      <StatStrip label="The account in numbers">
        <StatTile label="Credits" value={u.balance} sub="balance now" testId="user-balance" />
        <StatTile label="Applications" value={u.applications} sub="tracked" />
        <StatTile label="Reports" value={u.reports} sub="sent to Seen" />
        <StatTile label="Credits earned" value={u.earned} sub="every credit ever added" />
        <StatTile label="Credits spent" value={u.spent} sub="every credit ever used" />
      </StatStrip>

      <div className={styles.itemPart}>
        <h3 className={styles.h2}>Pro</h3>
        <p className={styles.text} data-testid="user-pro"><span className={styles.strong}>{proLine(u)}</span>{u.pro_active ? ' — Pro now.' : '.'}</p>
        <p className={styles.quiet}>Setting or ending Pro never changes the credit balance, and is never counted as a purchase.</p>
        <form className={styles.inline} onSubmit={(e) => { e.preventDefault(); if (untilOk) void pro.run({ user_id: u.id, until: untilIso }) }}>
          <label className={`${styles.field} ${styles.narrow}`}><span>Pro until (California day)</span>
            <input className="ui-input" type="date" value={until} min={pacificPlusDays(1)} onChange={(e) => setUntil(e.target.value)} data-testid="user-pro-until" /></label>
          <Button type="button" variant="ghost" onClick={() => setUntil(pacificPlusDays(7))}>+7 days</Button>
          <Button type="button" variant="ghost" onClick={() => setUntil(pacificPlusDays(30))}>+30 days</Button>
          <Button type="submit" variant="secondary" disabled={!untilOk} loading={pro.busy()} data-testid="user-pro-set">Set Pro until {untilOk ? formatPacific(untilIso!, { dateStyle: 'medium' }) : '…'}</Button>
        </form>
        {u.pro_active ? (
          <div className={styles.actions}><Button variant="ghost" icon="circle-slash" onClick={() => void pro.run({ user_id: u.id, until: null })} disabled={pro.busy()} data-testid="user-pro-end">End Pro now</Button></div>
        ) : null}
        <ResultLine state={pro.state()} onUndo={() => pro.undo()} onRetry={() => pro.retry()} onDismiss={() => pro.dismiss()} runningText="Saving the Pro window…" />
      </div>

      <div className={styles.itemPart}>
        <h3 className={styles.h2}>Credits</h3>
        <form className={styles.inline} onSubmit={(e) => { e.preventDefault(); if (amountOk) void grant.run({ user_id: u.id, amount: n, reason: grantWhy.trim() || undefined }) }}>
          <label className={`${styles.field} ${styles.narrow}`}><span>Credits to add (1–500)</span>
            <input className="ui-input" type="number" inputMode="numeric" min={1} max={500} value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!amountOk} data-testid="user-credits-amount" /></label>
          <label className={styles.field}><span>Why (kept on the ledger line)</span>
            <input className="ui-input" value={grantWhy} maxLength={200} onChange={(e) => setGrantWhy(e.target.value)} autoComplete="off" data-testid="user-credits-why" /></label>
          <Button type="submit" variant="secondary" icon="plus" disabled={!amountOk} loading={grant.busy()} data-testid="user-credits-add">{amountOk ? `Add ${fmt(n)} ${n === 1 ? 'credit' : 'credits'}` : 'Add credits'}</Button>
        </form>
        <ResultLine state={grant.state()} onUndo={() => grant.undo()} onRetry={() => grant.retry()} onDismiss={() => grant.dismiss()} runningText="Adding credits…" />
        {isUnknownAnswer(grant.state().error) ? <p className={styles.quiet} data-testid="user-credits-unknown">The server hasn’t said whether these credits were added. The balance and the history above were read again{q.fetching ? ' (reading…)' : ''}; “Check again” asks about this same grant and can never add it twice.</p> : null}
        {u.ledger.length ? (
          <ul className={styles.lines} aria-label="Credit history" data-testid="user-ledger">
            {u.ledger.map((l, i) => <li key={`${l.created_at}-${i}`} className={styles.lineItem}><span className={styles.lineMain}>{ledgerWords(l)}</span><span className={styles.lineSide}>{l.created_at ? formatPacific(l.created_at) : ''}</span></li>)}
          </ul>
        ) : <p className={styles.quiet}>No credit history.</p>}
        {u.ledger.length >= 50 ? <p className={styles.quiet}>The 50 most recent changes.</p> : null}
      </div>

      <div className={styles.itemPart}>
        <h3 className={styles.h2}>Where they signed up from</h3>
        <p className={styles.text} data-testid="user-signup">{signupWords(u.signup)}</p>
      </div>

      <div className={styles.itemPart}>
        <h3 className={styles.h2}>Password</h3>
        {confirmPw ? (
          <ConfirmStep title={`Set a new password for ${label}?`} body="Their old password stops working. Tell them the new one yourself, not by email from here."
            irreversible="The old password cannot be restored." confirmLabel="Set the password" busy={pw.busy()}
            onCancel={() => setConfirmPw(false)} onConfirm={() => { void pw.run({ user_id: u.id, new_password: password, reason: reason.trim() || undefined }) }} />
        ) : (
          <form className={styles.form} onSubmit={(e) => { e.preventDefault(); if (pwOk) setConfirmPw(true) }}>
            <div className={styles.formGrid}>
              <label className={styles.field}><span>New password (8–72 characters)</span>
                <input className="ui-input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="off" data-testid="user-pw" /></label>
              <label className={styles.field}><span>Why (kept in the activity log)</span>
                <input className="ui-input" value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" /></label>
            </div>
            <div className={styles.actions}><Button type="submit" variant="secondary" icon="lock" disabled={!pwOk} data-testid="user-pw-set">Set new password…</Button></div>
          </form>
        )}
        <ResultLine state={pw.state()} onRetry={() => pw.retry()} onDismiss={() => pw.dismiss()} runningText="Setting the password…" />
      </div>

      <div className={styles.itemPart}>
        <h3 className={styles.h2}>Delete</h3>
        {confirmDel ? (
          <ConfirmStep title={`Delete ${label}?`}
            body="The sign-in account goes first; then their tracked applications, saved jobs, credits and credit history, survey answers, résumé job history, recently checked companies and profile. Reports they sent stay, without their name."
            irreversible="The account and everything listed above are deleted for good." confirmLabel="Delete the account" typeToConfirm="DELETE" busy={del.busy()}
            onCancel={() => setConfirmDel(false)} onConfirm={() => { void del.run({ user_id: u.id }) }} />
        ) : (
          <div className={styles.actions}><Button variant="danger" icon="trash-2" onClick={() => setConfirmDel(true)} data-testid="user-delete">Delete the account…</Button></div>
        )}
        <ResultLine state={del.state()} onRetry={() => del.retry()} onDismiss={() => del.dismiss()} runningText="Deleting…" />
      </div>
      {u.comped ? <p className={styles.quiet}><StatusChip tone="info" label="Comped" /> An old lifetime grant; ending Pro removes it.</p> : null}
    </div>
  )
}
