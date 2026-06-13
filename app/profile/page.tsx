'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { _sync } from '@/lib/sync'

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1.5px solid var(--line2)',
  borderRadius: 8,
  padding: '.62rem .9rem',
  color: 'var(--white)',
  fontFamily: 'var(--body)',
  fontSize: '.875rem',
  outline: 'none',
  caretColor: 'var(--blue)',
  marginBottom: '.85rem',
}

const lbl = (text: string) => (
  <label style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.3rem' }}>
    {text}
  </label>
)

export default function ProfilePage() {
  const router = useRouter()
  const { isLoggedIn, user } = useAuth()
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [experience, setExperience] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingPw, setSavingPw] = useState(false)
  const [msg, setMsg] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!isLoggedIn) { router.replace('/login'); return }
    // Load profile from DB
    _sync('load_profile').then((res) => {
      const p = (res as { profile?: Record<string, unknown> } | null)?.profile
      if (p) {
        setName((p.name as string) || '')
        setCity((p.city as string) || '')
        setExperience((p.experience as string) || '')
      }
    }).catch(() => {})
  }, [isLoggedIn, router])

  async function saveProfile() {
    setSaving(true)
    setMsg('')
    try {
      await _sync('save_profile', { profile: { name: name.trim(), city: city.trim(), experience } })
      setMsg('Profile saved.')
    } catch {
      setMsg('Save failed. Please try again.')
    }
    setSaving(false)
  }

  async function changePassword() {
    if (!newPassword || newPassword !== confirmPassword) {
      setPwMsg('Passwords must match and not be empty.')
      return
    }
    if (newPassword.length < 8) {
      setPwMsg('Password must be at least 8 characters.')
      return
    }
    setSavingPw(true)
    setPwMsg('')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPw(false)
    if (error) { setPwMsg(error.message); return }
    setPwMsg('Password updated.')
    setNewPassword('')
    setConfirmPassword('')
  }

  async function signOut() {
    await supabase.auth.signOut()
    try { sessionStorage.removeItem('sp'); localStorage.removeItem('seen_last_page') } catch {}
    router.replace('/')
  }

  async function deleteAccount() {
    if (!confirm('This permanently deletes your account and all your data. There is no undo.')) return
    setDeleting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/user-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'delete_account' }),
      })
      await supabase.auth.signOut()
      router.replace('/')
    } catch {
      setDeleting(false)
      alert('Delete failed. Contact hello@tryseen.io')
    }
  }

  return (
    <div className="page-full">
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '2.5rem 2rem' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <a href="/dashboard" style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
            ← Dashboard
          </a>
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.75rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '2rem' }}>
          Profile settings
        </h1>

        {/* Basic info */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.5rem', marginBottom: '1.25rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
            Basic info
          </div>
          {lbl('First name')}
          <input type="text" placeholder="What should we call you?" value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
          {lbl('Email')}
          <input type="email" value={user?.email || ''} disabled style={{ ...inputStyle, opacity: 0.5, cursor: 'not-allowed', marginBottom: '.85rem' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
            <div>
              {lbl('City')}
              <input type="text" placeholder="e.g. Austin, TX" value={city} onChange={e => setCity(e.target.value)} style={inputStyle} />
            </div>
            <div>
              {lbl('Experience level')}
              <select value={experience} onChange={e => setExperience(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Prefer not to say</option>
                <option value="entry">Entry level</option>
                <option value="mid">Mid level</option>
                <option value="senior">Senior</option>
                <option value="lead">Lead / Staff</option>
              </select>
            </div>
          </div>
          {msg && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: msg.includes('failed') ? 'var(--red)' : 'var(--green)', marginBottom: '.75rem' }}>
              {msg}
            </div>
          )}
          <button
            onClick={saveProfile}
            disabled={saving}
            style={{ background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', color: '#fff', border: 'none', borderRadius: 8, padding: '.65rem 1.5rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>

        {/* Password */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.5rem', marginBottom: '1.25rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
            Change password
          </div>
          {lbl('New password')}
          <input type="password" placeholder="At least 8 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={inputStyle} />
          {lbl('Confirm password')}
          <input type="password" placeholder="Same as above" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={inputStyle} />
          {pwMsg && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: pwMsg.includes('failed') || pwMsg.includes('match') ? 'var(--red)' : 'var(--green)', marginBottom: '.75rem' }}>
              {pwMsg}
            </div>
          )}
          <button
            onClick={changePassword}
            disabled={savingPw}
            style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.82rem', color: 'var(--sub)', cursor: savingPw ? 'not-allowed' : 'pointer', opacity: savingPw ? 0.6 : 1 }}
          >
            {savingPw ? 'Updating...' : 'Update password'}
          </button>
        </div>

        {/* Danger zone */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.5rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
            Account
          </div>
          <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={signOut}
              style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.82rem', color: 'var(--sub)', cursor: 'pointer' }}
            >
              Sign out
            </button>
            <button
              onClick={deleteAccount}
              disabled={deleting}
              style={{ background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.82rem', color: 'var(--red)', cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
            >
              {deleting ? 'Deleting...' : 'Delete account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
