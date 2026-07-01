'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { _sync } from '@/lib/sync'
import { aiHeaders } from '@/lib/aiHeaders'

const inp: React.CSSProperties = {
  width: '100%',
  background: 'var(--raised, var(--surface))',
  border: '1.5px solid var(--line2)',
  borderRadius: 8,
  padding: '.7rem 1rem',
  color: 'var(--white)',
  fontFamily: 'var(--body)',
  fontSize: '.875rem',
  outline: 'none',
  caretColor: 'var(--green)',
  boxSizing: 'border-box',
}

// Per-user profile cache (keyed by user id → NO cross-user bleed on shared devices) so the
// fields render instantly on every revisit instead of loading from scratch each time.
type CachedProfile = { name: string; city: string; experience: string }
function readProfileCache(uid?: string): CachedProfile | null {
  if (!uid || typeof window === 'undefined') return null
  try { return JSON.parse(localStorage.getItem(`seen_profile_v2_${uid}`) || 'null') } catch { return null }
}
function writeProfileCache(uid: string | undefined, p: CachedProfile) {
  if (!uid || typeof window === 'undefined') return
  try { localStorage.setItem(`seen_profile_v2_${uid}`, JSON.stringify(p)) } catch { /* quota — ignore */ }
}

// A loading placeholder matching the input's footprint — shown only on the very first load
// (before any cache exists) so the fields never flash empty.
const inpSkeleton: React.CSSProperties = {
  width: '100%',
  height: '2.6rem',
  borderRadius: 8,
  background: 'linear-gradient(90deg, var(--card) 25%, var(--raised, var(--surface)) 50%, var(--card) 75%)',
  backgroundSize: '200% 100%',
  border: '1.5px solid var(--line)',
  boxSizing: 'border-box',
  animation: 'pulse 1.3s ease-in-out infinite',
}

const sectionHead: React.CSSProperties = {
  padding: '.85rem 1.25rem',
  borderBottom: '1px solid var(--line)',
  fontFamily: 'var(--mono)',
  fontSize: '.62rem',
  color: 'var(--dim)',
  textTransform: 'uppercase',
  letterSpacing: '.08em',
}

const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  overflow: 'hidden',
  marginBottom: '1rem',
}

function Label({ text }: { text: string }) {
  return (
    <label style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.4rem' }}>
      {text}
    </label>
  )
}

type LocResult = { display: string }

export default function ProfilePage() {
  const router = useRouter()
  const { isLoggedIn, user, loadProfile } = useAuth()
  // Seed synchronously from the per-user cache so a returning user's fields are already
  // filled on first paint — no empty flash, no skeleton, no "loading" feel.
  const _cache = readProfileCache(user?.id)
  const [name, setName] = useState(_cache?.name ?? '')
  const [city, setCity] = useState(_cache?.city ?? '')
  const [experience, setExperience] = useState(_cache?.experience ?? '')
  const [initName, setInitName] = useState(_cache?.name ?? '')
  const [initCity, setInitCity] = useState(_cache?.city ?? '')
  const [initExperience, setInitExperience] = useState(_cache?.experience ?? '')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveMsgOk, setSaveMsgOk] = useState(false)
  const [isPro, setIsPro] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [sub, setSub] = useState<{ status: string; cancel_at_period_end: boolean; current_period_end: number | null; amount: number | null; interval: string | null } | null>(null)
  const [subMsg, setSubMsg] = useState('')
  // Already "loaded" if we have a cached copy (instant render); otherwise show a skeleton
  // for the one-time first load rather than an empty flash.
  const [loaded, setLoaded] = useState(!!_cache)

  const isDirty = name !== initName || city !== initCity || experience !== initExperience

  // City autocomplete
  const [citySuggs, setCitySuggs] = useState<LocResult[]>([])
  const [showCitySuggs, setShowCitySuggs] = useState(false)
  const cityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cityContainerRef = useRef<HTMLDivElement>(null)

  // Password change (send-link flow)
  const [linkSending, setLinkSending] = useState(false)
  const [linkSent, setLinkSent] = useState(false)
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [showPassForm, setShowPassForm] = useState(false)
  const [updatingPass, setUpdatingPass] = useState(false)
  const [passMsg, setPassMsg] = useState('')
  const [passMsgOk, setPassMsgOk] = useState(false)

  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!isLoggedIn) { router.replace('/login'); return }
    _sync('load_profile').then((res) => {
      const p = (res as { profile?: Record<string, unknown> } | null)?.profile
      if (p) {
        const n = (p.name as string) || ''
        const c = (p.city as string) || ''
        const e = (p.experience as string) || ''
        // Only overwrite fields the user hasn't started editing (avoid clobbering typing).
        setName(prev => prev === (_cache?.name ?? '') ? n : prev); setInitName(n)
        setCity(prev => prev === (_cache?.city ?? '') ? c : prev); setInitCity(c)
        setExperience(prev => prev === (_cache?.experience ?? '') ? e : prev); setInitExperience(e)
        writeProfileCache(user?.id, { name: n, city: c, experience: e })
      }
    }).catch(() => {}).finally(() => setLoaded(true))
    // Subscription status — gates the Billing section + Manage/Cancel button.
    _sync('load').then((res) => {
      const pro = !!(res as { credits?: { pro?: boolean } } | null)?.credits?.pro
      setIsPro(pro)
      if (pro) loadSub()
    }).catch(() => {})
  }, [isLoggedIn, router])

  // Pull the live subscription (plan, renewal date, cancel state) for the manage view.
  async function loadSub() {
    try {
      const r = await fetch('/api/stripe?action=subscription_status', { method: 'POST', headers: await aiHeaders(), body: '{}' })
      const d = await r.json()
      setSub(d?.subscription || null)
      // Reconcile Pro with Stripe's truth: if the subscription has ended, this flips the
      // Billing section to Free so the Cancel/Resume buttons disappear.
      if (typeof d?.pro === 'boolean') setIsPro(d.pro)
    } catch { /* ignore */ }
  }

  // Cancel (at period end) or resume the membership in-app — no Stripe portal needed.
  async function manageSubscription(act: 'cancel_subscription' | 'resume_subscription') {
    setPortalLoading(true)
    setSubMsg('')
    try {
      const r = await fetch(`/api/stripe?action=${act}`, { method: 'POST', headers: await aiHeaders(), body: '{}' })
      const d = await r.json()
      if (d?.ok) {
        setSub(d.subscription || null)
        if (typeof d?.pro === 'boolean') setIsPro(d.pro)
        setSubMsg(act === 'cancel_subscription' ? 'Your membership will cancel at the end of your billing period.' : 'Your membership is active again — thanks for staying!')
      } else {
        setSubMsg(d?.error || 'Could not update your membership — try again or email hello@seenjobs.io')
      }
    } catch {
      setSubMsg('Network error — please try again')
    }
    setPortalLoading(false)
  }

  // Close suggestions on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (cityContainerRef.current && !cityContainerRef.current.contains(e.target as Node)) {
        setShowCitySuggs(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const fetchCitySuggs = useCallback(async (q: string) => {
    if (q.length < 3) { setCitySuggs([]); setShowCitySuggs(false); return }
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=6&q=${encodeURIComponent(q)}&addressdetails=1`,
        { headers: { 'Accept-Language': 'en-US', 'User-Agent': 'seenjobs.io' } }
      )
      if (!r.ok) return
      const data = await r.json() as Array<{ address: Record<string, string>; display_name: string }>
      const results: LocResult[] = data.map(d => {
        const c = d.address?.city || d.address?.town || d.address?.village || ''
        const s = d.address?.state || ''
        const display = c && s ? `${c}, ${s}` : d.display_name.split(',').slice(0, 2).join(',').trim()
        return { display }
      })
      setCitySuggs(results)
      setShowCitySuggs(results.length > 0)
    } catch { /* ignore */ }
  }, [])

  function onCityInput(val: string) {
    setCity(val)
    if (cityTimerRef.current) clearTimeout(cityTimerRef.current)
    cityTimerRef.current = setTimeout(() => fetchCitySuggs(val), 350)
  }

  async function saveProfile() {
    setSaving(true)
    setSaveMsg('')
    const result = await _sync('save_profile', { profile: { name: name.trim(), city: city.trim(), experience } }) as { ok?: boolean } | null
    if (!result || result.ok === false) {
      setSaveMsg('Save failed — please try again.')
      setSaveMsgOk(false)
      setSaving(false)
      return
    }
    // Per-user cache (no cross-user bleed) so the saved values render instantly next time.
    writeProfileCache(user?.id, { name: name.trim(), city: city.trim(), experience })
    setSaveMsg('Saved!')
    setSaveMsgOk(true)
    setInitName(name.trim())
    setInitCity(city.trim())
    setInitExperience(experience)
    loadProfile()
    setSaving(false)
  }

  async function sendResetLink() {
    if (!user?.email) return
    setLinkSending(true)
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset`,
    })
    setLinkSending(false)
    if (error) { setPassMsg(error.message); setPassMsgOk(false); return }
    setLinkSent(true)
    setShowPassForm(true)
    setPassMsg('')
  }

  async function updatePassword() {
    if (!newPass || newPass.length < 8) { setPassMsg('Password must be at least 8 characters.'); setPassMsgOk(false); return }
    if (newPass !== confirmPass) { setPassMsg("Passwords don't match."); setPassMsgOk(false); return }
    setUpdatingPass(true)
    setPassMsg('')
    const { error } = await supabase.auth.updateUser({ password: newPass })
    setUpdatingPass(false)
    if (error) { setPassMsg(error.message); setPassMsgOk(false); return }
    setPassMsg('Password updated.')
    setPassMsgOk(true)
    setNewPass('')
    setConfirmPass('')
    setShowPassForm(false)
    setLinkSent(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
    try { localStorage.removeItem('seen_last_page') } catch {}
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
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '2rem 1.25rem 4rem', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '2rem' }}>
          <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem', padding: '.25rem', lineHeight: 1 }}>←</button>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.2rem' }}>Account</div>
            <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em' }}>Profile settings</h1>
          </div>
        </div>

        {/* Basic info */}
        <div style={card}>
          <div style={sectionHead}>Basic info</div>
          <div style={{ padding: '1.25rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <Label text="First name" />
              {loaded ? (
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onFocus={e => { e.target.style.borderColor = 'var(--green)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--line2)' }}
                  placeholder="Your first name"
                  style={inp}
                />
              ) : <div style={inpSkeleton} />}
            </div>
            <div>
              <Label text="Email" />
              <input type="email" value={user?.email || ''} disabled style={{ ...inp, opacity: 0.6, cursor: 'not-allowed' }} />
            </div>
          </div>
        </div>

        {/* Location */}
        <div style={card}>
          <div style={sectionHead}>Job location</div>
          <div style={{ padding: '1.25rem' }}>
            <Label text="Your city" />
            <div style={{ position: 'relative' }} ref={cityContainerRef}>
              {loaded ? (
              <input
                type="text"
                autoComplete="off"
                value={city}
                onChange={e => onCityInput(e.target.value)}
                onFocus={e => { e.target.style.borderColor = 'var(--green)'; if (citySuggs.length) setShowCitySuggs(true) }}
                onBlur={e => { e.target.style.borderColor = 'var(--line2)' }}
                placeholder="e.g. Los Angeles, CA"
                style={inp}
              />
              ) : <div style={inpSkeleton} />}
              {showCitySuggs && citySuggs.length > 0 && (
                <div style={{ position: 'absolute', zIndex: 200, background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 8, width: '100%', top: 'calc(100% + 4px)', left: 0, boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
                  {citySuggs.map((s, i) => (
                    <div
                      key={i}
                      onMouseDown={e => { e.preventDefault(); setCity(s.display); setShowCitySuggs(false) }}
                      style={{ padding: '.65rem 1rem', cursor: 'pointer', fontSize: '.82rem', color: 'var(--white)', borderBottom: '1px solid var(--line)' }}
                      onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = 'var(--card)' }}
                      onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                    >
                      {s.display}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', marginTop: '.5rem' }}>
              Used to auto-load nearby job listings on the Jobs page.
            </div>
          </div>
        </div>

        {/* Job preferences */}
        <div style={card}>
          <div style={sectionHead}>Job preferences</div>
          <div style={{ padding: '1.25rem' }}>
            <Label text="Experience level" />
            {loaded ? (
            <select
              value={experience}
              onChange={e => setExperience(e.target.value)}
              onFocus={e => { e.target.style.borderColor = 'var(--green)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--line2)' }}
              style={{ ...inp, cursor: 'pointer', appearance: 'none' as const }}
            >
              <option value="">— Select level —</option>
              <option value="entry">🌱 Entry level (0–2 yrs)</option>
              <option value="mid">📈 Mid level (3–6 yrs)</option>
              <option value="senior">⭐ Senior (7+ yrs)</option>
              <option value="lead">🔷 Lead / Staff</option>
            </select>
            ) : <div style={inpSkeleton} />}
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', marginTop: '.5rem' }}>
              Use the search filter on the Jobs page to filter by industry.
            </div>
          </div>
        </div>

        {/* Account & Security */}
        <div style={card}>
          <div style={sectionHead}>Account &amp; Security</div>
          <div style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.75rem' }}>
              <div>
                <div style={{ fontSize: '.82rem', fontWeight: 500, color: 'var(--white)' }}>Change password</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)' }}>A reset link is sent to your email</div>
              </div>
              <button
                className="btn btn-ghost"
                style={{ fontSize: '.75rem' }}
                onClick={sendResetLink}
                disabled={linkSending}
              >
                {linkSending ? 'Sending...' : 'Send link →'}
              </button>
            </div>

            {linkSent && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: '.85rem', marginBottom: '.85rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--blue)', marginBottom: '.75rem', lineHeight: 1.6 }}>
                  ✓ Link sent — click it in your email, then come back and set your new password here
                </div>
              </div>
            )}

            {showPassForm && (
              <div style={{ borderTop: linkSent ? 'none' : '1px solid var(--line)', paddingTop: linkSent ? 0 : '.85rem', marginBottom: '.85rem' }}>
                <div style={{ marginBottom: '.65rem' }}>
                  <label style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--dim)', display: 'block', marginBottom: '.32rem' }}>New password</label>
                  <input
                    type="password"
                    value={newPass}
                    onChange={e => setNewPass(e.target.value)}
                    onFocus={e => { e.target.style.borderColor = 'var(--blue)' }}
                    onBlur={e => { e.target.style.borderColor = 'var(--line2)' }}
                    placeholder="Min 8 characters"
                    style={{ ...inp, caretColor: 'var(--blue)' }}
                  />
                </div>
                <div style={{ marginBottom: '.85rem' }}>
                  <label style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--dim)', display: 'block', marginBottom: '.32rem' }}>Confirm new password</label>
                  <input
                    type="password"
                    value={confirmPass}
                    onChange={e => setConfirmPass(e.target.value)}
                    onFocus={e => { e.target.style.borderColor = 'var(--blue)' }}
                    onBlur={e => { e.target.style.borderColor = 'var(--line2)' }}
                    placeholder="Confirm password"
                    style={{ ...inp, caretColor: 'var(--blue)' }}
                  />
                </div>
                {passMsg && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: passMsgOk ? 'var(--green)' : 'var(--red)', marginBottom: '.65rem' }}>{passMsg}</div>
                )}
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <button
                    className="btn btn-ghost"
                    style={{ flex: 1, justifyContent: 'center', fontSize: '.78rem' }}
                    onClick={() => { setShowPassForm(false); setPassMsg('') }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-green"
                    style={{ flex: 2, justifyContent: 'center', fontWeight: 800, fontSize: '.78rem' }}
                    onClick={updatePassword}
                    disabled={updatingPass}
                  >
                    {updatingPass ? 'Updating...' : 'Update password →'}
                  </button>
                </div>
              </div>
            )}

            {!showPassForm && passMsg && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: passMsgOk ? 'var(--green)' : 'var(--red)', marginBottom: '.65rem' }}>{passMsg}</div>
            )}

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '.75rem' }}>
              <button
                onClick={signOut}
                style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)', borderRadius: 8, padding: '.65rem 1.25rem', fontFamily: 'var(--mono)', fontSize: '.74rem', fontWeight: 600, cursor: 'pointer', width: '100%', transition: 'background .15s,border-color .15s' }}
                onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.14)' }}
                onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.07)' }}
              >
                Sign out of Seen
              </button>
            </div>
          </div>
        </div>

        {isDirty && (
          <button
            onClick={saveProfile}
            disabled={saving}
            style={{ width: '100%', padding: '.9rem', background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem', cursor: saving ? 'not-allowed' : 'pointer', marginBottom: '1rem', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving...' : 'Save changes →'}
          </button>
        )}
        {saveMsg && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: saveMsgOk ? 'var(--green)' : 'var(--red)', textAlign: 'center', marginBottom: '1.5rem' }}>{saveMsg}</div>
        )}

        {/* Billing & Subscription */}
        <div style={card}>
          <div style={sectionHead}>Billing &amp; Subscription</div>
          <div style={{ padding: '1.25rem' }}>
            {isPro ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.6rem' }}>
                  <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.95rem', color: 'var(--green)' }}>Seen Pro</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: sub?.cancel_at_period_end ? 'var(--red)' : 'var(--green)', border: `1px solid ${sub?.cancel_at_period_end ? 'rgba(239,68,68,.35)' : 'rgba(16,185,129,.35)'}`, borderRadius: 20, padding: '.12rem .5rem', letterSpacing: '.06em' }}>
                    {sub?.cancel_at_period_end ? 'CANCELING' : 'ACTIVE'}
                  </span>
                </div>
                {sub && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--sub)', marginBottom: '.6rem', lineHeight: 1.6 }}>
                    {sub.amount != null ? `$${sub.amount}/${sub.interval === 'year' ? 'yr' : 'mo'}` : 'Active'}
                    {sub.current_period_end ? (sub.cancel_at_period_end
                      ? ` · ends ${new Date(sub.current_period_end).toLocaleDateString()}`
                      : ` · renews ${new Date(sub.current_period_end).toLocaleDateString()}`) : ''}
                  </div>
                )}
                <div style={{ fontFamily: 'var(--body)', fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.65, marginBottom: '1rem' }}>
                  {sub?.cancel_at_period_end
                    ? 'Your membership is set to cancel — you keep Pro until the date above. Change your mind anytime before then.'
                    : 'Your subscription renews automatically each billing period until you cancel. Cancel anytime — you keep Pro through the month you’ve already paid for.'}
                </div>
                {sub?.cancel_at_period_end ? (
                  <button
                    onClick={() => manageSubscription('resume_subscription')}
                    disabled={portalLoading}
                    style={{ width: '100%', padding: '.85rem', background: portalLoading ? 'var(--line)' : 'linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)', color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', cursor: portalLoading ? 'default' : 'pointer' }}
                  >
                    {portalLoading ? 'Working…' : 'Resume membership'}
                  </button>
                ) : (
                  <button
                    onClick={() => manageSubscription('cancel_subscription')}
                    disabled={portalLoading || !sub}
                    title={!sub ? 'No active Stripe subscription on file' : undefined}
                    style={{ width: '100%', padding: '.8rem', background: 'none', color: 'var(--red)', border: '1px solid rgba(239,68,68,.4)', borderRadius: 10, fontFamily: 'var(--mono)', fontWeight: 600, fontSize: '.74rem', cursor: (portalLoading || !sub) ? 'default' : 'pointer', opacity: (portalLoading || !sub) ? 0.55 : 1 }}
                  >
                    {portalLoading ? 'Working…' : 'Cancel membership'}
                  </button>
                )}
                {subMsg && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', marginTop: '.7rem', lineHeight: 1.6 }}>{subMsg}</div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontFamily: 'var(--body)', fontSize: '.82rem', color: 'var(--white)', marginBottom: '.4rem' }}>You&apos;re on the <strong>Free</strong> plan.</div>
                <div style={{ fontFamily: 'var(--body)', fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.65, marginBottom: '1rem' }}>
                  Seen Pro is $9.99/month (or $6.99/month billed annually). It renews automatically until you cancel, and you can cancel anytime from this page.
                </div>
                <button
                  onClick={() => router.push('/pricing')}
                  style={{ width: '100%', padding: '.8rem', background: 'linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)', color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', cursor: 'pointer' }}
                >
                  View Pro plans →
                </button>
              </>
            )}
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', marginTop: '.9rem', lineHeight: 1.6 }}>
              See <a href="/legal" style={{ color: 'var(--sub)' }}>Subscription Terms</a> for renewal, cancellation, and refund details.
            </div>
          </div>
        </div>

        {/* Danger zone */}
        <div style={{ background: 'var(--surface)', border: '1px solid #ff3b5c28', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '.85rem 1.25rem', borderBottom: '1px solid #ff3b5c22', fontFamily: 'var(--mono)', fontSize: '.62rem', color: '#ff3b5c', textTransform: 'uppercase', letterSpacing: '.08em' }}>Danger zone</div>
          <div style={{ padding: '1.25rem' }}>
            <div style={{ fontSize: '.78rem', color: 'var(--sub)', marginBottom: '.85rem', lineHeight: 1.6 }}>
              Permanently deletes your account, applications, and saved data. This cannot be undone.
            </div>
            <button
              onClick={deleteAccount}
              disabled={deleting}
              style={{ background: 'none', border: '1px solid #ff3b5c44', color: '#ff3b5c', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--mono)', fontSize: '.72rem', cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
            >
              {deleting ? 'Deleting...' : 'Delete my account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
