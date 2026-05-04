export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const { applicantName, applicantEmail, role, company, location, resumeLink, coverNote, applyEmail } = await req.json();

    const RESEND_KEY = process.env.RESEND_KEY;
    if (!RESEND_KEY) throw new Error('RESEND_KEY not configured');

    const emailsToSend = [];

    // 1. Confirmation to applicant
    emailsToSend.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Seen <noreply@seenjobs.io>',
        to: applicantEmail,
        subject: `Application received â€” ${role} at ${company}`,
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#07070a;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td align="center" style="padding-bottom:32px;">
  <span style="width:8px;height:8px;border-radius:50%;background:#00ff87;display:inline-block;margin-right:8px;"></span>
  <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.04em;">Seen</span>
</td></tr>
<tr><td style="background:#111114;border:1px solid #1e1e28;border-radius:16px;padding:40px 36px;">
  <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#00ff87;">application received</p>
  <h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.03em;line-height:1.1;">You applied. We sent it.</h1>
  <p style="margin:0 0 24px;font-size:15px;color:#8888a0;line-height:1.7;font-weight:300;">Your application for <strong style="color:#fff;">${role}</strong> at <strong style="color:#fff;">${company}</strong> in ${location} has been submitted through Seen.</p>
  <div style="background:#1c1c26;border:1px solid #2e2e3e;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
    <div style="font-size:12px;font-family:monospace;color:#454558;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">Your application</div>
    <div style="font-size:14px;color:#e4e4f0;margin-bottom:6px;"><strong style="color:#9898b0;">Role:</strong> ${role}</div>
    <div style="font-size:14px;color:#e4e4f0;margin-bottom:6px;"><strong style="color:#9898b0;">Company:</strong> ${company}</div>
    <div style="font-size:14px;color:#e4e4f0;margin-bottom:6px;"><strong style="color:#9898b0;">Location:</strong> ${location}</div>
    <div style="font-size:14px;color:#e4e4f0;"><strong style="color:#9898b0;">Resume:</strong> <a href="${resumeLink}" style="color:#4b9eff;">${resumeLink}</a></div>
  </div>
  <p style="margin:0 0 24px;font-size:13px;color:#8888a0;line-height:1.7;">Track this application and all future ones at <a href="https://seenjobs.io" style="color:#00ff87;">seenjobs.io</a>. We'll remind you if you don't hear back within the expected window.</p>
  <div style="background:#00ff8712;border:1px solid #00ff8728;border-radius:8px;padding:14px 18px;font-size:12px;color:#00ff87;line-height:1.65;">
    â†’ If you don't hear back within 30 days, come back and report it. Every report helps the next person.
  </div>
</td></tr>
<tr><td align="center" style="padding-top:24px;font-size:11px;color:#2a2a3a;line-height:1.8;">
  You applied through Seen Â· <a href="https://seenjobs.io" style="color:#2a2a3a;">seenjobs.io</a>
</td></tr>
</table></td></tr></table>
</body></html>`
      })
    }));

    // 2. Forward to Seen internal + company if email provided
    const forwardTo = ['applications@seenjobs.io'];
    if (applyEmail && applyEmail.includes('@')) forwardTo.push(applyEmail);

    emailsToSend.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Seen Applications <noreply@seenjobs.io>',
        to: forwardTo,
        reply_to: applicantEmail,
        subject: `New application via Seen â€” ${role} at ${company}`,
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8f8fb;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:32px 24px;">
<tr><td>
  <div style="background:#fff;border:1px solid #e8e8f0;border-radius:12px;padding:32px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
      <span style="width:6px;height:6px;border-radius:50%;background:#4f46e5;display:inline-block;"></span>
      <span style="font-size:16px;font-weight:800;color:#0f0f18;letter-spacing:-0.02em;">Seen</span>
      <span style="font-size:11px;background:#4f46e510;color:#3730a3;border:1px solid #4f46e528;border-radius:4px;padding:2px 6px;">New Application</span>
    </div>
    <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f0f18;">${applicantName}</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6a6a88;">Applied for <strong>${role}</strong> at ${company} Â· ${location}</p>
    <div style="background:#f4f4f8;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:12px;color:#9898b0;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">Applicant details</div>
      <div style="font-size:14px;color:#0f0f18;margin-bottom:6px;"><strong>Name:</strong> ${applicantName}</div>
      <div style="font-size:14px;color:#0f0f18;margin-bottom:6px;"><strong>Email:</strong> <a href="mailto:${applicantEmail}" style="color:#4f46e5;">${applicantEmail}</a></div>
      <div style="font-size:14px;color:#0f0f18;margin-bottom:6px;"><strong>Resume:</strong> <a href="${resumeLink}" style="color:#4f46e5;">${resumeLink}</a></div>
      ${coverNote ? `<div style="font-size:14px;color:#0f0f18;margin-top:10px;padding-top:10px;border-top:1px solid #e8e8f0;"><strong>Cover note:</strong><br>${coverNote}</div>` : ''}
    </div>
    <a href="mailto:${applicantEmail}?subject=Re: Your application for ${role}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">Reply to applicant â†’</a>
  </div>
  <p style="text-align:center;font-size:11px;color:#9898b0;margin-top:16px;">Sent via Seen Â· seenjobs.io Â· The transparent job board</p>
</td></tr>
</table>
</body></html>`
      })
    }));

    await Promise.all(emailsToSend);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });

  } catch (err) {
    console.error('Apply email error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
