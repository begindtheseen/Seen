---
title: Trust & Anti-Gaming
tags: [product, security]
updated: 2026-07-06
---

# Trust & Anti-Gaming

The data-quality backbone. If a system can be gamed, it eventually will be — so
Seen treats user submissions as **CLAIMS, not facts**.

```
User says:  "Offer received"
Stored as:  { type: "offer_received", confidence: "low", verified: false }
NOT:        { verified_offer: true }
```

## Event confidence
| Signal | Confidence |
|---|---|
| Single self-report | Very Low (0.3) |
| Timeline with 3+ corroborating events | Medium (0.6) |
| Long account history, realistic timing | High (0.8) |
| Corroborated by multiple independent users | Very High (0.9) |

## User trust score
Grows via account age, timeline consistency, realistic timing, corroboration.
Decays via impossible timelines (offer in 1 day), conflicting events, burst
submissions, IP/device anomalies. Levels: New → Established → High Trust →
Penalized.

## Company confidence (public display)
`<5` "Not enough data" · `5–20` "Low confidence — N reports" · `20–100`
"Moderate" · `100–1000` "Good" · `1000+` "High confidence".
**Always show the confidence label with the score.** Never present weak data as
fact — use "Based on N candidate reports", "Candidate-reported, not
employer-verified", "Public-signal estimate".

## Statistical defenses
Impossible timelines (offer < 2 days) → weight 0 · duplicate-company attacks →
deduped · >5 reports/hr/IP → blocked · 10+ similar new-account reports/24h →
quarantine · badge farming → badge withheld.

## Scoring weights (`api/_utils/companyIntel.js` SOURCE_TRUST)
direct 1.0 · survey (seen_intel) 1.0 · ingest 0.55 · reddit 0.3 · web prior 0.5.
Fusion classifies by `platform` string, not the stored `source` column.
Survey/report writes trigger `recomputeCompanyScoreFromReports`
(`reportWrite.js`) so the company page updates instantly.
(Verified [[timeline/2026-07-02]].)

## Badges (safe design)
Reward *behavior*, not single unverified outcomes. NO XP/coins/levels. Avoid
"Hired at FAANG"-style gameable prestige badges. See [[strategy]].

## Source docs
`SEEN_STRATEGY.md` (Anti-Gaming Architecture), `SCORING.md`,
`SECURITY_AUDIT.md`.
