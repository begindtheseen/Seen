// Pure builder for the company-page FAQ (GEO — real-data-first AI citations). Produces the Q&A pairs
// that back BOTH a FAQPage JSON-LD node and a matching VISIBLE FAQ block (Google requires FAQ schema
// content to be present on the page). This is the format AI answer engines (ChatGPT, Perplexity,
// Gemini) most readily cite for "does <company> ghost applicants?"-style queries.
//
// HONESTY RULES (load-bearing — identical to the rest of the company surface):
//   - Ghost/response/wait numbers render ONLY when first-party applicant reports back them
//     (reportCount > 0). A rate is never fabricated.
//   - The transparency-grade Q&A renders whenever we have a score, and always names the data basis.
//   - Returns [] when there is no real score, so callers emit no empty FAQ and no FAQPage schema.

/**
 * @param {{name?:string|null, overallScore?:number|null, ghostRate?:number|null, responseRate?:number|null, avgWaitDays?:number|null, reportCount?:number|null}} s
 * @returns {Array<{question:string, answer:string}>}
 */
export function buildCompanyFaq(s) {
  const { name, overallScore, ghostRate, responseRate, avgWaitDays, reportCount } = s || {};
  if (name == null || name === '' || overallScore == null) return [];

  const rc = Number.isFinite(reportCount) ? reportCount : 0;
  const basis = rc > 0 ? `${rc} applicant report${rc === 1 ? '' : 's'}` : 'aggregated hiring data';
  const pct = (v) => Math.round(v * 100);
  const faq = [];

  // Ghost-rate — the headline query. First-party reports only.
  if (rc > 0 && ghostRate != null) {
    const g = pct(ghostRate);
    const read = g >= 60 ? 'Most applicants report never hearing back.'
      : g >= 30 ? 'A meaningful share of applicants report being ghosted.'
        : 'Most applicants do hear back one way or another.';
    faq.push({
      question: `Does ${name} ghost applicants?`,
      answer: `Based on ${basis}, ${name} has a ${g}% ghost rate — the share of applicants who reported never hearing back after applying or interviewing. ${read}`,
    });
  }
  // Response rate. First-party reports only.
  if (rc > 0 && responseRate != null) {
    faq.push({
      question: `What percentage of applicants does ${name} respond to?`,
      answer: `Applicants report a ${pct(responseRate)}% response rate from ${name}, based on ${basis}.`,
    });
  }
  // Wait time. First-party reports only.
  if (rc > 0 && avgWaitDays != null) {
    const d = Math.round(avgWaitDays);
    faq.push({
      question: `How long does ${name} take to respond to applicants?`,
      answer: `Applicants report waiting an average of ${d} day${d === 1 ? '' : 's'} to hear back from ${name}, based on ${basis}.`,
    });
  }
  // Transparency grade — always present when we have a score; names the basis, never a bare number.
  faq.push({
    question: `Is ${name} transparent in its hiring process?`,
    answer: `Seen grades ${name} ${overallScore}/100 for hiring transparency, calculated from ${basis}. Higher grades mean applicants are more consistently kept informed.`,
  });

  return faq;
}
