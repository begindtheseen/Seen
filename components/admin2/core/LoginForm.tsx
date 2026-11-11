'use client'

// The admin sign-in form, used by the sign-in screen and by the "Session ended" sheet. One submit per
// Enter or tap (audit defect 9: the old form fired both its submit and an Enter handler — two sessions
// per sign-in and a lockout after ~3 typos): the form's own submit is the only path, and a ref blocks a
// second submit while one is in flight.
import { useEffect, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { readLogin, type LoginOutcome } from './login.ts'
import { useApi } from './hooks.tsx'
import { tokenStore } from './runtime.ts'
import styles from './shell.module.css'

export default function LoginForm({ onSignedIn, submitLabel = 'Sign in', initialUser, autoFocus = true }: {
  onSignedIn: (username: string) => void
  submitLabel?: string
  initialUser?: string
  autoFocus?: boolean
}) {
  const api = useApi()
  const [username, setUsername] = useState(initialUser || '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Exclude<LoginOutcome, { kind: 'ok' }> | null>(null)
  const inFlight = useRef(false)
  const userRef = useRef<HTMLInputElement>(null)
  const passRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (autoFocus) (initialUser ? passRef.current : userRef.current)?.focus() }, [autoFocus, initialUser])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    if (!username.trim() || !password) { setProblem({ kind: 'wrong', text: 'Enter both your username and your password.' }); return }
    inFlight.current = true
    setBusy(true)
    setProblem(null)
    const res = await api<{ token?: string; username?: string }>('admin_login', { username: username.trim(), password }, { noReauth: true })
    const out = readLogin(res)
    inFlight.current = false
    setBusy(false)
    if (out.kind === 'ok') {
      tokenStore.set(out.token, out.username)
      setPassword('')
      onSignedIn(out.username)
      return
    }
    setProblem(out)
    passRef.current?.select()
  }

  return (
    <form className={styles.loginForm} onSubmit={submit} noValidate data-testid="login-form">
      <label className="ui-field">
        <span className="ui-field__label">Username</span>
        <input ref={userRef} className="ui-input" name="username" autoComplete="username" autoCapitalize="off" spellCheck={false}
          value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} data-testid="login-user" />
      </label>
      <label className="ui-field">
        <span className="ui-field__label">Password</span>
        <input ref={passRef} className="ui-input" type="password" name="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}
          aria-invalid={problem?.kind === 'wrong' || undefined} data-testid="login-pass" />
      </label>
      {problem ? (
        <div className={problem.kind === 'locked' ? `${styles.loginProblem} ${styles.loginLocked}` : styles.loginProblem} role="alert" data-testid="login-error" data-kind={problem.kind}>
          <Icon name={problem.kind === 'locked' ? 'lock' : 'circle-alert'} size={16} />
          <span>{problem.text}</span>
        </div>
      ) : null}
      <Button type="submit" variant="primary" full loading={busy} data-testid="login-submit">{busy ? 'Signing in…' : submitLabel}</Button>
    </form>
  )
}

export function signedInUser(): string { return tokenStore.username() || '' }
