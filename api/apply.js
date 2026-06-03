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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

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
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#07070a;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td align="center" style="padding-bottom:32px;">
  <span style="width:8px;height:8px;border-radius:50%;background:#00ff87;display:inline-block;margin-right:8px;vertical-align:middle"></span>
  <span style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.04em;vertical-align:middle">Seen</span>
</td></tr>
<tr><td style="background:#111114;border:1px solid #1e1e28;border-radius:16px;padding:40px 36px;">
  <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#00ff87;font-family:monospace">application received</p>
  <h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#fff;letter-spacing:-0.03em;line-height:1.1">You applied. We sent it.</h1>
  <p style="margin:0 0 24px;font-size:15px;color:#8888a0;line-height:1.7;font-weight:300">Your application for <strong style="color:#fff">${esc(role)}</strong> at <strong style="color:#fff">${esc(company)}</strong> in ${esc(location)} has been submitted through Seen.</p>
  <div style="background:#1c1c26;border:1px solid #2e2e3e;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
    <div style="font-size:12px;font-family:monospace;color:#454558;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Your application</div>
    <div style="font-size:14px;color:#e4e4f0;margin-bottom:6px"><strong style="color:#9898b0">Role:</strong> ${esc(role)}</div>
    <div style="font-size:14px;color:#e4e4f0;margin-bottom:6px"><strong style="color:#9898b0">Company:</strong> ${esc(company)}</div>
    <div style="font-size:14px;color:#e4e4f0;margin-bottom:6px"><strong style="color:#9898b0">Location:</strong> ${esc(location)}</div>
    <div style="font-size:14px;color:#e4e4f0"><strong style="color:#9898b0">Resume:</strong> ${resumeHTML ? `<span style="color:#00ff87">✓ Attached${wasOptimized ? ' · AI-optimized for this role' : ''}</span>` : `<span>${esc(resumeLink || 'On file')}</span>`}</div>
    ${coverNote ? `<div style="font-size:14px;color:#e4e4f0;margin-top:10px;padding-top:10px;border-top:1px solid #2e2e3e"><strong style="color:#9898b0">Your note:</strong> ${esc(coverNote)}</div>` : ''}
  </div>
  <p style="margin:0 0 20px;font-size:13px;color:#8888a0;line-height:1.7">Track this application at <a href="https://seenjobs.io" style="color:#00ff87">seenjobs.io</a>. We'll remind you if you don't hear back within the expected window.</p>
  <div style="background:#00ff8712;border:1px solid #00ff8728;border-radius:8px;padding:14px 18px;font-size:12px;color:#00ff87;line-height:1.65;font-family:monospace">
    → If you don't hear back in 30 days, come back and report it. Every report helps the next person.
  </div>
</td></tr>
<tr><td align="center" style="padding-top:24px;font-size:11px;color:#2a2a3a;line-height:1.8">
  Applied through Seen · <a href="https://seenjobs.io" style="color:#2a2a3a">seenjobs.io</a>
</td></tr>
</table></td></tr></table>
</body></html>`,
        attachments: resumeAttachment,
      })
    }));

    // 2. Internal notification to Seen admin — includes inline highlights so no attachment needed to see the best parts
    sends.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Seen Applications <noreply@seenjobs.io>',
        to: [NOTIFY_EMAIL],
        reply_to: applicantEmail,
        subject: `New application — ${role} at ${company}`,
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8f8fb;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;padding:32px 24px;">
<tr><td>
  <div style="background:#fff;border:1px solid #e8e8f0;border-radius:12px;padding:32px;">
    <div style="margin-bottom:20px">
      <span style="width:6px;height:6px;border-radius:50%;background:#00ff87;display:inline-block;margin-right:6px;vertical-align:middle"></span>
      <span style="font-size:16px;font-weight:800;color:#0f0f18;letter-spacing:-0.02em;vertical-align:middle">Seen</span>
      <span style="font-size:11px;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:4px;padding:2px 8px;margin-left:8px">${wasOptimized ? 'AI-Optimized Application' : 'New Application'}</span>
    </div>
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:800;color:#0f0f18;letter-spacing:-.02em">${esc(applicantName)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#6a6a88">Applied for <strong>${esc(role)}</strong> at ${esc(company)} · ${esc(location)}</p>

    ${topBullets.length ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #00e676;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:20px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#059669;font-weight:800;margin-bottom:10px;font-family:monospace">★ KEY HIGHLIGHTS FOR THIS ROLE</div>
      <ul style="list-style:none;padding:0;margin:0">
        ${topBullets.map(b => `<li style="padding:4px 0 4px 18px;position:relative;color:#14532d;font-size:14px;line-height:1.5"><span style="position:absolute;left:0;color:#00b359;font-weight:700">→</span>${esc(b)}</li>`).join('')}
      </ul>
      ${keywords.length ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:5px">${keywords.slice(0,6).map(k => `<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;font-family:monospace">${esc(k)}</span>`).join('')}</div>` : ''}
    </div>` : ''}

    <div style="background:#f4f4f8;border-radius:8px;padding:16px;margin-bottom:20px">
      <div style="font-size:11px;color:#9898b0;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;font-family:monospace">Applicant details</div>
      <div style="font-size:14px;color:#0f0f18;margin-bottom:6px"><strong>Name:</strong> ${esc(applicantName)}</div>
      <div style="font-size:14px;color:#0f0f18;margin-bottom:6px"><strong>Email:</strong> <a href="mailto:${esc(applicantEmail)}" style="color:#4f46e5">${esc(applicantEmail)}</a></div>
      <div style="font-size:14px;color:#0f0f18;margin-bottom:6px"><strong>Resume:</strong> ${resumeHTML ? `<span style="color:#15803d">✓ Full resume attached as HTML${wasOptimized ? ' (AI-optimized)' : ''}</span>` : `<span>${esc(resumeLink || 'On file')}</span>`}</div>
      ${coverNote ? `<div style="font-size:14px;color:#0f0f18;margin-top:10px;padding-top:10px;border-top:1px solid #e8e8f0"><strong>Cover note:</strong><br><span style="color:#444;line-height:1.6">${esc(coverNote)}</span></div>` : ''}
    </div>
    <a href="mailto:${esc(applicantEmail)}?subject=Re: Your application for ${esc(role)} at ${esc(company)}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700">Reply to applicant →</a>
  </div>
  <p style="text-align:center;font-size:11px;color:#9898b0;margin-top:16px">Sent via Seen · seenjobs.io</p>
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
          html: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;max-width:580px;margin:0 auto;padding:32px 24px;color:#1a1a2e">
<p style="font-size:15px;margin-bottom:16px">New application from <strong>${esc(applicantName)}</strong> for <strong>${esc(role)}</strong>.</p>
<p style="font-size:14px;color:#555;margin-bottom:8px"><strong>Email:</strong> <a href="mailto:${esc(applicantEmail)}" style="color:#4f46e5">${esc(applicantEmail)}</a></p>
${topBullets.length ? `
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #00e676;border-radius:0 8px 8px 0;padding:14px 18px;margin:16px 0">
  <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#059669;font-weight:800;margin-bottom:8px;font-family:monospace">★ MOST RELEVANT EXPERIENCE</div>
  <ul style="list-style:none;padding:0;margin:0">${topBullets.map(b => `<li style="padding:3px 0 3px 16px;position:relative;color:#14532d;font-size:13.5px"><span style="position:absolute;left:0;color:#00b359;font-weight:700">→</span>${esc(b)}</li>`).join('')}</ul>
</div>` : ''}
${resumeHTML ? `<p style="font-size:14px;color:#555;margin-bottom:8px"><strong>Resume:</strong> See HTML attachment${wasOptimized ? ' (AI-tailored for this role)' : ''}</p>` : ''}
${coverNote ? `<p style="font-size:14px;color:#555;margin-bottom:8px"><strong>Note:</strong> ${esc(coverNote)}</p>` : ''}
<p style="font-size:11px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:12px">Sent via Seen · seenjobs.io</p>
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
