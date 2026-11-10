// Employers: purchases to fulfil, replies to moderate. (Claims live in api/employer-claims.js, which shares
// requireAdmin.) Money grants reach or a badge, never a score.

import { ok, list } from './respond.js';
import { adminOnly, bad, notFound, upstream, str } from './context.js';
import { rows, readByIds, isUuid } from './batch.js';
import { audit, dropAuditRows } from './audit.js';
import { EMPLOYER_SKUS } from '../employerSkus.js';
import { eqValue } from '../pgrest.js';

async function listPurchases(ctx) {
  const [pr, pk] = await Promise.all([
    ctx.db('employer_purchases?select=id,company,email,employer_sku,amount_cents,status,created_at,fulfilled_at&order=created_at.desc&limit=200'),
    ctx.db('employer_perks?select=company,featured_until,verified_until,sponsor_until&order=updated_at.desc&limit=200'),
  ]);
  const purchases = await rows(pr);
  if (!Array.isArray(purchases)) throw upstream('Could not read employer purchases.');
  const perks = (await rows(pk)) || [];
  // Total revenue in SQL would be better; the table is tiny (one row per sale). Every row, keyset by id.
  let total = 0;
  for (let after = 0, i = 0; i < 100; i++) {
    const page = await rows(await ctx.db(`employer_purchases?select=id,amount_cents${after ? `&id=gt.${after}` : ''}&order=id.asc&limit=1000`));
    if (!Array.isArray(page)) { total = null; break; }
    for (const r of page) total += Number(r.amount_cents) || 0;
    if (page.length < 1000) break;
    after = page[page.length - 1].id;
  }
  return list(ctx.res, purchases, { purchases, perks, total_cents: total });
}

async function fulfillPurchase(ctx) {
  adminOnly(ctx);
  const purchaseId = str(ctx.body.purchase_id, 80);
  if (!purchaseId) throw bad('purchase_id required');
  const purchase = ((await rows(await ctx.db(`employer_purchases?id=eq.${eqValue(purchaseId)}&select=id,company,employer_sku,status&limit=1`))) || [])[0];
  if (!purchase) throw notFound('Purchase not found');
  if (purchase.status === 'fulfilled') return ok(ctx.res, { changed: 0, message: 'Already fulfilled.', touched: ['purchases'] });
  const company = String(purchase.company || '').trim().toLowerCase();
  if (!company) throw bad('Purchase has no company to attach the perk to');
  const def = EMPLOYER_SKUS[purchase.employer_sku] || null;
  const kind = def?.kind || 'featured';
  const days = def?.days || 30;
  const col = kind === 'verified' ? 'verified_until' : kind === 'sponsor' ? 'sponsor_until' : 'featured_until';
  const until = new Date(Date.now() + days * 86400e3).toISOString();
  const auditId = await audit(ctx.db, ctx.sess, 'fulfill_employer_purchase', { kind: 'purchase', id: purchase.id }, { prior: { status: purchase.status }, metadata: { company, sku: purchase.employer_sku, perk: col, until } });
  // Mark it fulfilled first, conditionally: a second press finds nothing to fulfil and grants nothing.
  const mark = await ctx.db(`employer_purchases?id=eq.${eqValue(purchase.id)}&status=neq.fulfilled&select=id`, { method: 'PATCH', body: JSON.stringify({ status: 'fulfilled', fulfilled_at: new Date().toISOString() }) });
  if (!mark.ok) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw upstream('Could not mark the purchase fulfilled.'); }
  if (!((await mark.json().catch(() => [])) || []).length) { if (auditId) await dropAuditRows(ctx.db, [auditId]); return ok(ctx.res, { changed: 0, message: 'Already fulfilled.', touched: ['purchases'] }); }
  const up = await ctx.db('employer_perks?on_conflict=company', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ company, [col]: until, purchase_id: purchase.id, updated_at: new Date().toISOString() }) });
  if (!up.ok) {
    // Put the purchase back so it can be fulfilled again.
    await ctx.db(`employer_purchases?id=eq.${eqValue(purchase.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: purchase.status, fulfilled_at: null }) });
    if (auditId) await dropAuditRows(ctx.db, [auditId]);
    throw upstream('Could not grant perk');
  }
  return ok(ctx.res, { changed: 1, message: `Granted ${kind} to ${company} until ${until.slice(0, 10)}.`, touched: ['purchases', 'overview', 'activity', `company:${company}`], company, perk: col, until });
}

async function listReplies(ctx) {
  const status = str(ctx.body.status, 20);
  const filt = ['pending', 'approved', 'rejected'].includes(status) ? `&status=eq.${status}` : '';
  const replies = await rows(await ctx.db(`employer_report_replies?select=id,report_id,company_key,body,status,created_at,reviewed_at,reviewed_by${filt}&order=created_at.desc&limit=200`));
  if (!Array.isArray(replies)) throw upstream('Could not read employer replies.');
  const ids = [...new Set(replies.map((x) => x.report_id).filter(isUuid))];
  const cr = ids.length ? await readByIds(ctx.db, 'reports', ids, { select: 'id,role,outcome,report_text,company_name' }) : { rows: [] };
  const ctxById = Object.fromEntries(cr.rows.map((r) => [r.id, { role: r.role, outcome: r.outcome, report_text: r.report_text, company_name: r.company_name }]));
  const rank = { pending: 0, approved: 1, rejected: 2 };
  const withCtx = replies.map((x) => ({ ...x, report: ctxById[x.report_id] || null }))
    .sort((a, b) => (rank[a.status] - rank[b.status]) || (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const x of replies) if (counts[x.status] != null) counts[x.status]++;
  return list(ctx.res, withCtx, { replies: withCtx, counts });
}

async function moderateReply(ctx) {
  const replyId = str(ctx.body.reply_id, 80);
  const decision = ctx.body.decision;
  if (!replyId || !['approve', 'reject'].includes(decision)) throw bad('reply_id and decision (approve|reject) required');
  const status = decision === 'approve' ? 'approved' : 'rejected';
  const nowIso = new Date().toISOString();
  const up = await ctx.db(`employer_report_replies?id=eq.${eqValue(replyId)}&status=eq.pending`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status, reviewed_by: ctx.sess.username, reviewed_at: nowIso, updated_at: nowIso }) });
  if (!up.ok) throw upstream('Could not update the reply');
  const updated = ((await up.json().catch(() => [])) || [])[0] || null;
  if (!updated) {
    const exists = ((await rows(await ctx.db(`employer_report_replies?id=eq.${eqValue(replyId)}&select=status&limit=1`))) || [])[0];
    if (!exists) throw notFound('No reply with that id.');
    return ok(ctx.res, { changed: 0, message: `Already ${exists.status}.`, touched: ['replies'], reply: null });
  }
  await audit(ctx.db, ctx.sess, 'moderate_employer_reply', { kind: 'reply', id: replyId }, { prior: { status: 'pending' }, next: { status }, metadata: { decision, company_key: updated.company_key || null } }, { required: false });
  return ok(ctx.res, { changed: 1, message: decision === 'approve' ? 'Reply published.' : 'Reply rejected.', touched: ['replies', 'overview', 'activity'], rows: [updated], reply: updated });
}

export const actions = {
  list_employer_purchases: listPurchases,
  fulfill_employer_purchase: fulfillPurchase,
  list_employer_replies: listReplies,
  moderate_employer_reply: moderateReply,
};
