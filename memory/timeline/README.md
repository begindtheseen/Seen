---
title: Timeline
tags: [meta, timeline]
updated: 2026-07-06
---

# Timeline — temporal memory

One note per active day: `YYYY-MM-DD.md`. Append-only — record what happened,
never rewrite past days. This is the time-indexed record; durable facts live in
[[HOME|the knowledge notes]] and are edited in place.

## How to query it

- **"What happened on/around a date?"** → open that day's file.
- **"When did we last touch X?"** → search the vault for `[[X]]`; timeline
  entries that link X are the dated touch-points.
- **"What's the latest?"** → newest file here + the snapshot block in [[HOME]].

Keep the reverse-chronological list in [[HOME]]'s Timeline section current when
you add a day.

## Template — copy this into a new `YYYY-MM-DD.md`

```markdown
---
title: 2026-01-01
date: 2026-01-01
type: daily
tags: [timeline]
sessions: 1
---

# 2026-01-01

## Shipped
- <PR #/commit> — what landed. Links: [[knowledge-note]]

## Verified (facts, with evidence)
- <path:line or command> → <what is now true>

## Decisions
- <owner/eng decision> → logged in [[decisions/log]]

## Knowledge notes touched
- [[note]] — what changed in it

## Next (for the following session)
- <the single most important thing to pick up>
```

## Cadence

A day only needs a file if something happened that day. Multiple sessions in one
day append to the same file (bump `sessions:` in frontmatter).
