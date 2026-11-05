# Supabase auth email templates (Seen brand — flat blue, no green)

Round-1 testers received three account emails in three different looks (a dark neon-green confirmation, a bare
"Your Magic Link" code email, a light check-in). These three templates make them one product. They use only
Supabase's own variables (`{{ .ConfirmationURL }}`, `{{ .Token }}`), inline styles (email clients), one blue button
(#2563eb), and no images.

Apply in Supabase Studio → Authentication → Email Templates (the Management API token in this environment is not
accepted, so this is a dashboard step):

| Template | Subject | File |
|---|---|---|
| Confirm signup | `Confirm your Seen account` | `confirm-signup.html` |
| Magic Link (the 8-digit code on "Forgot password" / "Email me a sign-in link") | `Your Seen sign-in code` | `magic-link.html` |
| Reset password | `Reset your Seen password` | `recovery.html` |

Confirm signup redirects to `/dashboard` from the app (`emailRedirectTo`); the Site URL's own origin honours the
path, a preview origin is replaced by the Site URL root (verified 2026-10-23), so test the landing on seenjobs.io.
