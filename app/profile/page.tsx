'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { _sync } from '@/lib/sync'
import { markIntentionalSignOut } from '@/lib/sessionExpired'
import { proPriceLine } from '@/lib/pricing'
import { aiHeaders } from '@/lib/aiHeaders'
import { matchCities } from '@/lib/data/usCities'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import { parseResumeFile } from '@/lib/resumeUploadClient'
import PageHeader from '@/components/shell/PageHeader'
import DeleteAccountDialog from '@/components/profile/DeleteAccountDialog'
import { loginHref } from '@/lib/safeHref.js'
import styles from './profile.module.css'
import { formatPacific } from '@/lib/time/pacific.js'
import { FREE_DAILY_CREDITS, CREDIT_RESET_LABEL, RESUME_PARSE_COST } from '@/lib/creditRules'

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

type LocResult = { display: string }

export default function ProfilePage() {
  const router = useRouter()
  const { isLoggedIn, user, ready, loadProfile } = useAuth()
  // Seed synchronously from the per-user cache so a returning user's fields are already
  // filled on first paint — no empty flash, no skeleton, no "loading" feel. On a fresh page load
  // `user` is still null here (getSession is async), so this seed is usually empty and the
  // effect below fills the fields from the cache, then from the DB.
  const _cache = readProfileCache(user?.id)
  const [name, setName] = useState(_cache?.name ?? '')
  const [city, setCity] = useState(_cache?.city ?? '')
  const [experience, setExperience] = useState(_cache?.experience ?? '')
  const [initName, setInitName] = useState(_cache?.name ?? '')
  const [initCity, setInitCity] = useState(_cache?.city ?? '')
  const [initExperience, setInitExperience] = useState(_cache?.experience ?? '')
  // Which fields the user has typed in. Loaded values only ever replace UNTOUCHED fields — the
  // old guard compared the field against the cache read on the CURRENT render, which differed
  // from the (empty) value the state was seeded with, so a loaded name never landed and
  // Settings showed "First name" empty for a profile that had one (audit 2026-10-23).
  const touched = useRef({ name: false, city: false, experience: false })
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Stripe Billing Portal (payment method, invoices, cancellation) — only offered once a Stripe
  // customer exists, i.e. when a subscription summary came back.
  const [portalBusy, setPortalBusy] = useState(false)

  // Résumé (add / replace lives here too — owner found "it's only in Résumé AI" confusing)
  const [resumeMeta, setResumeMeta] = useState<{ fileName: string; wordCount: number } | null>(null)
  const [resumeBusy, setResumeBusy] = useState(false)
  const [resumeMsg, setResumeMsg] = useState('')
  const [resumeMsgOk, setResumeMsgOk] = useState(false)
  const resumeFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!ready) return // wait for the session to resolve — redirecting early bounced signed-in users
    if (!isLoggedIn) { router.replace(loginHref(`${window.location.pathname}${window.location.search}${window.location.hash}`)); return }
    // Instant fill from this user's cache (now that the user id is known), then the DB wins.
    const fill = (p: CachedProfile) => {
      if (!touched.current.name) setName(p.name)
      if (!touched.current.city) setCity(p.city)
      if (!touched.current.experience) setExperience(p.experience)
      setInitName(p.name); setInitCity(p.city); setInitExperience(p.experience)
    }
    const cached = readProfileCache(user?.id)
    if (cached) { fill(cached); setLoaded(true) }
    _sync('load_profile').then((res) => {
      const p = (res as { profile?: Record<string, unknown> } | null)?.profile
      if (p) {
        const loadedProfile = { name: (p.name as string) || '', city: (p.city as string) || '', experience: (p.experience as string) || '' }
        fill(loadedProfile)
        writeProfileCache(user?.id, loadedProfile)
      }
    }).catch(() => {}).finally(() => setLoaded(true))
    // Subscription status — gates the Billing section + Manage/Cancel button.
    _sync('load').then((res) => {
      const pro = !!(res as { credits?: { pro?: boolean } } | null)?.credits?.pro
      setIsPro(pro)
      if (pro) loadSub()
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isLoggedIn, router, user?.id])

  // Load the current résumé's meta so the card reflects what's already on file.
  useEffect(() => {
    if (!ready || !isLoggedIn) return
    ResumeStore.load(user?.id, isLoggedIn)
      .then(data => { if (data) setResumeMeta({ fileName: data.fileName, wordCount: data.wordCount }) })
      .catch(() => {})
  }, [ready, isLoggedIn, user?.id])

  // Add / replace the résumé — the SAME canonical upload path as the Résumé-AI page
  // (parseResumeFile → /api/resume parse → ResumeStore.save), never a fork. Passing the city
  // fires the server's background résumé→jobs match at the user's location (non-blocking,
  // cooldown + budget guarded), so the Jobs page "Matched to your résumé" rail fills itself.
  async function onResumeFile(file: File) {
    setResumeBusy(true); setResumeMsg('')
    try {
      // Parsing is FREE (RESUME_PARSE_COST = 0 — no model call), so there is no credit path here.
      const r = await parseResumeFile(file, { location: (city || initCity || '').trim() })
      if (r.ok && r.text) {
        await ResumeStore.save(r.text, r.fileName, r.wordCount || 0, user?.id, isLoggedIn)
        setResumeMeta({ fileName: r.fileName, wordCount: r.wordCount || 0 })
        setResumeMsg('Résumé saved — we’re matching jobs to it now. See them on the Jobs page.')
        setResumeMsgOk(true)
        window.dispatchEvent(new Event('seen:credits-updated'))
      } else {
        setResumeMsg(r.error || 'Could not read this file. Try a PDF, Word, or .txt export.')
        setResumeMsgOk(false)
      }
    } catch { setResumeMsg('Upload failed — please try again.'); setResumeMsgOk(false) }
    setResumeBusy(false)
  }

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

  // Instant, offline city suggestions — filters the bundled US_CITIES list locally instead of
  // hitting a slow public geocoder (Nominatim) on every keystroke.
  function onCityInput(val: string) {
    touched.current.city = true
    setCity(val)
    if (val.trim().length < 2) { setCitySuggs([]); setShowCitySuggs(false); return }
    const results: LocResult[] = matchCities(val, 6).map(display => ({ display }))
    setCitySuggs(results)
    setShowCitySuggs(results.length > 0)
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
    // This device only (scope 'local'). The default scope is GLOBAL and signed the user out of
    // every device at once — "Sign out of all devices" below is the explicit version of that.
    markIntentionalSignOut()
    await supabase.auth.signOut({ scope: 'local' })
    try { localStorage.removeItem('seen_last_page') } catch {}
    router.replace('/')
  }

  const [signingOutAll, setSigningOutAll] = useState(false)
  async function signOutEverywhere() {
    if (!confirm('Sign out of Seen on every device, including this one? You can sign back in right away.')) return
    setSigningOutAll(true)
    markIntentionalSignOut()
    // scope 'global' revokes every refresh token for the account; other devices see a 401 on their
    // next sync and get the "session expired" message instead of a silently empty tracker.
    await supabase.auth.signOut({ scope: 'global' })
    try { localStorage.removeItem('seen_last_page') } catch {}
    router.replace('/login')
  }

  // Opens the Stripe Billing Portal (payment method, invoices, cancel) and returns here.
  async function openBillingPortal() {
    setPortalBusy(true); setSubMsg('')
    try {
      const r = await fetch('/api/stripe?action=portal', { method: 'POST', headers: await aiHeaders(), body: JSON.stringify({ return: '/profile#plan' }) })
      const d = await r.json().catch(() => ({})) as { url?: string | null; error?: string }
      if (d?.url) { window.location.href = d.url; return }
      setSubMsg(d?.error || 'Could not open the billing portal — try again or email hello@seenjobs.io')
    } catch {
      setSubMsg('Network error — please try again')
    }
    setPortalBusy(false)
  }

  // Runs after the typed DELETE confirmation (components/profile/DeleteAccountDialog). The handler
  // (api/user-sync.js delete_account) first cancels any live Stripe subscription (and deletes nothing if
  // it cannot), then removes every row keyed to the user and the auth user.
  async function deleteAccount() {
    setDeleting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/user-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'delete_account' }),
      })
      if (!r.ok) throw new Error(`delete_account ${r.status}`)
      markIntentionalSignOut()
      await supabase.auth.signOut({ scope: 'local' })
      router.replace('/')
    } catch (e) {
      setDeleting(false)
      throw e // the dialog shows "nothing was removed — try again"
    }
  }

  const initial = (name || user?.email || 'S').trim().charAt(0).toUpperCase()
  const lvl: Record<string, string> = { entry: 'Entry level', mid: 'Mid level', senior: 'Senior', lead: 'Lead / Staff' }
  const discard = () => { touched.current = { name: false, city: false, experience: false }; setName(initName); setCity(initCity); setExperience(initExperience); setSaveMsg('') }

  return (
    <div className="page-full">
      <div className={styles.wrap}>
        <PageHeader
          eyebrow="Account"
          tone="indigo"
          title="Settings"
          crumbLabel="Settings"
          sub="Your profile, résumé, security and plan — one place. Changes save when you say so."
        />

        <div className={styles.layout}>
          {/* ── Left rail: who you are + jump links ── */}
          <aside className={styles.rail}>
            <div className={styles.me}>
              <div className={styles.avatar}>{initial}</div>
              <div className={styles.meT}>
                <div className={styles.meName}>{name || 'Your name'}</div>
                <div className={styles.meMail}>{user?.email}</div>
                <span className={`${styles.plan} ${isPro ? styles.planPro : styles.planFree}`}>{isPro ? '★ Seen Pro' : 'Free plan'}</span>
              </div>
            </div>
            {/* div, not <nav>: globals.css styles every nav element as the fixed site bar */}
            <div className={styles.jumps} role="navigation" aria-label="Settings sections">
              <a href="#profile" className={styles.jump}><span>👤</span>Profile</a>
              <a href="#resume" className={styles.jump}><span>📄</span>Résumé</a>
              <a href="#security" className={styles.jump}><span>🔒</span>Security</a>
              <a href="#plan" className={styles.jump}><span>◈</span>Plan &amp; billing</a>
              <a href="#danger" className={`${styles.jump} ${styles.jumpDanger}`}><span>⚠</span>Delete account</a>
            </div>
          </aside>

          <div className={styles.col}>
            {/* ── Profile ── */}
            <section id="profile" className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <div className={styles.eyebrow}>Profile</div>
                  <h2 className={styles.cardT}>About you</h2>
                  <p className={styles.cardS}>Your name greets you on the dashboard; your city and level shape the Jobs page.</p>
                </div>
              </div>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="pf-name">First name</label>
                  {loaded ? <input id="pf-name" className={styles.input} type="text" autoComplete="given-name" value={name} onChange={e => { touched.current.name = true; setName(e.target.value) }} placeholder="Your first name" /> : <div className={styles.skeleton} />}
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="pf-email">Email</label>
                  <input id="pf-email" className={styles.input} type="email" value={user?.email || ''} disabled />
                </div>
                <div className={styles.field} style={{ position: 'relative' }} ref={cityContainerRef}>
                  <label className={styles.label} htmlFor="pf-city">Your city</label>
                  {loaded ? (
                    <input
                      id="pf-city"
                      className={styles.input}
                      type="text"
                      autoComplete="off"
                      value={city}
                      onChange={e => onCityInput(e.target.value)}
                      onFocus={() => { if (citySuggs.length) setShowCitySuggs(true) }}
                      placeholder="e.g. Los Angeles, CA"
                    />
                  ) : <div className={styles.skeleton} />}
                  {showCitySuggs && citySuggs.length > 0 && (
                    <div className={styles.suggs}>
                      {citySuggs.map((s, i) => (
                        <div key={i} className={styles.sugg} onMouseDown={e => { e.preventDefault(); setCity(s.display); setShowCitySuggs(false) }}>{s.display}</div>
                      ))}
                    </div>
                  )}
                  <div className={styles.hint}>Auto-loads nearby listings on the Jobs page.</div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="pf-level">Experience level</label>
                  {loaded ? (
                    <select id="pf-level" className={styles.select} value={experience} onChange={e => { touched.current.experience = true; setExperience(e.target.value) }}>
                      <option value="">Select a level</option>
                      <option value="entry">Entry level (0–2 yrs)</option>
                      <option value="mid">Mid level (3–6 yrs)</option>
                      <option value="senior">Senior (7+ yrs)</option>
                      <option value="lead">Lead / Staff</option>
                    </select>
                  ) : <div className={styles.skeleton} />}
                  <div className={styles.hint}>{experience ? `Jobs suggests a ${lvl[experience] || experience} filter when it fits.` : 'Jobs can suggest a level filter for you.'}</div>
                </div>
              </div>
              {saveMsg && <div className={`${styles.msg} ${saveMsgOk ? styles.ok : styles.err}`}>{saveMsg}</div>}
            </section>

            {/* ── Résumé — add / replace here, not only inside Résumé AI ── */}
            <section id="resume" className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <div className={styles.eyebrow}>Résumé</div>
                  <h2 className={styles.cardT}>{resumeMeta ? 'On file' : 'Add your résumé'}</h2>
                  <p className={styles.cardS}>One upload powers job matching, your fit score and rewrites in Résumé AI.</p>
                </div>
              </div>
              {resumeMeta && (
                <div className={styles.file}>
                  <div className={styles.fileIco}>📄</div>
                  <div style={{ minWidth: 0 }}>
                    <div className={styles.fileName}>{resumeMeta.fileName}</div>
                    <div className={styles.fileMeta}>✓ {resumeMeta.wordCount.toLocaleString()} words · matched to jobs</div>
                  </div>
                </div>
              )}
              <div className={styles.btnRow}>
                <button type="button" className={resumeMeta ? styles.ghost : styles.primary} onClick={() => resumeFileRef.current?.click()} disabled={resumeBusy}>
                  {resumeBusy ? 'Uploading…' : resumeMeta ? 'Replace résumé' : 'Upload résumé →'}
                </button>
                <button type="button" className={styles.ghost} onClick={() => router.push('/resume')}>Open Résumé AI →</button>
                <button type="button" className={styles.ghost} onClick={() => router.push('/resume/studio')}>✦ Résumé Studio →</button>
              </div>
              <input
                ref={resumeFileRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.md,text/plain"
                onChange={e => { const f = e.target.files?.[0]; if (f) onResumeFile(f); e.target.value = '' }}
                style={{ display: 'none' }}
              />
              <div className={styles.hint}>PDF, Word or .txt. {RESUME_PARSE_COST === 0 ? 'Free — no AI credit used.' : `Parsing uses ${RESUME_PARSE_COST} AI credit.`}</div>
              {resumeMsg && <div className={`${styles.msg} ${resumeMsgOk ? styles.ok : styles.err}`}>{resumeMsg}</div>}
            </section>

            {/* ── Security ── */}
            <section id="security" className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <div className={styles.eyebrow}>Security</div>
                  <h2 className={styles.cardT}>Sign-in &amp; password</h2>
                </div>
              </div>
              <div className={styles.row}>
                <div>
                  <div className={styles.rowT}>Change password</div>
                  <div className={styles.rowS}>We email you a reset link (a link to open, not a code), then you set the new one here. Signed out and locked out? The sign-in page&apos;s “Forgot password?” sends an 8-digit code instead.</div>
                </div>
                <button type="button" className={styles.ghost} onClick={sendResetLink} disabled={linkSending}>{linkSending ? 'Sending…' : linkSent ? 'Resend link' : 'Send link →'}</button>
              </div>
              {linkSent && <div className={`${styles.msg} ${styles.info}`}>✓ Link sent — open it from your email, then set your new password below.</div>}
              {showPassForm && (
                <div className={styles.sub}>
                  <div className={styles.grid2}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="pf-pass">New password</label>
                      <input id="pf-pass" className={styles.input} type="password" autoComplete="new-password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Min 8 characters" />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="pf-pass2">Confirm new password</label>
                      <input id="pf-pass2" className={styles.input} type="password" autoComplete="new-password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Confirm password" />
                    </div>
                  </div>
                  {passMsg && <div className={`${styles.msg} ${passMsgOk ? styles.ok : styles.err}`}>{passMsg}</div>}
                  <div className={styles.btnRow} style={{ marginTop: '0.9rem' }}>
                    <button type="button" className={styles.primary} onClick={updatePassword} disabled={updatingPass}>{updatingPass ? 'Updating…' : 'Update password →'}</button>
                    <button type="button" className={styles.ghost} onClick={() => { setShowPassForm(false); setPassMsg('') }}>Cancel</button>
                  </div>
                </div>
              )}
              {!showPassForm && passMsg && <div className={`${styles.msg} ${passMsgOk ? styles.ok : styles.err}`}>{passMsg}</div>}
              <div className={styles.row}>
                <div>
                  <div className={styles.rowT}>Sign out of Seen</div>
                  <div className={styles.rowS}>On this device. Your applications stay synced to your account.</div>
                </div>
                <button type="button" className={`${styles.ghost} ${styles.danger}`} onClick={signOut}>Sign out</button>
              </div>
              <div className={styles.row}>
                <div>
                  <div className={styles.rowT}>Sign out of all devices</div>
                  <div className={styles.rowS}>Ends every session on every phone and computer — use it if you signed in somewhere you don’t control.</div>
                </div>
                <button type="button" className={`${styles.ghost} ${styles.danger}`} onClick={signOutEverywhere} disabled={signingOutAll}>{signingOutAll ? 'Signing out…' : 'Sign out everywhere'}</button>
              </div>
            </section>

            {/* ── Plan & billing ── */}
            <section id="plan" className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <div className={styles.eyebrow}>Plan &amp; billing</div>
                  <h2 className={styles.cardT}>{isPro ? 'Seen Pro' : 'Free plan'}</h2>
                </div>
              </div>
              {isPro ? (
                <>
                  <div className={styles.planCard}>
                    <div>
                      <div className={styles.planName}>Seen Pro</div>
                      <div className={styles.planMeta}>
                        {sub?.amount != null ? `$${sub.amount}/${sub.interval === 'year' ? 'yr' : 'mo'}` : 'Active'}
                        {sub?.current_period_end ? (sub.cancel_at_period_end
                          ? ` · ends ${formatPacific(sub.current_period_end, { dateStyle: 'medium' })}`
                          : ` · renews ${formatPacific(sub.current_period_end, { dateStyle: 'medium' })}`) : ''}
                      </div>
                    </div>
                    <span className={`${styles.badge} ${sub?.cancel_at_period_end ? styles.bRed : styles.bGreen}`}>{sub?.cancel_at_period_end ? 'Canceling' : 'Active'}</span>
                  </div>
                  <p className={styles.cardS} style={{ margin: '0 0 1rem' }}>
                    {sub?.cancel_at_period_end
                      ? 'Your membership is set to cancel — you keep Pro until the date above. Change your mind anytime before then.'
                      : 'Renews automatically each billing period until you cancel. Cancel anytime — you keep Pro through the period you’ve already paid for.'}
                  </p>
                  <div className={styles.btnRow}>
                    {sub?.cancel_at_period_end ? (
                      <button type="button" className={styles.primary} onClick={() => manageSubscription('resume_subscription')} disabled={portalLoading}>{portalLoading ? 'Working…' : 'Resume membership'}</button>
                    ) : (
                      <button type="button" className={`${styles.ghost} ${styles.danger}`} onClick={() => manageSubscription('cancel_subscription')} disabled={portalLoading || !sub} title={!sub ? 'No active Stripe subscription on file' : undefined}>{portalLoading ? 'Working…' : 'Cancel membership'}</button>
                    )}
                    {/* Stripe Billing Portal: payment method, invoices, receipts — only once a Stripe customer exists. */}
                    {sub && (
                      <button type="button" className={styles.ghost} onClick={openBillingPortal} disabled={portalBusy}>{portalBusy ? 'Opening…' : 'Manage billing (Stripe) →'}</button>
                    )}
                    <button type="button" className={styles.ghost} onClick={() => router.push('/pricing')}>Plans &amp; credits</button>
                  </div>
                  {sub && <div className={styles.hint}>Manage billing opens Stripe’s portal for your card, invoices and receipts, then returns here.</div>}
                  {subMsg && <div className={`${styles.msg} ${styles.info}`}>{subMsg}</div>}
                </>
              ) : (
                <>
                  <div className={styles.planCard}>
                    <div>
                      <div className={styles.planName}>Free</div>
                      <div className={styles.planMeta}>{FREE_DAILY_CREDITS} AI credit a day (resets at {CREDIT_RESET_LABEL}) · every company grade and the tracker, always free</div>
                    </div>
                    <span className={`${styles.badge} ${styles.bDim}`}>Current</span>
                  </div>
                  <p className={styles.cardS} style={{ margin: '0 0 1rem' }}>Seen Pro is {proPriceLine()} — unlimited AI credits and deeper company analysis. It starts with a free trial and no card; if you subscribe, it renews until you cancel, and the cancel button appears right here.</p>
                  <div className={styles.btnRow}>
                    <button type="button" className={styles.primary} onClick={() => router.push('/pricing')}>See Pro plans →</button>
                  </div>
                </>
              )}
              <div className={styles.fine}>See the <a href="/terms#billing">Subscription Terms</a> for renewal, cancellation and refund details.</div>
            </section>

            {/* ── Danger zone ── */}
            <section id="danger" className={`${styles.card} ${styles.dangerCard}`}>
              <div className={styles.cardHead}>
                <div>
                  <div className={styles.eyebrow} style={{ color: '#f87185' }}>Danger zone</div>
                  <h2 className={styles.cardT}>Delete your account</h2>
                  <p className={styles.cardS}>Permanently removes your profile, résumé, applications, saved jobs and credits (including purchased ones — not refunded). Reports you submitted stay published with no link to you. There is no undo.</p>
                </div>
              </div>
              <button type="button" className={`${styles.ghost} ${styles.danger}`} onClick={() => setConfirmDelete(true)} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete my account'}</button>
            </section>
            {confirmDelete && (
              <DeleteAccountDialog
                email={user?.email || ''}
                subscription={isPro && sub ? { status: sub.status, cancel_at_period_end: sub.cancel_at_period_end } : null}
                onConfirm={deleteAccount}
                onClose={() => { if (!deleting) setConfirmDelete(false) }}
              />
            )}
          </div>
        </div>

        {/* ── Unsaved changes: floats in the moment a field differs from what's saved ── */}
        {isDirty && (
          <div className={styles.saveBar} role="status">
            <span className={styles.saveT}><b>Unsaved changes</b> · name, city or level</span>
            <button type="button" className={styles.ghost} onClick={discard} disabled={saving}>Discard</button>
            <button type="button" className={styles.primary} onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
