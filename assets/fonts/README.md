# Card fonts

Static TrueType instances of the two brand faces the site loads from Google Fonts
(`app/layout.tsx`): **Syne** ExtraBold (display) and **Instrument Sans** 400/500/600 (text).
They exist so the server-rendered OG image (`app/company/[slug]/og/route.tsx`, satori) sets
the same type as the canvas share cards (`lib/cardKit.ts`) — satori cannot use web fonts
and cannot read variable fonts reliably, so these are the per-weight static files Google
serves to legacy user agents.

Both families are licensed under the SIL Open Font License 1.1 (`OFL-Syne.txt`,
`OFL-InstrumentSans.txt`). Loaded by `lib/server/cardFonts.ts`.
