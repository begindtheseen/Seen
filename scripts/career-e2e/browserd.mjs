// A real Chromium for the e2e, driven over a tiny local HTTP API by the stand-in `opencli`
// (scripts/career-e2e/opencli). All hosts resolve to the fixture server (scripts/career-e2e/sites.mjs).
import http from 'node:http';
import { chromium } from 'playwright-core';
const [, , apiPort, sitePort] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', headless: true,
  args: [`--host-resolver-rules=MAP * 127.0.0.1:${sitePort}`, '--ignore-certificate-errors', '--no-proxy-server'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
let page = null;
const evals = { n: 0, bytes: 0 };
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const cmd = JSON.parse(body || '{}');
  const reply = (code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  try {
    if (cmd.cmd === 'open') { if (!page) page = await ctx.newPage(); await page.goto(cmd.url, { waitUntil: 'load', timeout: 30000 }); return reply(200, { ok: true, data: { url: page.url() } }); }
    if (cmd.cmd === 'eval') { if (!page) throw new Error('no page open'); evals.n++; evals.bytes += cmd.js.length; const v = await page.evaluate(cmd.js); return reply(200, { ok: true, data: v }); }
    if (cmd.cmd === 'close') { if (page) await page.close(); page = null; return reply(200, { ok: true, data: null }); }
    if (cmd.cmd === 'stats') return reply(200, evals);
    reply(400, { ok: false, error: { message: 'unknown command' } });
  } catch (e) { reply(200, { ok: false, error: { message: String(e.message).split('\n')[0] } }); }
}).listen(Number(apiPort), '127.0.0.1', () => console.log('browserd ready'));
