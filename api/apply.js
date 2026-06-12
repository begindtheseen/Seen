import { rateLimit } from '../lib/server/ratelimit.js';

function toBase64(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}

// Build a clean, styled HTML resume from extracted text + optimization data
function buildResumeHTML(text, name, role, company, optimizedBullets = [], keywords = [], wasOptimized = false) {
  if (!text || text.length < 50) return null;

  const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const displayName = name || lines[0] || 'Applicant';

  // First few lines that look like contact info (email, phone, city/state, LinkedIn)
  const contactLines = [];
  let bodyStart = 1;
  for (let i = 1; i < Math.min(7, lines.length); i++) {
    const l = lines[i];
    const isContact = /@/.test(l) || /\d{3}[\-\.\s\(]\d{3}/.test(l) ||
      /^[A-Za-z\s]+,\s*[A-Z]{2}/.test(l) || /linkedin\.com|github\.com/i.test(l) ||
      /^[\w\s,·\-\.\(\)@+]+$/.test(l) && l.length < 80;
    if (isContact) { contactLines.push(l); bodyStart = i + 1; }
    else if (contactLines.length > 0 && l.length < 100 && !/[A-Z]{3,}/.test(l)) {
      contactLines.push(l); bodyStart = i + 1;
    } else { break; }
  }

  // Section header: ALL CAPS, short, no lowercase
  const isSectionHeader = l => /^[A-Z][A-Z\s&\/\-]{2,}$/.test(l) && l.length < 50;

  // Job entry line: has em-dash or pipe AND a year/month/present keyword
  const isJobLine = l =>
    /(—|–|\|)/.test(l) &&
    /(19|20)\d{2}|present|current|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i.test(l);

  // Parse into named sections
  const sections = [];
  let current = null;
  for (let i = bodyStart; i < lines.length; i++) {
    const l = lines[i];
    if (isSectionHeader(l)) {
      if (current) sections.push(current);
      current = { title: l, lines: [] };
    } else {
      if (!current) current = { title: 'SUMMARY', lines: [] };
      current.lines.push(l);
    }
  }
  if (current && current.lines.length) sections.push(current);

  function formatSection(title, sectionLines) {
    // Summary/About: render as a styled blockquote, not a list
    if (/^(SUMMARY|ABOUT|PROFILE|OBJECTIVE|OVERVIEW)/.test(title)) {
      return sectionLines.map(l => `<p class="sum">${esc(l)}</p>`).join('');
    }

    let html = '';
    let inJob = false;
    let bulletBuffer = [];

    const flushBullets = () => {
      if (bulletBuffer.length) {
        html += `<ul class="bl">${bulletBuffer.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`;
        bulletBuffer = [];
      }
    };

    for (const l of sectionLines) {
      const hasBulletChar = /^[•·\-\*→]\s/.test(l);
      const isJobMeta = isJobLine(l);

      if (isJobMeta) {
        flushBullets();
        if (inJob) html += '</div>';
        const parts = l.split(/—|–|\|/).map(p => p.trim()).filter(Boolean);
        const jobTitle = parts[0] || '';
        const jobMeta = parts.slice(1).join(' · ');
        html += `<div class="je"><div class="jt">${esc(jobTitle)}</div>${jobMeta ? `<div class="jm">${esc(jobMeta)}</div>` : ''}`;
        inJob = true;
      } else if (hasBulletChar) {
        bulletBuffer.push(l.replace(/^[•·\-\*→]\s*/, '').trim());
      } else if (inJob) {
        // Inside a job entry, treat all non-meta lines as bullet points —
        // extracted resume text rarely preserves bullet chars, so every
        // responsibility/achievement line is an implicit bullet.
        bulletBuffer.push(l);
      } else {
        flushBullets();
        html += `<p>${esc(l)}</p>`;
      }
    }
    flushBullets();
    if (inJob) html += '</div>';
    return html;
  }

  const highlightSection = wasOptimized && optimizedBullets.length ? `
    <div class="hl-box">
      <div class="hl-title">Tailored for ${esc(role)} at ${esc(company)}</div>
      <ul class="bl hl-bl">
        ${optimizedBullets.slice(0, 5).map(b => `<li>${esc(b.optimized || b)}</li>`).join('')}
      </ul>
      ${keywords.length ? `<div class="kws">${keywords.slice(0, 8).map(k => `<span class="kw">${esc(k)}</span>`).join('')}</div>` : ''}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(displayName)} · ${esc(role)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Georgia,'Times New Roman',serif;max-width:760px;margin:0 auto;padding:48px 44px;color:#111;background:#fff;font-size:14px;line-height:1.6}
.hdr{padding-bottom:18px;margin-bottom:24px;border-bottom:2px solid #111;text-align:center}
.nm{font-size:26px;font-weight:700;letter-spacing:.02em;color:#111;margin-bottom:6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.ct{font-size:12.5px;color:#444;display:flex;flex-wrap:wrap;justify-content:center;gap:0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.ct span+span::before{content:'|';margin-right:16px;color:#bbb}
.badge{display:inline-block;margin-top:8px;font-size:10px;font-family:-apple-system,sans-serif;color:#666;letter-spacing:.06em;text-transform:uppercase}
.hl-box{border:1px solid #d0d0d8;border-radius:6px;padding:14px 18px;margin-bottom:24px;background:#fafafa}
.hl-title{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#444;font-weight:700;margin-bottom:10px;font-family:-apple-system,sans-serif}
.kws{display:flex;flex-wrap:wrap;gap:4px;margin-top:10px}
.kw{background:#efefef;color:#333;border-radius:3px;padding:2px 7px;font-size:10.5px;font-weight:600;font-family:-apple-system,sans-serif}
.sec{margin-bottom:20px}
.st{font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:#111;font-weight:700;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.je{margin-bottom:12px}
.jt{font-size:14px;font-weight:700;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.jm{font-size:12px;color:#555;margin:2px 0 6px;font-style:italic;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.bl{list-style:disc;padding-left:18px}
.bl li{padding:1px 0;color:#222;font-size:13.5px;line-height:1.55}
.hl-bl{list-style:disc;padding-left:18px}
.hl-bl li{font-size:13.5px;color:#222;line-height:1.55;font-family:-apple-system,sans-serif}
p{color:#222;font-size:13.5px;margin-bottom:6px}
.sum{color:#333;font-size:13.5px;line-height:1.7;margin-bottom:0;font-style:italic}
.ft{margin-top:32px;padding-top:12px;border-top:1px solid #ddd;text-align:center;font-size:10.5px;color:#aaa;font-family:-apple-system,sans-serif}
@media print{body{padding:28px 24px}}
</style>
</head>
<body>
<div class="hdr">
  <div class="nm">${esc(displayName)}</div>
  <div class="ct">${contactLines.map(l => `<span>${esc(l)}</span>`).join('')}</div>
  <div class="badge">${wasOptimized ? `Application tailored for ${esc(role)} · Seen` : 'Applied via Seen'}</div>
</div>
${highlightSection}
${sections.map(s => `<div class="sec"><div class="st">${esc(s.title)}</div>${formatSection(s.title, s.lines)}</div>`).join('')}
<div class="ft">Submitted via Seen · seenjobs.io</div>
</body>
</html>`;
}

export default async function handler(req, res) {
  const _o=req.headers.origin||'';
  const _devO=!_o||_o.includes('localhost')||_o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin',(_devO||['https://seenjobs.io','https://www.seenjobs.io'].includes(_o))?(_o||'*'):'https://seenjobs.io');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const { allowed: rlOk } = await rateLimit(req, 'apply');
  if (!rlOk) return res.status(429).json({ error: 'Too many requests — slow down.' });

  try {
    const {
      applicantName, applicantEmail, role, company, location,
      resumeLink, resumeText: rawResumeText, coverNote, applyEmail,
      optimizedBullets = [], keywords = [], wasOptimized = false,
    } = req.body || {};

    // Reject binary/XML artifacts — only use if human-readable
    const isReadable = t => t && t.length > 20 && !/(word\/|\.xml|docProps|rels\/|PK\x03)/.test(t.slice(0, 500));
    const resumeText = isReadable(rawResumeText) ? rawResumeText : null;

    // Build styled HTML resume — falls back to null if no text
    const resumeHTML = buildResumeHTML(resumeText, applicantName, role, company, optimizedBullets, keywords, wasOptimized);
    const resumeAttachment = resumeHTML ? [{
      filename: `${(applicantName || 'Resume').replace(/\s+/g, '_')}_Application.html`,
      content: toBase64(resumeHTML),
    }] : undefined;

    const RESEND_KEY = process.env.RESEND_KEY;
    if (!RESEND_KEY) throw new Error('RESEND_KEY not configured');
    const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'brandon.burnett00123@gmail.com';

    // Top bullets for embedding directly in employer email
    const topBullets = (wasOptimized && optimizedBullets.length)
      ? optimizedBullets.slice(0, 3).map(b => b.optimized || b)
      : [];
    const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const sends = [];

    // 1. Confirmation to applicant
    sends.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Seen <noreply@seenjobs.io>',
        to: [applicantEmail],
        subject: `Application received — ${role} at ${company}`,
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td align="center" style="padding-bottom:28px;">
  <span style="font-size:18px;font-weight:800;color:#111;letter-spacing:-0.03em">Seen</span>
</td></tr>
<tr><td style="background:#fff;border:1px solid #e0e0e8;border-radius:12px;padding:36px 32px;">
  <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#888">Application received</p>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111;line-height:1.2">You applied. We sent it.</h1>
  <p style="margin:0 0 22px;font-size:14px;color:#555;line-height:1.7">Your application for <strong style="color:#111">${esc(role)}</strong> at <strong style="color:#111">${esc(company)}</strong> in ${esc(location)} has been submitted.</p>
  <div style="background:#f8f8fb;border:1px solid #e4e4ec;border-radius:8px;padding:16px 20px;margin-bottom:22px;">
    <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Your application</div>
    <div style="font-size:14px;color:#111;margin-bottom:6px"><strong style="color:#555">Role:</strong> ${esc(role)}</div>
    <div style="font-size:14px;color:#111;margin-bottom:6px"><strong style="color:#555">Company:</strong> ${esc(company)}</div>
    <div style="font-size:14px;color:#111;margin-bottom:6px"><strong style="color:#555">Location:</strong> ${esc(location)}</div>
    <div style="font-size:14px;color:#111"><strong style="color:#555">Resume:</strong> ${resumeHTML ? `✓ Attached${wasOptimized ? ' · Tailored for this role' : ''}` : esc(resumeLink || 'On file')}</div>
    ${coverNote ? `<div style="font-size:14px;color:#111;margin-top:10px;padding-top:10px;border-top:1px solid #e4e4ec"><strong style="color:#555">Your note:</strong> ${esc(coverNote)}</div>` : ''}
  </div>
  <p style="margin:0 0 18px;font-size:13px;color:#888;line-height:1.7">Track this application at <a href="https://seenjobs.io" style="color:#111">seenjobs.io</a>. We'll remind you if you don't hear back within the expected window.</p>
  <div style="background:#f0f0f4;border-radius:8px;padding:14px 18px;font-size:12px;color:#555;line-height:1.65;">
    If you don't hear back in 30 days, come back and report it. Every report helps the next person.
  </div>
</td></tr>
<tr><td align="center" style="padding-top:20px;font-size:11px;color:#aaa;line-height:1.8">
  Applied through Seen · <a href="https://seenjobs.io" style="color:#aaa">seenjobs.io</a>
</td></tr>
</table></td></tr></table>
</body></html>`,
        attachments: resumeAttachment,
      })
    }));

    // 2. Internal notification to Seen admin
    sends.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Seen Applications <noreply@seenjobs.io>',
        to: [NOTIFY_EMAIL],
        reply_to: applicantEmail,
        subject: `New application — ${role} at ${company}`,
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:32px 24px;">
<tr><td>
  <div style="background:#fff;border:1px solid #e0e0e8;border-radius:12px;padding:32px;">
    <div style="margin-bottom:20px;font-size:14px;font-weight:700;color:#111">
      Seen <span style="font-size:11px;font-weight:400;color:#888;margin-left:6px">${wasOptimized ? 'AI-optimized application' : 'New application'}</span>
    </div>
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111">${esc(applicantName)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#666">Applied for <strong style="color:#111">${esc(role)}</strong> at ${esc(company)} · ${esc(location)}</p>

    ${topBullets.length ? `
    <div style="border:1px solid #e0e0e8;border-left:3px solid #111;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:20px;background:#fafafa">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#444;font-weight:700;margin-bottom:10px">Key highlights for this role</div>
      <ul style="list-style:disc;padding-left:18px;margin:0">
        ${topBullets.map(b => `<li style="padding:3px 0;color:#222;font-size:14px;line-height:1.5">${esc(b)}</li>`).join('')}
      </ul>
      ${keywords.length ? `<div style="margin-top:10px">${keywords.slice(0,6).map(k => `<span style="display:inline-block;background:#efefef;color:#333;border-radius:3px;padding:2px 7px;font-size:11px;font-weight:600;margin:2px 3px 2px 0">${esc(k)}</span>`).join('')}</div>` : ''}
    </div>` : ''}

    <div style="background:#f8f8fb;border:1px solid #e4e4ec;border-radius:8px;padding:16px;margin-bottom:20px">
      <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px">Applicant details</div>
      <div style="font-size:14px;color:#111;margin-bottom:6px"><strong>Name:</strong> ${esc(applicantName)}</div>
      <div style="font-size:14px;color:#111;margin-bottom:6px"><strong>Email:</strong> <a href="mailto:${esc(applicantEmail)}" style="color:#1a1aff">${esc(applicantEmail)}</a></div>
      <div style="font-size:14px;color:#111;margin-bottom:6px"><strong>Resume:</strong> ${resumeHTML ? `✓ HTML attachment${wasOptimized ? ' (AI-tailored)' : ''}` : esc(resumeLink || 'On file')}</div>
      ${coverNote ? `<div style="font-size:14px;color:#111;margin-top:10px;padding-top:10px;border-top:1px solid #e4e4ec"><strong>Cover note:</strong><br><span style="color:#444;line-height:1.6">${esc(coverNote)}</span></div>` : ''}
    </div>
    <a href="mailto:${esc(applicantEmail)}?subject=Re: Your application for ${esc(role)} at ${esc(company)}" style="display:inline-block;padding:11px 22px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600">Reply to applicant</a>
  </div>
  <p style="text-align:center;font-size:11px;color:#aaa;margin-top:16px">Seen · seenjobs.io</p>
</td></tr>
</table>
</body></html>`,
        attachments: resumeAttachment,
      })
    }));

    // 3. Forward to company email if provided
    if (applyEmail && applyEmail.includes('@') && applyEmail !== NOTIFY_EMAIL) {
      sends.push(fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Seen Applications <noreply@seenjobs.io>',
          to: [applyEmail],
          reply_to: applicantEmail,
          subject: `Application via Seen — ${role}`,
          html: `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:36px 28px;color:#111;background:#fff">
<p style="font-size:15px;margin:0 0 6px;font-weight:700">${esc(applicantName)}</p>
<p style="font-size:14px;color:#555;margin:0 0 18px">Applied for <strong style="color:#111">${esc(role)}</strong> at ${esc(company)}</p>
<p style="font-size:14px;color:#555;margin:0 0 6px"><strong style="color:#111">Email:</strong> <a href="mailto:${esc(applicantEmail)}" style="color:#1a1aff">${esc(applicantEmail)}</a></p>
${topBullets.length ? `
<div style="border:1px solid #ddd;border-left:3px solid #111;border-radius:0 5px 5px 0;padding:12px 16px;margin:16px 0;background:#fafafa">
  <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#444;font-weight:700;margin-bottom:8px">Most relevant experience</div>
  <ul style="list-style:disc;padding-left:18px;margin:0">${topBullets.map(b => `<li style="padding:3px 0;color:#222;font-size:13.5px;line-height:1.5">${esc(b)}</li>`).join('')}</ul>
</div>` : ''}
${resumeHTML ? `<p style="font-size:14px;color:#555;margin:0 0 6px"><strong style="color:#111">Resume:</strong> See attachment${wasOptimized ? ' (tailored for this role)' : ''}</p>` : ''}
${coverNote ? `<p style="font-size:14px;color:#555;margin:0 0 6px"><strong style="color:#111">Note:</strong> ${esc(coverNote)}</p>` : ''}
<p style="font-size:11px;color:#bbb;margin-top:24px;border-top:1px solid #eee;padding-top:12px">Sent via Seen · seenjobs.io</p>
</body></html>`,
          attachments: resumeAttachment,
        })
      }));
    }

    const results = await Promise.allSettled(sends);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) console.error('Some emails failed:', failed);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Apply error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
