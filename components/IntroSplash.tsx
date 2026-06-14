'use client';

import { useEffect, useRef } from 'react';

export default function IntroSplash() {
  const splashRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Only show on first visit
    try {
      if (localStorage.getItem('seen_intro_shown')) return;
    } catch {}

    const splash = splashRef.current;
    const canvas = canvasRef.current;
    if (!splash || !canvas) return;

    splash.style.display = 'flex';

    // ── Canvas setup ──
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const W = 220, H = 72;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(DPR, DPR);

    const TARGETS = ['S', 'E', 'E', 'N'];
    const FS = 44;
    const COL = 52;
    const ox = (W - COL * TARGETS.length) / 2 + COL / 2;
    const oy = H / 2;
    const POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    const PL = POOL.length;
    const LOCK = [0.30, 0.48, 0.66, 0.84];
    const CH = FS * 1.15;

    const col = TARGETS.map((_, i) => {
      const tIdx = POOL.indexOf(TARGETS[i]);
      return {
        scrollPos: Math.floor(Math.random() * PL) * CH,
        locked: false,
        lockTime: -1,
        targetIdx: tIdx >= 0 ? tIdx : 0,
      };
    });

    let t0: number | null = null;
    let prevTs: number | null = null;
    let rafId: number;

    function draw(t: number, dt: number) {
      ctx.clearRect(0, 0, W, H);
      const fa = Math.min(1, t / 0.04);

      TARGETS.forEach((target, i) => {
        const x = ox + i * COL;
        const isLocked = t >= LOCK[i];

        if (!isLocked) {
          const toGo = LOCK[i] - t;
          const speed = toGo > 0.28 ? CH * 22 : CH * 22 * Math.pow(toGo / 0.28, 2);
          col[i].scrollPos += speed * (dt || 1 / 60);
        } else if (!col[i].locked) {
          col[i].locked = true;
          col[i].lockTime = t;
          const nearest = Math.round(col[i].scrollPos / CH);
          const phase = ((nearest % PL) + PL) % PL;
          const steps = ((col[i].targetIdx - phase) + PL) % PL;
          col[i].scrollPos = (nearest + steps) * CH;
        }

        // Slot background
        ctx.save();
        ctx.globalAlpha = fa * 0.15;
        ctx.fillStyle = '#818cf8';
        ctx.fillRect(x - COL / 2 + 5, oy - FS * 0.57, COL - 10, FS * 1.14);
        ctx.restore();

        // Clip to slot
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - COL / 2 + 4, oy - FS * 0.59, COL - 8, FS * 1.18);
        ctx.clip();
        ctx.font = `800 ${FS}px 'Syne',sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (!isLocked) {
          const sp = col[i].scrollPos;
          const baseIdx = Math.floor(sp / CH);
          const offset = sp % CH;
          for (let d = -1; d <= 1; d++) {
            const ci = ((baseIdx + d) % PL + PL) % PL;
            const charY = oy - offset + d * CH;
            const dist = Math.abs(charY - oy);
            const alpha = Math.max(0, 1 - dist / CH) * 0.65;
            ctx.globalAlpha = fa * alpha;
            ctx.fillStyle = '#c4b5fd';
            ctx.fillText(POOL[ci], x, charY);
          }
        } else {
          const le = t - col[i].lockTime;
          let letterY = oy;
          if (le < 0.24) {
            const bp = le / 0.24;
            letterY = oy + Math.sin(bp * Math.PI * 1.7) * 3.5 * (1 - bp);
          }
          if (le < 0.08) {
            ctx.shadowBlur = 22;
            ctx.shadowColor = '#10b981';
            ctx.globalAlpha = fa * 0.55 * (1 - le / 0.08);
            ctx.fillStyle = '#10b981';
            ctx.fillText(target, x, letterY);
            ctx.shadowBlur = 0;
            ctx.globalAlpha = fa;
            ctx.fillStyle = '#10b981';
          } else {
            ctx.globalAlpha = fa;
            ctx.fillStyle = '#f4f4f5';
            if (le < 0.48) {
              ctx.shadowBlur = Math.max(0, 9 * (1 - (le - 0.08) / 0.40));
              ctx.shadowColor = 'rgba(167,139,250,0.7)';
            }
          }
          ctx.fillText(target, x, letterY);
          ctx.shadowBlur = 0;
        }
        ctx.restore();

        // Column separator
        if (i < TARGETS.length - 1) {
          ctx.globalAlpha = fa * 0.1;
          ctx.strokeStyle = '#6b7280';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(x + COL / 2, oy - FS * 0.43);
          ctx.lineTo(x + COL / 2, oy + FS * 0.43);
          ctx.stroke();
        }
      });

      // Green dot after all letters lock
      const allDone = t >= LOCK[3] + 0.24;
      if (allDone) {
        const da = Math.min(1, (t - LOCK[3] - 0.24) / 0.28);
        ctx.globalAlpha = fa * da;
        ctx.fillStyle = '#10b981';
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#10b981';
        ctx.beginPath();
        ctx.arc(W / 2, oy + FS * 0.61, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    function tick(ts: number) {
      if (!t0) t0 = ts;
      const dt = prevTs ? Math.min((ts - prevTs) / 1000, 0.033) : 1 / 60;
      prevTs = ts;
      const t = (ts - t0) / 1000;
      draw(t, dt);
      if (t < 2.8) {
        rafId = requestAnimationFrame(tick);
      } else {
        draw(2.8, 0);
      }
    }

    document.fonts.ready.then(() => {
      rafId = requestAnimationFrame(tick);
    });

    // Hide splash after minimum 2.4s
    const splashT0 = Date.now();
    const hideSplash = () => {
      if (!splash || splash.dataset.gone) return;
      splash.dataset.gone = '1';
      const elapsed = Date.now() - splashT0;
      const delay = Math.max(0, 2400 - elapsed);
      setTimeout(() => {
        splash.classList.add('sp-out');
        setTimeout(() => {
          if (splash.parentNode) splash.parentNode.removeChild(splash);
        }, 600);
      }, delay);
      try { localStorage.setItem('seen_intro_shown', '1'); } catch {}
    };

    // Safety net — hide after 4s
    const safetyTimer = setTimeout(hideSplash, 4000);

    // Hide when page is interactive
    if (document.readyState === 'complete') {
      hideSplash();
    } else {
      window.addEventListener('load', hideSplash, { once: true });
    }

    return () => {
      clearTimeout(safetyTimer);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      id="introSplash"
      ref={splashRef}
      aria-hidden="true"
      style={{ display: 'none' }}
    >
      <div className="sp-beam" />
      <canvas ref={canvasRef} id="splashCanvas" width={220} height={72} />
      <div className="sp-sub">Know before you apply</div>
      <div className="sp-track"><div className="sp-fill" /></div>
    </div>
  );
}
