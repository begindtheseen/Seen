// Chronos cloud bridge (client) — how the seen `chronos` MCP server reaches the ALWAYS-ON online brain
// so a cloud repo-connected session can query AND write Chronos without the Mac running. Two transports,
// auto-selected (see resolveCloud() in memory/mcp/server.mjs for when cloud mode engages):
//
//   • GATEWAY (what cloud/web sessions use): POST BRAIN_API_URL with the deployment bearer, exact
//     BRAIN_CLIENT, and a unique BRAIN_CLIENT_TOKEN. The session NEVER holds the Supabase service key. The gateway
//     (seen/api/brain.js) runs server-side on seenjobs.io where the key already lives, and exposes
//     brain-only ops. A leaked token is brain-scoped and revocable; the product DB is never exposed.
//   • DIRECT (Mac / trusted env that already holds the service key): talk to Supabase via brainStore.js.
//
// Offline files never touch GitHub — the brain is reached only through these private, credentialed
// channels. Dependency-free (fetch).

import { fileURLToPath } from 'node:url';
import * as store from './brainStore.js';

const env = (k) => { const v = process.env[k]; return v && v.trim() ? v.trim() : null; };
const gwUrl = () => (env('BRAIN_API_URL') || '').replace(/\/+$/, '');
const gwToken = () => env('BRAIN_API_TOKEN');
const gwClientToken = () => env('BRAIN_CLIENT_TOKEN');
const gwIdentity = () => env('BRAIN_CLIENT');

export const gatewaySelected = () => !!(gwUrl() || gwToken() || gwClientToken() || gwIdentity());
export const gatewayConfigured = () => !!(gwUrl() && gwToken() && gwClientToken() && gwIdentity());
// URL/token are explicit gateway selectors. Once either is present, incomplete configuration must
// fail closed rather than silently inheriting a co-located service-role direct transport.
export const cloudConfigured = () => gatewaySelected() ? gatewayConfigured() : store.serviceConfigured();

function useGateway() {
  if (!gatewaySelected()) return false;
  const missing = [
    !gwUrl() && 'BRAIN_API_URL', !gwToken() && 'BRAIN_API_TOKEN',
    !gwClientToken() && 'BRAIN_CLIENT_TOKEN', !gwIdentity() && 'BRAIN_CLIENT',
  ].filter(Boolean);
  if (missing.length) throw new Error(`Chronos gateway configuration incomplete: missing ${missing.join(', ')}`);
  return true;
}

async function gw(op, payload = {}) {
  const by = gwIdentity();
  if (!by) throw new Error('Identify yourself: set BRAIN_CLIENT before using the Chronos brain gateway.');
  const res = await fetch(gwUrl(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${gwToken()}`,
      'x-chronos-client-token': gwClientToken(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ op, by, ...payload }),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok || (body && body.ok === false)) {
    throw new Error(`brain gateway ${op} → ${res.status}: ${(body && body.error) || text.slice(0, 200)}`);
  }
  return body || {};
}

// READ: all vault notes ({ path, text }) for buildIndex — via gateway or direct.
export async function fetchNotes() {
  if (useGateway()) return (await gw('notes')).notes || [];
  return store.fetchNotes();
}

// WRITE: record a bi-temporal fact (supersede-safe) — via gateway or direct.
export async function recordFactCloud(fact, { note } = {}) {
  if (useGateway()) return gw('record_fact', { fact, note });
  return store.recordFact(fact, { note });
}

// WRITE: append a dated timeline episode — via gateway or direct.
export async function appendTimelineCloud(date, heading, text) {
  if (useGateway()) return gw('append_timeline', { date, heading, text });
  return store.appendTimeline(date, heading, text);
}

export async function cloudCounts() {
  if (useGateway()) return (await gw('counts')).counts;
  return store.counts();
}

// CLI:  node lib/server/brainCloud.js   → prints brain counts through whichever transport is configured.
// This is the connectivity self-test once all four identity-gateway values are set.
const isMain = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (!cloudConfigured()) {
    console.error('brain bridge not configured — set BRAIN_API_URL+BRAIN_API_TOKEN+BRAIN_CLIENT+BRAIN_CLIENT_TOKEN (gateway) or SUPABASE_URL+SUPABASE_SERVICE_KEY (direct)');
    process.exit(1);
  }
  cloudCounts()
    .then((c) => console.log(JSON.stringify({ transport: gatewayConfigured() ? 'gateway' : 'direct', cloud: c }, null, 2)))
    .catch((e) => { console.error(`brain bridge status failed: ${e.message}`); process.exit(1); });
}
