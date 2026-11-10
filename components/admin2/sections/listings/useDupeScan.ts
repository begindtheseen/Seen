'use client'

// The duplicate-listings SCAN. It is a read that can take several requests on a big table: the server
// answers `complete:false` + a `cursor` while it is still reading ("Scanned 61,000 listings so far") and
// the plan (counts + example groups) only on the last round. The core's job manager cannot carry it: a
// scan round changes nothing (`changed:0`), which the manager reads as "no progress" and stops, and it
// keeps no final answer to show. So this hook runs the rounds itself — the same rules as the manager
// (≤2 lost rounds retried in a row, Cancel after the current round, a round cap), and the cursor and the
// finished plan are kept in sessionStorage so a reload offers "Resume the scan" and still shows the plan.
// The section stays mounted when the owner leaves it, so the loop keeps running across sections.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminErr } from '../../contract.ts'
import { useApi } from '../../core/hooks.tsx'
import { readDupePlan, type DupePlan } from './adapter.ts'

export type ScanState = {
  status: 'idle' | 'running' | 'done' | 'error' | 'stopped'
  scanned: number
  rounds: number
  cursor?: string
  plan?: DupePlan
  error?: string
  /** A reload or Cancel stopped it with a cursor: it can carry on from there. */
  resumable?: boolean
  finishedAt?: string
}

const KEY = 'seen_admin_dupe_scan_v1'
const IDLE: ScanState = { status: 'idle', scanned: 0, rounds: 0 }
const TRANSIENT = new Set(['timeout', 'network', 'upstream'])
const MAX_ROUNDS = 200

function load(): ScanState {
  try {
    const s = JSON.parse(window.sessionStorage.getItem(KEY) || 'null') as ScanState | null
    if (!s || typeof s !== 'object') return IDLE
    if (s.status === 'running') return { ...s, status: 'stopped', resumable: !!s.cursor }
    return s
  } catch { return IDLE }
}
function save(s: ScanState) { try { window.sessionStorage.setItem(KEY, JSON.stringify(s)) } catch { /* the resume offer is lost, nothing else */ } }

export function useDupeScan() {
  const api = useApi()
  const [state, setState] = useState<ScanState>(IDLE)
  const [cancelling, setCancelling] = useState(false)
  const cancel = useRef(false)
  const running = useRef(false)
  useEffect(() => { setState(load()) }, [])
  const set = useCallback((s: ScanState) => { save(s); setState(s) }, [])

  const run = useCallback(async (from?: ScanState) => {
    if (running.current) return
    running.current = true
    cancel.current = false
    let s: ScanState = from && from.cursor ? { ...from, status: 'running', error: undefined, resumable: false, plan: undefined } : { ...IDLE, status: 'running' }
    set(s)
    let lost = 0
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (cancel.current) { set({ ...s, status: 'stopped', resumable: !!s.cursor }); return }
        const res = await api<Record<string, unknown>>('job_dupes_scan', s.cursor ? { cursor: s.cursor } : {}, { timeoutMs: 75_000 })
        if (!res.ok) {
          const e = res as AdminErr
          if (TRANSIENT.has(e.code) && lost < 2) { lost += 1; s = { ...s, rounds: s.rounds + 1 }; set(s); await new Promise((r) => setTimeout(r, 1000 * lost)); continue }
          set({ ...s, status: 'error', error: e.error, resumable: !!s.cursor })
          return
        }
        lost = 0
        const scanned = typeof res.scanned === 'number' ? res.scanned : s.scanned
        if (res.complete !== false) {
          set({ status: 'done', scanned, rounds: s.rounds + 1, plan: readDupePlan(res), finishedAt: new Date().toISOString() })
          return
        }
        if (!res.cursor) { set({ ...s, status: 'error', error: 'The server said the scan is not finished but did not say where to continue. Start the scan again.' }); return }
        s = { status: 'running', scanned, rounds: s.rounds + 1, cursor: String(res.cursor) }
        set(s)
      }
      set({ ...s, status: 'stopped', resumable: !!s.cursor, error: `Paused after ${MAX_ROUNDS} rounds.` })
    } finally { running.current = false; setCancelling(false) }
  }, [api, set])

  return {
    state,
    cancelling,
    start: () => { void run() },
    resume: () => { void run(state) },
    cancel: () => { if (running.current) { cancel.current = true; setCancelling(true) } },
    clear: () => { if (!running.current) set(IDLE) },
  }
}
