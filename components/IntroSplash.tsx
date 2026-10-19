'use client';

import { useState, useEffect, memo } from 'react';

type Phase = 'hidden' | 'in' | 'out';

// ── Timing (ms) ──────────────────────────────────────────────────────────────
// The wordmark is on screen for SHOW, then the cover opens top-to-bottom over EXIT while
// the page's entrance choreography is ALREADY running underneath (pages gate on
// useIntroGate, which flips the moment the cover starts opening). Total ≈ 1.4s — the
// previous canvas slot-machine held the first impression for 3s.
const SHOW = 820;
const EXIT = 600;
// Don't let the letters rise on a fallback face: give the display font a beat to arrive
// (cached fonts resolve instantly; a cold load waits at most this long under the cover).
const FONT_WAIT = 320;

// Splash→page handoff: pages gate their entrance choreography on this (see
// lib/hooks/useIntroGate.ts) so hero animations begin exactly as the splash
// opens — never invisibly behind it, never abruptly after it.
function markIntroDone() {
  try {
    if (window.__seenIntroDone) return
    window.__seenIntroDone = true
    window.dispatchEvent(new Event('seen:intro-done'))
  } catch { /* never let the handoff break the splash */ }
}

function IntroSplashInner() {
  const [phase, setPhase] = useState<Phase>('hidden');

  // Check sessionStorage once on mount — don't show on repeat visits in the same session.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('seen_intro_shown')) {
        // Repeat visitor: fade the guard out and skip the intro entirely
        const guard = document.getElementById('intro-guard')
        if (guard) {
          guard.style.transition = 'opacity 0.18s ease'
          guard.style.opacity = '0'
          // Hide (don't .remove()) — see note in the phase==='in' effect below.
          setTimeout(() => { guard.style.display = 'none' }, 200)
        }
        markIntroDone() // repeat visit: page entrance runs immediately
        return
      }
    } catch {}

    let cancelled = false
    let started = false
    const begin = () => {
      if (started || cancelled) return
      started = true
      setPhase('in')
    }
    let fontLoad: Promise<unknown> | null = null
    try { fontLoad = document.fonts?.load('800 1em Syne') ?? null } catch { fontLoad = null }
    if (fontLoad && typeof fontLoad.then === 'function') {
      fontLoad.then(begin, begin)
      const t = setTimeout(begin, FONT_WAIT)
      return () => { cancelled = true; clearTimeout(t) }
    }
    begin()
    return () => { cancelled = true }
  }, []);

  // Run the choreography only when phase becomes 'in'
  useEffect(() => {
    if (phase !== 'in') return;
    // Splash is now in the DOM — hide the static guard.
    // IMPORTANT: never .remove() it. The #intro-guard node is rendered by React
    // in the root layout, so deleting it out from under React corrupts the fiber
    // tree; the next commit's insertBefore() then throws a DOMException and
    // white-screens every page on first load (notably iOS Safari). Hiding keeps
    // the node in the tree, so React's sibling pointers stay valid.
    const introGuard = document.getElementById('intro-guard');
    if (introGuard) introGuard.style.display = 'none';

    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const show = reduced ? 420 : SHOW
    const exit = reduced ? 320 : EXIT

    const hideTimer = setTimeout(() => {
      try { sessionStorage.setItem('seen_intro_shown', '1'); } catch {}
      setPhase('out');
      markIntroDone(); // page entrance rises WHILE the cover opens
      // Nested on purpose: this effect's cleanup runs when phase flips to 'out', and the
      // unmount timer must survive that.
      setTimeout(() => setPhase('hidden'), exit);
    }, show);

    return () => clearTimeout(hideTimer);
  }, [phase]);

  // Not visible — not in DOM at all (React can't interfere)
  if (phase === 'hidden') return null;

  return (
    <div
      id="introSplash"
      className={phase === 'out' ? 'sp-out' : ''}
      aria-hidden="true"
    >
      <div className="sp-mark">
        {['S', 'e', 'e', 'n'].map((ch, i) => (
          <span key={i} className="sp-c"><span className="sp-l">{ch}</span></span>
        ))}
        <span className="sp-dot" />
      </div>
      <div className="sp-rule" />
      <div className="sp-tag">Know before you apply</div>
    </div>
  );
}

export default memo(IntroSplashInner);
